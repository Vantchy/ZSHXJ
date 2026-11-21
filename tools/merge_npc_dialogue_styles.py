#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Consolidate the one existing NPC dialogue's CSS without touching room.js or portraits.

Usage:
    python tools/merge_npc_dialogue_styles.py --check
    python tools/merge_npc_dialogue_styles.py --apply
    python tools/merge_npc_dialogue_styles.py --restore
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
VISUAL = Path("public/room-visual.css")
CENTERED = Path("public/room-dialogue-centered.css")
INDEX = Path("public/index.html")
BACKUP = Path(".npc-dialogue-merge-backup.zip")
BEGIN = "/* BEGIN ZSHXJ NPC DIALOGUE CENTERED STYLES (MERGED) */"
END = "/* END ZSHXJ NPC DIALOGUE CENTERED STYLES (MERGED) */"

# This literal legacy rule drew an unwanted square over the new transparent portraits.
# Remove only the exact square rule, never any other portrait styling.
LEGACY_SQUARE = re.compile(
    r"(?m)^[ \t]*#app\.page--room\s+\.npc-dialogue-portrait::before\s*"
    r"\{\s*content:\s*[\"'][\"']\s*;\s*position:\s*absolute\s*;\s*"
    r"left:\s*28%\s*;\s*top:\s*19%\s*;\s*width:\s*32%\s*;\s*"
    r"height:\s*62%\s*;\s*background:\s*#80644d\s*;\s*"
    r"border:\s*1px\s+solid\s+#4a3524\s*;\s*"
    r"border-radius:\s*0\s*;\s*\}\s*\n?"
)

# Precise removal of only the standalone stylesheet reference and its adjacent
# known comment. Keep every other link and script exactly as it exists locally.
CENTER_LINK = re.compile(
    r"(?m)^[ \t]*<link\s+rel=[\"']stylesheet[\"']\s+"
    r"href=[\"']/room-dialogue-centered\.css(?:\?[^\"']*)?[\"']\s*/?>[ \t]*\r?\n?"
)
CENTER_COMMENT = re.compile(
    r"(?m)^[ \t]*<!-- NPC dialogue size and bottom-center position:"
    r"[^\r\n]*-->[ \t]*\r?\n?"
)
VISUAL_LINK = re.compile(
    r"(?P<pre>href=[\"'])/room-visual\.css"
    r"(?:\?v=[^\"']*)?(?P<post>[\"'])"
)


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def read(rel: Path) -> bytes:
    return (ROOT / rel).read_bytes()


def prepare():
    for p in (VISUAL, INDEX, CENTERED):
        if not (ROOT / p).is_file():
            raise RuntimeError(f"必要文件不存在：{p}。未修改任何文件。")

    visual = read(VISUAL).decode("utf-8")
    html = read(INDEX).decode("utf-8")
    addon = read(CENTERED).decode("utf-8")

    if BEGIN in visual or END in visual:
        raise RuntimeError("发现已合并的标记，停止重复合并；请先运行 --check。")
    if ".room-dialogue" not in visual or ".npc-dialogue-speaker" not in visual:
        raise RuntimeError("原房间样式中找不到对话框声明，停止修改。")
    if ".room-dialogue--open" not in addon or ".npc-dialogue-portrait" not in addon:
        raise RuntimeError("独立样式文件不包含完整的居中/头像样式，停止修改。")
    if "font-family: var(--font-display)" in addon:
        raise RuntimeError(
            "独立样式仍含之前试验性的字体覆盖规则。请先使用字体恢复包，避免合并时恢复错误字体。"
        )
    links = CENTER_LINK.findall(html)
    if len(links) != 1:
        raise RuntimeError(f"index.html 中独立 CSS 引用数量为 {len(links)}，预期为 1；停止修改。")
    if len(VISUAL_LINK.findall(html)) != 1:
        raise RuntimeError("index.html 中找不到唯一的 room-visual.css 引用；停止修改。")

    # Insert at the tail of the original stylesheet so responsive rules from
    # the centered stylesheet remain in their original order.
    without_square, square_count = LEGACY_SQUARE.subn("", visual)
    if square_count > 1:
        raise RuntimeError("检测到多个旧头像占位块，需人工核对；停止修改。")

    block = (f"\n\n{BEGIN}\n"
             f"/* Same single .room-dialogue created by room.js; no second dialogue box. */\n"
             + addon.strip() + f"\n{END}\n")
    merged = without_square.rstrip() + block

    new_html, count = CENTER_LINK.subn("", html)
    if count != 1:
        raise RuntimeError("无法准确移除独立 CSS 引用；停止修改。")
    new_html = CENTER_COMMENT.sub("", new_html)
    # Force a fresh request for moved styles instead of serving cached CSS.
    new_html, visual_count = VISUAL_LINK.subn(
        lambda m: m.group("pre") + "/room-visual.css?v=npc-dialogue-merged-1" + m.group("post"),
        new_html,
    )
    if visual_count != 1:
        raise RuntimeError("无法准确更新房间 CSS 缓存版本；停止修改。")
    assert "/room-dialogue-centered.css" not in new_html
    assert BEGIN in merged and END in merged
    return (
        {str(VISUAL): read(VISUAL), str(INDEX): read(INDEX), str(CENTERED): read(CENTERED)},
        {str(VISUAL): merged.encode("utf-8"), str(INDEX): new_html.encode("utf-8")},
        square_count,
    )


