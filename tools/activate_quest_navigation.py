#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Small, checked integration for Vantchy/ZSHXJ at the current main branch.

The GitHub repo can have local/unpushed edits; read the actual files in place,
reject unrecognized layouts, and back up both originals before changing them.

Usage:
    python tools/activate_quest_navigation.py --check
    python tools/activate_quest_navigation.py --apply
    python tools/activate_quest_navigation.py --restore
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import shutil
import subprocess
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "public" / "app.js"
ROOM = ROOT / "public" / "room.js"
HELPER = ROOT / "public" / "quest-navigation.js"
CONTEXT = ROOT / "public" / "quest-return-context.js"
# Keep backups outside tracked project files whenever a .git directory exists.
BACKUP = ((ROOT / ".git" / "zshxj-quest-navigation-backup.zip")
          if (ROOT / ".git").is_dir()
          else (ROOT / ".zshxj-quest-navigation-backup.zip"))
STAMP = "/* ZSHXJ QUEST NAVIGATION V2 */"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"{label}: 期望找到一个可安全修改的位置，实际找到 {count} 个；原文件未修改。")
    return source.replace(old, new, 1)


def replace_between(source: str, start: str, end: str, new: str, label: str) -> str:
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError(f"{label}: 无法唯一定位原函数，停止操作。")
    left, right = source.index(start), source.index(end)
    if not left < right:
        raise ValueError(f"{label}: 源码顺序已改变，停止操作。")
    return source[:left] + new + source[right:]


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def integrate_room(room: str) -> str:
    room = replace_once(
        room,
        "import {WORKSHOP_ID, WORKSHOP_INTRO, WORKSHOP_REPORT, isWorkshopQuest,\n",
        "import {WORKSHOP_ID, WORKSHOP_INTRO, WORKSHOP_LEVEL, WORKSHOP_REPORT, isWorkshopQuest,\n",
        "导入玉匠铺任务 ID"
    )
    room = replace_once(
        room,
        "        workshopProgressWithPass} from './workshop-quest.js';\n",
        "        workshopProgressWithPass} from './workshop-quest.js';\n"
        "import {resolveQuestDestination} from './quest-navigation.js';\n",
        "导入统一任务导航"
    )
    room = replace_once(
        room,
        "export function createRoom({\n"
        "  host, chapter, state, location = {}, characters = {}, wallet = 0, inventory = [],\n",
        "export function createRoom({\n"
        "  returnContext = null,\n"
        "  host, chapter, state, location = {}, characters = {}, wallet = 0, inventory = [],\n",
        "房间创建接口"
    )
    room = replace_once(
        room,
        "  let selectedQuestKey = workshopHere ? `side:${WORKSHOP_ID}` : 'main';\n",
        "  let selectedQuestKey = workshopHere ? `side:${WORKSHOP_ID}` : 'main';\n"
        "  // After a task-linked circuit, reopen the same task when the book is opened.\n"
        "  if (returnContext?.questId === chapter.quests?.main?.id) selectedQuestKey = 'main';\n"
        "  else if ((chapter.quests?.side || []).some(q => q.id === returnContext?.questId)) {\n"
        "    selectedQuestKey = `side:${returnContext.questId}`;\n"
        "  }\n",
        "返回后恢复任务选择"
    )
    room = replace_once(
        room,
        "  let questNavigationBusy = false;\n",
        "  let questNavigationBusy = false;\n"
        "  let pendingDialogueTarget = null;\n",
        "任务对白导航状态"
    )
    room = replace_once(
        room,
        "  function openTaskPanel() {\n"
        "    closeDialogue();",
        "  function openTaskPanel() {\n"
        "    pendingDialogueTarget = null;\n"
        "    closeDialogue();",
        "打开任务书时取消旧的行走目标"
    )

    resolver = """  function taskDestination(entry) {
    return resolveQuestDestination({
      entry, chapter, state, locationId:location.id,
      canGoToLevel:Boolean(onGoToLevel),
      reviewTarget:isWorkshopQuest(entry?.quest) && workshopHere
        ? {type:'dialogue', id:'mengjin-workshop-finished',
           title:'本场已完成，可重温对白或重做练习'}
        : null,
    });
  }
"""
    room = replace_between(
        room,
        "  function taskDestination(entry) {\n",
        "  function renderTaskPanel() {\n",
        resolver,
        "任务书目标解析函数"
    )

    old_go = """        if (!running || taskPanel.hidden) return;
        clearTimeout(saveTimer);
        await onGoToLevel(destination.target.id);
        if (running) closeTaskPanel();
"""
    new_go = """        if (!running || taskPanel.hidden) return;
        if (destination.target.type === 'dialogue') {
          closeTaskPanel();
          if (near()) {
            openDialogue(false, {entryId:destination.target.id, kind:'quest-target'});
          } else {
            pendingDialogueTarget = destination.target.id;
            tapTarget = NPC_X;
            tapInteract = 'npc';
            notify('正前往任务人物处。');
          }
          return;
        }
        clearTimeout(saveTimer);
        await onGoToLevel(destination.target.id, {
          questId:current.quest.id, stepId:destination.stepId, locationId:location.id,
        });
        if (running) closeTaskPanel();
"""
    room = replace_once(room, old_go, new_go, "普通任务书前往动作")
    room = replace_once(
        room,
        "      await onGoToLevel(workshopQuest.completion.levelIds[0]);",
        "      await onGoToLevel(workshopQuest.completion.levelIds[0], {\n"
        "        questId:workshopQuest.id, stepId:WORKSHOP_LEVEL, locationId:location.id,\n"
        "      });",
        "玉匠铺关卡返回元数据"
    )
    room = replace_once(
        room, "    } else if (storyContext) {\n      workshopEndOptions();",
        "    } else if (storyContext && storyContext.kind !== 'quest-target') {\n"
        "      workshopEndOptions();",
        "普通任务对白避免错误显示玉匠铺选项"
    )
    room = replace_once(
        room,
        "    if (workshopHere) { return perform(startWorkshopConversation); }\n",
        "    if (pendingDialogueTarget) {\n"
        "      const entryId = pendingDialogueTarget;\n"
        "      pendingDialogueTarget = null;\n"
        "      openDialogue(false, {entryId, kind:'quest-target'});\n"
        "      return;\n"
        "    }\n"
        "    if (workshopHere) { return perform(startWorkshopConversation); }\n",
        "按任务书目的地抵达人物时开始对白"
    )
    return room


