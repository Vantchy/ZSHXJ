#!/usr/bin/env python3
"""Check runtime artwork URLs, dynamic room asset names and archive separation."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
MANIFEST = ROOT / "tools" / "asset-manifest.json"
CODE_EXT = {".js", ".mjs", ".py", ".css", ".html", ".json", ".svg"}
ASSET_RE = re.compile(r"/assets/(?:room|quests|scenes|results|leaderboard)/[\w./-]+\.(?:png|svg|jpe?g|webp)")
OLD_PATH_RE = re.compile(r"""['"(]/(?:ui-room-v9|ui-room|scenes|assets/quest-ui)/""")


def check() -> list[str]:
    errors: list[str] = []
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    source_files = [
        p for p in [ROOT / "chapters.py", *PUBLIC.rglob("*")]
        if p.is_file() and p.suffix.lower() in CODE_EXT
    ]
    combined = "\n".join(p.read_text(encoding="utf-8") for p in source_files)
    for src in source_files:
        contents = src.read_text(encoding="utf-8")
        if OLD_PATH_RE.search(contents):
            errors.append(f"Legacy public asset URL: {src.relative_to(ROOT)}")
        for path in ASSET_RE.findall(contents):
            if not (PUBLIC / path.lstrip("/")).is_file():
                errors.append(f"Missing asset {path} (referenced by {src.relative_to(ROOT)})")

    for asset in manifest["active_assets"]:
        target = PUBLIC / asset["to"].lstrip("/")
        if not target.is_file():
            errors.append(f"Asset missing from manifest: {asset['to']}")
            continue
        if hashlib.sha256(target.read_bytes()).hexdigest() != asset["sha256"]:
            errors.append(f"Asset content changed unexpectedly: {asset['to']}")
        # The room/quest APIs construct URLs from a directory constant and a
        # filename; accepting a named basename covers those static references.
        if asset["to"] not in combined and target.name not in combined:
            errors.append(f"Unreferenced runtime asset: {asset['to']}")
    for legacy in ("public/ui-room", "public/ui-room-v9", "public/scenes", "public/assets/quest-ui"):
        if (ROOT / legacy).exists():
            errors.append(f"Legacy runtime directory still present: {legacy}")
    return errors


if __name__ == "__main__":
    problems = check()
    if problems:
        for problem in problems:
            print("FAIL:", problem)
        raise SystemExit(1)
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    print("Asset references OK: %d active runtime assets." % len(data["active_assets"]))