def already_merged() -> bool:
    visual_path, centered_path, index_path = ROOT / VISUAL, ROOT / CENTERED, ROOT / INDEX
    if not visual_path.exists() or not index_path.exists():
        return False
    visual = visual_path.read_text(encoding="utf-8")
    html = index_path.read_text(encoding="utf-8")
    return (
        BEGIN in visual and END in visual
        and not centered_path.exists()
        and "/room-dialogue-centered.css" not in html
    )


def atomic_write(path: Path, payload: bytes):
    temp = path.with_name(path.name + ".npc-merge-tmp")
    try:
        temp.write_bytes(payload)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def save_backup(originals, expected):
    path = ROOT / BACKUP
    if path.exists():
        raise RuntimeError(f"备份文件已存在：{BACKUP}，为防止覆盖请先处理旧备份。")
    manifest = {
        "original_sha256": {p: sha(b) for p, b in originals.items()},
        "merged_sha256": {p: sha(b) for p, b in expected.items()},
        "removed": str(CENTERED),
    }
    with ZipFile(path, "w", ZIP_DEFLATED) as z:
        for p, content in originals.items():
            z.writestr("before/" + p, content)
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    with ZipFile(path) as z:
        if z.testzip():
            raise RuntimeError("备份压缩包校验失败，未开始更改。")


def apply():
    if already_merged():
        print("已经完成合并，无需重复执行。")
        return
    originals, merged, square_count = prepare()
    save_backup(originals, merged)
    try:
        atomic_write(ROOT / VISUAL, merged[str(VISUAL)])
        atomic_write(ROOT / INDEX, merged[str(INDEX)])
        (ROOT / CENTERED).unlink()
    except Exception:
        # Best-effort rollback to the exact bytes saved before mutation.
        for rel, content in originals.items():
            atomic_write(ROOT / rel, content)
        raise
    print("✅ 合并完成：")
    print("  修改 public/room-visual.css：追加旧居中/透明裁切 CSS；移除旧头像方块规则" if square_count
          else "  修改 public/room-visual.css：追加旧居中/透明裁切 CSS（旧头像方块规则已不存在）")
    print("  修改 public/index.html：取消独立 CSS 引用；更新房间样式缓存版本")
    print("  删除 public/room-dialogue-centered.css：内容已完整迁入 room-visual.css")
    print("  未修改 room.js、NPC 人物 JS、头像图片、字体、任务、剧情、数据库。")
    print(f"  恢复备份：{BACKUP}（验证通过前请勿删除）")


def restore():
    path = ROOT / BACKUP
    if not path.exists():
        raise RuntimeError(f"未发现备份：{BACKUP}")
    with ZipFile(path) as z:
        if z.testzip():
            raise RuntimeError("备份文件损坏，拒绝恢复。")
        manifest = json.loads(z.read("manifest.json"))
        originals = {p: z.read("before/" + p.replace("\\", "/")) for p in manifest["original_sha256"]}
    if not already_merged():
        raise RuntimeError("当前文件状态并非预期的合并状态，拒绝覆盖你后来的修改。")
    for rel, expected in manifest["merged_sha256"].items():
        if sha(read(Path(rel))) != expected:
            raise RuntimeError(f"{rel} 在合并后又有新修改；停止自动恢复以避免覆盖。")
    for rel, data in originals.items():
        atomic_write(ROOT / Path(rel), data)
    print("✅ 已恢复到合并前：", ", ".join(originals.keys()))
    print(f"备份仍保留在 {BACKUP}，可在确认后手动删除。")


def main():
    parser = argparse.ArgumentParser(
        description="整合 NPC 对话框的两层 CSS，保持原有 room.js、头像及任务逻辑。"
    )
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true", help="检查当前状态，不修改文件")
    action.add_argument("--apply", action="store_true", help="先备份，再执行合并")
    action.add_argument("--restore", action="store_true", help="安全撤销本工具的合并")
    args = parser.parse_args()
    try:
        if args.restore:
            restore()
        elif args.check:
            if already_merged():
                print("✅ 当前已经是合并后的单 CSS 结构，无需再改。")
                return
            original, merged, square_count = prepare()
            print("✅ 可以安全合并，检查未修改文件。")
            print("  保留：room.js / npc-dialogue-display.js / npc-dialogue-characters.js / 30 张图片")
            print("  将修改：", ", ".join(merged))
            print("  将删除：", CENTERED, "（其样式转移入 room-visual.css）")
            print("  将清理：旧头像方块规则", "（发现）" if square_count else "（本地已不存在）")
            for rel, content in original.items():
                print(f"  原文件 SHA256: {rel} {sha(content)[:16]}")
        else:
            apply()
    except (OSError, UnicodeError, RuntimeError, ValueError) as exc:
        print("❌", exc, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