def integrate_app(app: str) -> str:
    app = replace_once(
        app,
        "import {isWorkshopQuest, workshopProgressWithPass} from './workshop-quest.js';\n",
        "import {isWorkshopQuest, workshopProgressWithPass} from './workshop-quest.js';\n"
        "import {makeQuestReturnContext, readQuestReturnContext,\n"
        "        resolveReturnLocation} from './quest-return-context.js';\n",
        "导入关卡返回元数据"
    )
    app = replace_once(
        app,
        "async function showRoom(chapterId, locationId = null) {\n",
        "async function showRoom(chapterId, locationId = null, resumeContext = null) {\n",
        "房间入口接收恢复的任务上下文"
    )
    app = replace_once(
        app,
        "  roomDispose = createRoom({\n"
        "    host, chapter: roomChapter, state, location, characters,",
        "  roomDispose = createRoom({\n"
        "    returnContext:resumeContext,\n"
        "    host, chapter: roomChapter, state, location, characters,",
        "将返回上下文送入任务书"
    )

    old_demo = """      await saveChapter(chapterId, state, "before_circuit_demo");
"""
    new_demo = """      state.questReturn = makeQuestReturnContext({
        chapterId, locationId:location.id, levelId:firstLevelId,
        playerX:state.position?.x,
      });
      await saveChapter(chapterId, state, "before_circuit_demo");
"""
    app = replace_once(app, old_demo, new_demo, "旧电路入口也保存返回地点")

    old_go = """    onGoToLevel: async (levelId) => {
      if (!chapter.levels?.some(level => level.id === levelId)) {
        throw new Error('本章没有此电路关卡');
      }
      await saveChapter(chapterId, state, 'before_task_circuit');
      try { await syncFirstCircuitQuestCompletion(chapterId); }
      catch (error) { console.warn('电路任务进度暂未同步：', error); }
      await showLevel(chapterId, levelId);
    },
"""
    new_go = """    onGoToLevel: async (levelId, navigation = {}) => {
      if (!chapter.levels?.some(level => level.id === levelId)) {
        throw new Error('本章没有此电路关卡');
      }
      // Persist the route in the existing chapter JSON before opening editor.
      // No extra database, and no user-supplied quest progress is trusted here.
      const previousReturn = state.questReturn;
      state.questReturn = makeQuestReturnContext({
        chapterId, locationId:location.id, levelId,
        questId:navigation.questId ?? null, stepId:navigation.stepId ?? null,
        playerX:state.position?.x,
      });
      try {
        await saveChapter(chapterId, state, 'before_task_circuit');
      } catch (error) {
        state.questReturn = previousReturn;
        throw error;
      }
      try { await syncFirstCircuitQuestCompletion(chapterId); }
      catch (error) { console.warn('电路任务进度暂未同步：', error); }
      await showLevel(chapterId, levelId);
    },
"""
    app = replace_once(app, old_go, new_go, "任务书关卡入口及保存")

    app = replace_once(
        app,
        "  const levelState = copy(saved.get(chapterId)?.state || defaultState(chapterId));\n"
        "  const lifetime = { controller: new AbortController(), dispose: null };",
        "  const levelState = copy(saved.get(chapterId)?.state || defaultState(chapterId));\n"
        "  const returnContext = readQuestReturnContext(levelState.questReturn, {\n"
        "    chapterId, levelId:selectedLevelId, locations:chapter.locations,\n"
        "  });\n"
        "  const returnLocation = chapter.locations?.find(loc => loc.id === returnContext?.locationId);\n"
        "  const lifetime = { controller: new AbortController(), dispose: null };",
        "编辑器从章节存档读取来源信息"
    )
    app = replace_once(
        app,
        "    returnLabel: selectedLevelId === 'ch1_binary_decoder' ? '返回玉匠铺' : undefined,",
        "    returnLabel: selectedLevelId === 'ch1_binary_decoder' ? '返回玉匠铺'\n"
        "      : returnContext?.questId && returnLocation?.name ? `返回${returnLocation.name}` : undefined,",
        "编辑器返回按钮文字"
    )
    app = replace_once(
        app,
        "        await showRoom(chapterId, levelState.locationId);",
        "        const latestState = saved.get(chapterId)?.state || levelState;\n"
        "        const restored = readQuestReturnContext(latestState.questReturn, {\n"
        "          chapterId, levelId:selectedLevelId, locations:chapter.locations,\n"
        "        });\n"
        "        await showRoom(chapterId,\n"
        "          resolveReturnLocation(latestState, chapter, selectedLevelId), restored);",
        "关卡退出后恢复来源地点及任务"
    )
    return app


