"""Data-only story/media interfaces and fail-fast content validation.

There is deliberately no rendering, navigation, quest mutation or save logic here.
The existing /api/chapters response already forwards optional chapter fields.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any, Mapping, Sequence

REGISTRY_FILE = Path(__file__).resolve().parent / "public" / "story" / "characters.json"

# IDs and material filenames use lowercase ASCII slugs. This also excludes
# path traversal, queries, URLs, spaces, backslashes and percent-encoded paths.
_ID_RE = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z")
_FILE_RE = r"[a-z0-9]+(?:-[a-z0-9]+)*"
_IMAGE_EXT = r"(?:webp|png|jpg|jpeg)"
_VIDEO_EXT = r"(?:mp4|webm)"
MEDIA_TYPES = frozenset(("image", "video"))
MEDIA_DISPLAYS = frozenset(("fullscreen", "background", "embed"))
OPTION_TARGETS = frozenset(("dialogue", "location", "quest"))
QUEST_ACTIONS = frozenset(("accept", "submit"))


def _fail(where: str, message: str) -> None:
    raise ValueError(f"剧情数据错误 [{where}]：{message}")


def _object(value: Any, where: str, *, required: set[str],
            allowed: set[str]) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        _fail(where, "必须是 JSON 对象")
    missing = required - value.keys()
    unknown = value.keys() - allowed
    if missing:
        _fail(where, f"缺少必填字段：{', '.join(sorted(missing))}")
    if unknown:
        _fail(where, f"未知字段：{', '.join(sorted(unknown))}")
    return value


def _nonempty_text(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(where, "必须是非空字符串")
    return value


def _identifier(value: Any, where: str) -> str:
    if not isinstance(value, str) or not _ID_RE.fullmatch(value):
        _fail(where, "标识须为小写字母开头、由小写字母/数字/连字符组成")
    return value


def _path(value: Any, where: str, *, prefix: str, kind: str) -> None:
    extension = _IMAGE_EXT if kind == "image" else _VIDEO_EXT
    pattern = rf"{re.escape(prefix)}/{_FILE_RE}\.{extension}\Z"
    if not isinstance(value, str) or re.fullmatch(pattern, value) is None:
        _fail(where, f"路径必须匹配 {prefix}/<小写短横线文件名>."
              + ("webp/png/jpg/jpeg" if kind == "image" else "mp4/webm")
              + "（不校验素材文件是否存在）")


def validate_character_registry(registry: Any) -> dict[str, dict]:
    """Return globally unique character records indexed by ID."""
    data = _object(registry, "角色登记", required={"characters"},
                   allowed={"characters"})
    entries = data["characters"]
    if not isinstance(entries, list):
        _fail("角色登记.characters", "必须是角色数组")
    by_id: dict[str, dict] = {}
    for index, entry in enumerate(entries):
        where = f"角色登记.characters[{index}]"
        item = _object(entry, where, required={"id", "name"},
                       allowed={"id", "name", "dialoguePortrait", "scenePortrait"})
        char_id = _identifier(item["id"], f"{where}.id")
        _nonempty_text(item["name"], f"{where}.name")
        if char_id in by_id:
            _fail(f"{where}.id", f"角色标识重复：{char_id}")
        for field in ("dialoguePortrait", "scenePortrait"):
            value = item.get(field)
            if value is not None:
                _path(value, f"{where}.{field}",
                      prefix=f"/assets/story/characters/{char_id}/images",
                      kind="image")
        by_id[char_id] = dict(item)
    return by_id


def load_character_registry(path: str | Path | None = None) -> dict:
    """Read and validate the one global registry when chapters are imported."""
    file = Path(path) if path is not None else REGISTRY_FILE
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"剧情角色登记读取失败 [{file}]：{error}") from error
    validate_character_registry(data)
    return data


def _validate_media(media: Any, where: str, chapter_id: str) -> None:
    item = _object(media, where,
                   required={"path", "type", "display"},
                   allowed={"path", "type", "display"})
    kind = item["type"]
    display = item["display"]
    if not isinstance(kind, str) or kind not in MEDIA_TYPES:
        _fail(f"{where}.type", f"非法媒体类型：{kind!r}，只能为 image/video")
    if not isinstance(display, str) or display not in MEDIA_DISPLAYS:
        _fail(f"{where}.display",
              f"非法显示方式：{display!r}，只能为 fullscreen/background/embed")
    folder = "images" if kind == "image" else "videos"
    _path(item["path"], f"{where}.path",
          prefix=f"/assets/story/{chapter_id}/{folder}", kind=kind)


def _validate_speaker(speaker: Any, where: str, characters: Mapping[str, dict]) -> None:
    item = _object(speaker, where, required=set(),
                   allowed={"characterId", "name"})
    if len(item) != 1:
        _fail(where, "说话人必须且只能使用 characterId 或 name 之一")
    if "characterId" in item:
        char_id = _identifier(item["characterId"], f"{where}.characterId")
        if char_id not in characters:
            _fail(f"{where}.characterId", f"引用不存在的角色：{char_id}")
    else:
        _nonempty_text(item["name"], f"{where}.name")


def _validate_options(options: Any, where: str, *,
                      dialogue_ids: set[str],
                      location_ids: set[str], quest_ids: set[str]) -> None:
    if not isinstance(options, list) or not options:
        _fail(where, "选项必须是非空数组；没有选项请省略 options")
    for index, option in enumerate(options):
        item_where = f"{where}[{index}]"
        item = _object(option, item_where, required={"text", "target"},
                       allowed={"text", "target"})
        _nonempty_text(item["text"], f"{item_where}.text")
        target = _object(item["target"], f"{item_where}.target",
                         required={"type", "id"}, allowed={"type", "id", "action"})
        kind = target["type"]
        if not isinstance(kind, str) or kind not in OPTION_TARGETS:
            _fail(f"{item_where}.target.type",
                  f"非法选项指向种类：{kind!r}，只能为 dialogue/location/quest")
        dest_id = _identifier(target["id"], f"{item_where}.target.id")
        if kind == "dialogue":
            if "action" in target:
                _fail(f"{item_where}.target.action", "dialogue 类型不能包含 action")
            if dest_id not in dialogue_ids:
                _fail(f"{item_where}.target.id", f"引用不存在的对话：{dest_id}")
        elif kind == "location":
            if "action" in target:
                _fail(f"{item_where}.target.action", "location 类型不能包含 action")
            if dest_id not in location_ids:
                _fail(f"{item_where}.target.id", f"引用不存在的地点：{dest_id}")
        else:
            if not isinstance(target.get("action"), str) or target["action"] not in QUEST_ACTIONS:
                _fail(f"{item_where}.target.action",
                      "任务动作必须为 accept（接取）或 submit（交付）")
            if dest_id not in quest_ids:
                _fail(f"{item_where}.target.id", f"引用不存在的任务：{dest_id}")


def validate_story_definitions(chapters: Sequence[dict], registry: Any) -> None:
    """Validate optional story fields without changing legacy chapter semantics.

    Called by chapters.py at import time; server.py already imports chapters
    before creating an HTTP server, so content errors fail startup immediately.
    """
    characters = validate_character_registry(registry)
    for chapter in chapters:
        chapter_id = _identifier(chapter.get("id"), "章节.id")
        where = f"章节[{chapter_id}]"
        locations = chapter.get("locations", [])
        if not isinstance(locations, list):
            _fail(f"{where}.locations", "必须为地点数组")
        location_ids: set[str] = set()
        for index, location in enumerate(locations):
            loc_where = f"{where}.locations[{index}]"
            if not isinstance(location, dict):
                _fail(loc_where, "地点必须是对象")
            loc_id = _identifier(location.get("id"), f"{loc_where}.id")
            if loc_id in location_ids:
                _fail(f"{loc_where}.id", f"地点标识重复：{loc_id}")
            location_ids.add(loc_id)
            if "characterPlacements" in location:
                if "characterId" in location or "dialogueId" in location:
                    _fail(
                        loc_where,
                        "新旧角色站位写法不能混用：characterPlacements 与地点级 "
                        "characterId/dialogueId 二选一",
                    )
                placements = location["characterPlacements"]
                if not isinstance(placements, list) or not placements:
                    _fail(
                        f"{loc_where}.characterPlacements",
                        "站位写了就必须是非空数组；无角色请省略此字段",
                    )
                occupied_characters: set[str] = set()
                occupied_positions: set[int | float] = set()
                for placement_index, placement in enumerate(placements):
                    slot_where = f"{loc_where}.characterPlacements[{placement_index}]"
                    slot = _object(
                        placement, slot_where,
                        required={"characterId", "x"},
                        allowed={"characterId", "x", "dialogueId"},
                    )
                    char_id = _identifier(
                        slot["characterId"], f"{slot_where}.characterId"
                    )
                    if char_id not in characters:
                        _fail(
                            f"{slot_where}.characterId",
                            f"引用不存在的角色：{char_id}",
                        )
                    if char_id in occupied_characters:
                        _fail(
                            f"{slot_where}.characterId",
                            f"同一地点角色重复站位：{char_id}",
                        )
                    occupied_characters.add(char_id)

                    x = slot["x"]
                    if (
                        type(x) not in (int, float)
                        or not 0 <= x <= 1024
                        or (type(x) is float and not math.isfinite(x))
                    ):
                        _fail(
                            f"{slot_where}.x",
                            "站位横坐标必须是 0 到 1024 之间的有限数值（含端点）",
                        )
                    if x in occupied_positions:
                        _fail(
                            f"{slot_where}.x",
                            f"同一地点横坐标重复：{x}",
                        )
                    occupied_positions.add(x)
                    if "dialogueId" in slot:
                        _identifier(
                            slot["dialogueId"], f"{slot_where}.dialogueId"
                        )
            else:
                # Previous revision: one registered character and one optional
                # location-level dialogue. Pre-existing npc/npcLine is unchanged.
                if "characterId" in location:
                    char_id = _identifier(
                        location["characterId"], f"{loc_where}.characterId"
                    )
                    if char_id not in characters:
                        _fail(
                            f"{loc_where}.characterId",
                            f"引用不存在的角色：{char_id}",
                        )
                if "dialogueId" in location:
                    _identifier(
                        location["dialogueId"], f"{loc_where}.dialogueId"
                    )

        dialogues = chapter.get("dialogues", [])
        if not isinstance(dialogues, list):
            _fail(f"{where}.dialogues", "必须为对话数组")
        dialogue_ids: set[str] = set()
        for index, dialogue in enumerate(dialogues):
            dlg_where = f"{where}.dialogues[{index}]"
            item = _object(dialogue, dlg_where, required={"id", "lines"},
                           allowed={"id", "lines", "options"})
            dlg_id = _identifier(item["id"], f"{dlg_where}.id")
            if dlg_id in dialogue_ids:
                _fail(f"{dlg_where}.id", f"对话标识重复：{dlg_id}")
            dialogue_ids.add(dlg_id)

        for loc_index, location in enumerate(locations):
            loc_where = f"{where}.locations[{loc_index}]"
            if "characterPlacements" in location:
                for slot_index, slot in enumerate(location["characterPlacements"]):
                    if ("dialogueId" in slot
                            and slot["dialogueId"] not in dialogue_ids):
                        _fail(
                            f"{loc_where}.characterPlacements[{slot_index}].dialogueId",
                            f"引用不存在的对话：{slot['dialogueId']}",
                        )
            elif "dialogueId" in location and location["dialogueId"] not in dialogue_ids:
                _fail(f"{loc_where}.dialogueId",
                      f"引用不存在的对话：{location['dialogueId']}")

        container = chapter.get("quests") or {}
        quest_defs = ([container["main"]] if container.get("main") else []) + list(container.get("side") or [])
        quest_ids = {quest["id"] for quest in quest_defs}

        for index, dialogue in enumerate(dialogues):
            dlg_where = f"{where}.dialogues[{index}]"
            lines = dialogue["lines"]
            if not isinstance(lines, list) or not lines:
                _fail(f"{dlg_where}.lines", "台词序列必须为非空数组")
            for line_index, line in enumerate(lines):
                line_where = f"{dlg_where}.lines[{line_index}]"
                item = _object(line, line_where, required={"speaker", "text"},
                               allowed={"speaker", "text", "media"})
                _validate_speaker(item["speaker"], f"{line_where}.speaker", characters)
                _nonempty_text(item["text"], f"{line_where}.text")
                if "media" in item:
                    _validate_media(item["media"], f"{line_where}.media", chapter_id)
            if "options" in dialogue:
                _validate_options(dialogue["options"], f"{dlg_where}.options",
                                  dialogue_ids=dialogue_ids, location_ids=location_ids,
                                  quest_ids=quest_ids)


def resolve_location_story(chapter: Mapping, location: Mapping,
                           registry: Mapping[str, Any]) -> dict[str, Any]:
    """Data-only precedence helper for a future renderer (no UI side effects).

    characterId takes priority over the old NPC name, and dialogueId takes
    priority over the old npcLine. Older locations resolve exactly as before.
    Call validate_story_definitions before resolving authored content.
    """
    characters = {item["id"]: item for item in registry["characters"]}
    char_id = location.get("characterId")
    character = characters[char_id] if char_id is not None else None
    dialogue_id = location.get("dialogueId")
    dialogue = next(
        (entry for entry in chapter.get("dialogues", []) if entry["id"] == dialogue_id),
        None,
    ) if dialogue_id is not None else None
    return {
        "npcName": character["name"] if character is not None else (
            location.get("npc") or chapter.get("npc", "")
        ),
        "character": character,
        "dialogue": dialogue,
        "legacyLine": None if dialogue_id is not None else (
            chapter.get("npcLine", "") if location.get("npcLine") is None
            else location["npcLine"]
        ),
    }


def resolve_location_placements(
    chapter: Mapping[str, Any],
    location: Mapping[str, Any],
    registry: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Resolve registered characters and their per-placement dialogue data.

    This is a pure data helper; it does not display or trigger any dialogue.
    Legacy single-character locations become one placement with x=None
    because the old format did not specify a coordinate.
    """
    characters = {entry["id"]: entry for entry in registry["characters"]}
    dialogues = {entry["id"]: entry for entry in chapter.get("dialogues", [])}
    if "characterPlacements" in location:
        entries = location["characterPlacements"]
    elif "characterId" in location:
        entries = [{
            "characterId": location["characterId"],
            **({"dialogueId": location["dialogueId"]}
               if "dialogueId" in location else {}),
        }]
    else:
        return []
    return [
        {
            "characterId": entry["characterId"],
            "character": characters[entry["characterId"]],
            "x": entry.get("x"),  # No coordinate existed in the legacy format.
            "dialogueId": entry.get("dialogueId"),
            "dialogue": dialogues.get(entry.get("dialogueId")),
        }
        for entry in entries
    ]
