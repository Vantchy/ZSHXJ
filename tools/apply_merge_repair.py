#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ZSHXJ main/9e468f8 compatible: minimal, validated and reversible integration fix.
No dependencies, no server/database changes, no replacement of entire common modules.
"""
from __future__ import annotations

import argparse
import datetime
import difflib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

FILES = ("public/quest-book-display.js", "public/app.js", "public/room.js", "public/index.html")
LABEL = "ZSHXJ 任务书与回顾合并修复 · 2026-11"
PINS = ("9e468f8",)
class UnsupportedSource(RuntimeError):
    pass

def once(source: str, before: str, after: str, desc: str, marker: str | None = None) -> str:
    """One precise replacement; rerunning a patched file makes no change."""
    if marker and marker in source:
        return source
    if source.count(before) == 1:
        return source.replace(before, after, 1)
    if after and after in source:
        return source
    raise UnsupportedSource(f"{desc}: 原有源码不匹配或出现多个副本，已停止，避免覆盖其他人的改动")

def patch_quest_book(source: str) -> str:
    source = once(
        source,
        "  if (/^(taosi-three-pages|yanwei-)/.test(quest?.id||'')) return '子';\n  return '其他';",
        """  if (/^(taosi-three-pages|yanwei-)/.test(quest?.id||'')) return '子';
  // ZSHXJ-MERGE-FIX-BRANCH: stable identifiers when a title omits the period.
  if (/^yin-/.test(quest?.id||'') || /^yin-/.test(quest?.locationId||'')) return '寅';
  if (/^yangcheng-/.test(quest?.id||'') || /^yangcheng-/.test(quest?.locationId||'')) return '丑';
  if (/^mengjin-/.test(quest?.id||'')) return '亥';
  if (/^taosi-nand-/.test(quest?.id||'')) return '丑';
  return '其他';""",
        "任务书时代分组", "ZSHXJ-MERGE-FIX-BRANCH"
    )
    source = once(
        source,
        r".replace(/^(?:孟津|陶寺|嫣沩)(?:[·、，:：\s]+|$)/,'')",
        r".replace(/^(?:孟津|陶寺|嫣沩|妫汭|阳城|钟村|斟鄩|景亳|甘|西吴壁|新宫|鸣条|亳|偃师商城|寺北|殷|羌方|朝歌|岐周|丰镐|牧野|骊山|太原|彘|晋|临淄|曲阜|洛邑)(?:[·、，:：\s]+|$)/,'')",
        "任务书标题中的正式地名"
    )
    begin = "export function questBookDescription(quest,chapter) {"
    end = "export function questBookStoryGroups(tasks) {"
    marker = "ZSHXJ-MERGE-FIX-CITY"
    if marker not in source:
        if source.count(begin) != 1 or source.count(end) != 1:
            raise UnsupportedSource("任务书地点说明函数无法唯一定位")
        start = source.index(begin)
        stop = source.index(end, start)
        if stop - start > 2200:
            raise UnsupportedSource("任务书地点说明范围超出预期")
        section = r"""// ZSHXJ-MERGE-FIX-CITY: infer geography from registered location before title.