def prepare():
    for required in (APP, ROOM, HELPER, CONTEXT):
        if not required.is_file():
            raise ValueError(f"缺少文件：{required.relative_to(ROOT)}；未修改任何原代码。")
    raw_app, raw_room = APP.read_bytes(), ROOM.read_bytes()
    app = raw_app.decode("utf-8")
    room = raw_room.decode("utf-8")
    if STAMP in app or "import {resolveQuestDestination}" in room:
        raise ValueError("检测到本轮补丁已部分接入，不会再次覆盖。")
    merged_app, merged_room = integrate_app(app), integrate_room(room)
    merged_app = STAMP + "\n" + merged_app
    merged_room = STAMP + "\n" + merged_room

    # Verify important untouched functions are still present.
    for token in ["syncFirstCircuitQuestCompletion(", "cloudDescend(", "module.mount(ctx)"]:
        if token not in merged_app:
            raise ValueError(f"app.js 缺少必要功能 {token}，停止。")
    for token in ["createDialoguePlayer(", "workshopEndOptions()", "renderTaskPanel()",
                  "workshopProgressWithPass(", "alignStoryDialogue()"]:
        if token not in merged_room:
            raise ValueError(f"room.js 缺少必要功能 {token}，停止。")

    # If Node is installed, require syntax validity before touching files.
    node = shutil.which("node")
    if node:
        for label, text in (("app.js", merged_app), ("room.js", merged_room)):
            result = subprocess.run(
                [node, "--check", "--input-type=module"],
                input=text, text=True, capture_output=True,
                timeout=15,
            )
            if result.returncode:
                raise ValueError(f"{label} 生成结果未通过 JS 语法检查：{result.stderr[:400]}")
    return {
      APP: (raw_app, merged_app.encode("utf-8")),
      ROOM: (raw_room, merged_room.encode("utf-8")),
    }