const QUEST_BOOK_CITIES = Object.freeze([
  '偃师商城','西吴壁','孟津','陶寺','嫣沩','妫汭','阳城','钟村','斟鄩','景亳',
  '鸣条','寺北','羌方','朝歌','岐周','丰镐','牧野','骊山','太原','临淄',
  '曲阜','洛邑','新宫','亳','甘','殷','彘','晋'
]);
const QUEST_BOOK_CITY_BY_LOCATION = Object.freeze([
  [/^yin-zhongcun-/, '钟村'],
  [/^yin-zhenxun-/, '斟鄩'],
  [/^yin-jingbo-/, '景亳'],
  [/^mengjin-/, '孟津'],
  [/^taosi-/, '陶寺'],
  [/^yanwei-/, '嫣沩'],
  [/^yangcheng-/, '阳城'],
]);
export function questBookDescription(quest,chapter) {
  const description=String(quest?.description||'').trim();
  if(!description)return '';
  const scene=chapter?.locations?.find(item=>item.id===quest?.locationId);
  const sceneName=String(scene?.name||'').trim();
  const cityFromScene=QUEST_BOOK_CITIES.find(city =>
    sceneName===city || new RegExp('^'+city+'[·、，:：\\s（(]').test(sceneName));
  const locationId=String(quest?.locationId||'');
  const cityFromId=QUEST_BOOK_CITY_BY_LOCATION.find(([prefix])=>prefix.test(locationId))?.[1];
  const city=(quest?.id==='taosi-chou-handoff'?'陶寺':'') ||
    cityFromScene || cityFromId || (quest?.id==='binary-decoder'?'孟津':'');
  if(!city)return description;
  const cityPrefix=new RegExp('^(?:'+QUEST_BOOK_CITIES.join('|')+')[，,、:：\\s]+');
  const body=description.replace(cityPrefix,'').trim();
  return body ? `${city}，${body}` : city;
}
"""
        source = source[:start] + section + source[stop:]
    return source

def patch_app(source: str) -> str:
    source = once(
        source,
        "import {resolveQuestDestination} from './quest-navigation.js';",
        "import {resolveQuestDestination} from './quest-navigation.js';\n"
        "import {reviewScenesAtSpot} from './story-spot-review.js'; // ZSHXJ-MERGE-FIX-REVIEW-IMPORT",
        "回顾模型导入", "ZSHXJ-MERGE-FIX-REVIEW-IMPORT"
    )
    source = once(
        source,
        """  const hudCurrent = hudEntries.find(item => item.progress?.status === 'accepted' ||
    item.progress?.status === 'completed') ||
    hudEntries.find(item => item.progress?.status !== 'submitted' &&
      questPrerequisitesSatisfied(hudChapter,hudState,item.quest));""",
        """  // ZSHXJ-MERGE-FIX-MAP-CURRENT: use the same active story selection as the task book.
  const hudCurrentKey = questBookCurrentKey(hudEntries,hudChapter,hudState);
  const hudCurrent = hudEntries.find(item=>item.key===hudCurrentKey) || null;""",
        "地图当前任务与任务书同步", "ZSHXJ-MERGE-FIX-MAP-CURRENT"
    )
    source = once(
        source,
        """  if (hudCurrent) el('p',sceneHint(hudChapter,hudCurrent.quest,hudCurrent.progress),mapTaskBody)
    .className='room-map-taskbar-hint';""",
        "  // ZSHXJ-MERGE-FIX-MAP-HINT: detailed guidance belongs in the task book, not under the HUD title.",
        "移除大地图任务栏多余小字", "ZSHXJ-MERGE-FIX-MAP-HINT"
    )
    before = """    onVisitStoryAct: async (review) => {
      if (!stillOnView(roomView,roomSession)) return;
      if (!review?.locationId || !review?.questId ||
          !(review.catalogEntryId || review.catalogBoardId)) {
        throw new Error('缺少回顾目标，无法切换场景。');
      }
      return showRoom(chapterId,review.locationId,{
        questId:review.questId,
        ...(review.catalogBoardId ? {catalogBoardId:review.catalogBoardId} :
          {catalogEntryId:review.catalogEntryId}),
      });
    },"""
    after = """    onVisitStoryAct: async (review) => {
      // ZSHXJ-MERGE-FIX-LEVEL-REPLAY: all review kinds share an authored, validated route.
      if (!stillOnView(roomView,roomSession)) return;
      const kinds = [review?.catalogEntryId, review?.catalogBoardId, review?.catalogLevelId]
        .filter(id => typeof id === 'string' && id.length);
      if (!review?.locationId || !review?.questId || kinds.length !== 1) {
        throw new Error('缺少或混用了回顾目标，无法切换场景。');
      }
      if (review.catalogLevelId) {
        // The room rechecked the selectable entry; revalidate at the router too.
        // Only a finished level step at this SAME physical spot with allowReplay
        // may open the editor. Do not synthesize step evidence or circuit grades.
        const allowedScene = reviewScenesAtSpot(chapter,state,location.id)
          .find(item => item.questId === review.questId &&
            item.locationId === review.locationId);
        const allowed = allowedScene?.entries?.some(entry =>
          entry.kind === 'level' && entry.targetId === review.catalogLevelId &&
          entry.stepId === review.catalogStepId);
        if (!allowed || !chapter.levels?.some(level=>level.id===review.catalogLevelId)) {
          throw new Error('该电路关卡尚未完成或没有开放本光点回顾。');
        }
        const previousReturn = state.questReturn;
        state.questReturn = makeQuestReturnContext({
          chapterId, locationId:review.locationId, levelId:review.catalogLevelId,
          questId:review.questId, stepId:review.catalogStepId,
          playerX:state.position?.x,
        });
        try {
          captureRoomLocationPosition(state, location.id);
          await saveChapter(chapterId,state,'before_story_level_review',roomSession);
        } catch (error) {
          state.questReturn = previousReturn;
          throw error;
        }
        if (!stillOnView(roomView,roomSession)) return;
        return showLevel(chapterId,review.catalogLevelId);
      }
      return showRoom(chapterId,review.locationId,{
        questId:review.questId,
        ...(review.catalogBoardId ? {catalogBoardId:review.catalogBoardId} :
          {catalogEntryId:review.catalogEntryId}),
      });
    },"""
    source = once(source, before, after, "回顾电路进入编辑器", "ZSHXJ-MERGE-FIX-LEVEL-REPLAY")
    source = once(source,
        'from "./room.js?v=chapter-ui-7";',
        'from "./room.js?v=mergefix-20261124";',
        "房间入口缓存版本")
    source = once(source,
        "from './quest-book-display.js?v=chapter-ui-7';",
        "from './quest-book-display.js?v=mergefix-20261124';",
        "任务书缓存版本")
    return source

def patch_room(source: str) -> str:
    source = once(
        source,
        """  const taskHint = node('p', '', taskContent);
  taskHint.className = 'room-taskbar-hint';""",
        "  // ZSHXJ-MERGE-FIX-ROOM-HINT: avoid the redundant hint under the compact task title.",
        "房间任务栏小字", "ZSHXJ-MERGE-FIX-ROOM-HINT"
    )
    source = once(
        source,
        "    taskHint.textContent = current ? sceneHint(chapter,current.quest,current.progress) : '';",
        "    // ZSHXJ-MERGE-FIX-HINT-ASSIGN: no second small-text summary in the HUD.",
        "房间任务栏小字赋值", "ZSHXJ-MERGE-FIX-HINT-ASSIGN"
    )
    source = once(
        source,
        "node('p', chosenReview ? '选择已完成的对白或题板。' :",
        "node('p', chosenReview ? '选择已完成的对白、题板或电路关卡。' :",
        "回顾面板内容提示"
    )
    source = once(
        source,
        "node('small',entry.kind==='board'?'题板':'对白',stepButton);",
        "node('small',entry.kind==='level'?'电路':entry.kind==='board'?'题板':'对白',stepButton);",
        "已完成电路步骤的类型标签"
    )
    source = once(source,
        "from './quest-book-display.js?v=chapter-ui-7';",
        "from './quest-book-display.js?v=mergefix-20261124';",
        "房间任务书缓存版本")
    return source

def patch_index(source: str) -> str:
    return once(source,
        '<script type="module" src="/app.js?v=chapter-ui-7"></script>',
        '<script type="module" src="/app.js?v=mergefix-20261124"></script>',
        "网页入口缓存版本")

PATCHERS = {
    "public/quest-book-display.js": patch_quest_book,
    "public/app.js": patch_app,
    "public/room.js": patch_room,
    "public/index.html": patch_index,
}

def locate_root(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    script_root = Path(__file__).resolve().parent.parent
    if (script_root / "server.py").is_file():
        return script_root
    return Path.cwd().resolve()

def check_install(root: Path) -> dict:
    if not (root/"server.py").exists() or not (root/"public"/"app.js").exists():
        raise UnsupportedSource(f"不是 ZSHXJ 项目根目录：{root}（请把压缩包解压到含 server.py 的目录）")
    for path in FILES:
        if not (root/path).is_file():
            raise UnsupportedSource(f"缺失必要源码：{path}")
    updates = {}
    for name, patcher in PATCHERS.items():
        path = root/name
        original = path.read_bytes()
        if original.startswith(b'\xef\xbb\xbf'):
            raise UnsupportedSource(f"{name} 含 BOM，无法在当前安全模式下处理")
        try:
            decoded = original.decode("utf-8")
            patched = patcher(decoded)
        except UnicodeDecodeError as error:
            raise UnsupportedSource(f"{name} 非 UTF-8：{error}") from error
        updates[name] = (original, patched.encode("utf-8"))
    return updates

def run_tests(root: Path) -> None:
    node = shutil.which("node")
    if not node:
        print("  ! 未找到 Node.js，跳过 JS 静态语法与烟雾测试（不影响补丁应用）")
        return
    for name in (n for n in FILES if n.endswith(".js")):
        result = subprocess.run([node, "--check", str(root/name)],
            capture_output=True, text=True, encoding="utf-8", errors="replace")
        if result.returncode:
            raise UnsupportedSource(f"{name} 的 JavaScript 语法检查未通过：\n{result.stderr}")
    for name in ("tests/js_quest_book_merge_fix.mjs",
                 "tests/js_story_review_merge_fix.mjs",
                 "tests/js_merge_wiring_smoke.mjs"):
        if (root/name).is_file():
            result = subprocess.run([node, str(root/name)], cwd=root,
                capture_output=True, text=True, encoding="utf-8", errors="replace")
            if result.returncode:
                raise UnsupportedSource(f"回归测试失败 {name}：\n{result.stderr}")
            print("  ✓",result.stdout.strip())

def apply(root: Path, updates: dict, *, dry_run: bool = False, check_only: bool = False) -> None:
    dirty = [(name,old,new) for name,(old,new) in updates.items() if old != new]
    for name,(old,new) in updates.items():
        print(f"  {'修改' if old!=new else '已修复，无需改动'}: {name}")
    if dry_run or check_only:
        print(f"预检通过。需要修改 {len(dirty)} 个文件；本次未写入。")
        return
    if not dirty:
        print("没有必要重复安装；全部目标均已修复。")
        run_tests(root)
        return
    backup_base = (root/".git"/"zshxj_merge_backups") if (root/".git").is_dir() else (root/".zshxj_merge_backups")
    backup = backup_base/datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    for name,old,new in dirty:
        target = backup/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(old)
    written = []
    try:
        for name,old,new in dirty:
            path = root/name
            fd,tmp = tempfile.mkstemp(prefix=".zshxj-", suffix=".tmp", dir=path.parent)
            try:
                with os.fdopen(fd,"wb") as stream:
                    stream.write(new)
                os.replace(tmp,path)
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
            written.append(name)
        print("正在检查 JavaScript 语法…")
        run_tests(root)
    except Exception:
        for name in reversed(written):
            (root/name).write_bytes((backup/name).read_bytes())
        print("修复失败，已经从备份恢复原文件。",file=sys.stderr)
        raise
    print(f"完成：已修改 {len(dirty)} 个文件。备份路径：{backup}")

def main(argv=None):
    parser = argparse.ArgumentParser(description=LABEL)
    parser.add_argument("--root",default=None,help="ZSHXJ 项目根目录（默认脚本所在目录的上一级）")
    parser.add_argument("--dry-run", action="store_true",help="只检查源码兼容性，不写入")
    parser.add_argument("--check", action="store_true",help="只检查是否可应用，不写入")
    parser.add_argument("--diff",action="store_true",help="打印建议的逐行改动，不写入")
    args=parser.parse_args(argv)
    try:
        root = locate_root(args.root)
        print(f"{LABEL}\n项目根目录: {root}")
        updates=check_install(root)
        if args.diff:
            for name,(old,new) in updates.items():
                print("".join(difflib.unified_diff(
                    old.decode("utf-8").splitlines(True),
                    new.decode("utf-8").splitlines(True),
                    fromfile=name+" (原版)",tofile=name+" (修复版)"
                )))
            return 0
        apply(root,updates,dry_run=args.dry_run,check_only=args.check)
        return 0
    except (UnsupportedSource,OSError) as error:
        print(f"安全终止：{error}",file=sys.stderr)
        return 2

if __name__ == "__main__":
    sys.exit(main())