def atomic_write(path: Path, data: bytes):
    tmp = path.with_name(path.name + ".questnav-tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def apply():
    if BACKUP.exists():
        raise ValueError(f"检测到已有备份：{BACKUP}；为防止覆盖，本次不继续。")
    changes = prepare()
    manifest = {
      "original": {path.relative_to(ROOT).as_posix():sha(before) for path, (before, _) in changes.items()},
      "installed": {path.relative_to(ROOT).as_posix():sha(after) for path, (_, after) in changes.items()},
    }
    with ZipFile(BACKUP, "w", ZIP_DEFLATED) as z:
        for path, (before, _) in changes.items():
            z.writestr("original/" + path.relative_to(ROOT).as_posix(), before)
        z.writestr("manifest.json",json.dumps(manifest,ensure_ascii=False,indent=2))
    with ZipFile(BACKUP) as z:
        if z.testzip():
            raise ValueError("备份校验未通过，停止应用。")

    try:
        for path, (_, after) in changes.items():
            atomic_write(path, after)
    except Exception:
        for path, (before, _) in changes.items():
            atomic_write(path, before)
        raise

    print("✅ 已接入统一任务导航与关卡返回上下文。")
    print("已修改：public/room.js, public/app.js")
    print("已新增：public/quest-navigation.js, public/quest-return-context.js")
    print("没有删除文件；任务书、地图过场、电路编辑器和存档后端不变。")
    print(f"合并前源文件备份：{BACKUP}")
    print("请刷新游戏页面进行验收。")


def restore():
    if not BACKUP.is_file():
        raise ValueError("没有发现备份文件，无法恢复。")
    with ZipFile(BACKUP) as z:
        if z.testzip():
            raise ValueError("备份文件损坏，停止。")
        manifest = json.loads(z.read("manifest.json"))
        restored = {
          ROOT / path: z.read("original/" + path)
          for path in manifest["original"]
        }
    for path in restored:
        rel = path.relative_to(ROOT).as_posix()
        if not path.is_file() or sha(path.read_bytes()) != manifest["installed"][rel]:
            raise ValueError(f"{rel} 在合并后又被修改，禁止自动覆盖；请从备份手工比对。")
    for path, original in restored.items():
        atomic_write(path, original)
    print("✅ app.js 与 room.js 已精确恢复原字节；新增模块及测试未删除。")


def main():
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--check",action="store_true")
    g.add_argument("--apply",action="store_true")
    g.add_argument("--restore",action="store_true")
    args = p.parse_args()
    try:
        if args.restore:
            restore()
        elif args.check:
            changes = prepare()
            print("✅ 兼容性检查通过；目前没有修改文件。")
            for path,(before,after) in changes.items():
                print(str(path.relative_to(ROOT)),f"{len(before)}→{len(after)} 字节")
        else:
            apply()
    except (ValueError, OSError, UnicodeError) as exc:
        print("❌",exc,file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
