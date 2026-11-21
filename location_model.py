"""Authoritative chapter locations and future multi-room save contract.

Current UI still displays the original single room. This module deliberately
introduces NO extra playable locations and NO migration of existing saves.

Optional chapter location fields:
    mapPoint: {x, y}             coordinates in the chapter map, 0..1
    spawnX: number               initial room-world position, 35..989
    entryPrerequisites: [questId] completed/submitted quests needed for entry
    background: /assets/scenes/<safe-image-name>.png|jpg|webp

Optional chapter progress field:
    locationPositions: {locationId: {x: number}}

The legacy `locationId` + `position: {x}` continue to describe the current
room. New clients keep both the active position and its locationPositions
entry in sync; the server rejects conflicting snapshots rather than silently
losing the last saved location position. No extra SQLite tables are needed.
"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping


LOCATION_ID = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
SCENE_URL = re.compile(r"^/assets/scenes/[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:png|jpg|webp)$")
ROOM_X_MIN, ROOM_X_MAX = 0, 1024
DEFAULT_SPAWN_X = 180  # Existing app.js defaultState, not a new player position.


def _number(value: Any, low: float, high: float) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def _quests(chapter: Mapping) -> dict[str, dict]:
    quests = chapter.get('quests') or {}
    return {quest['id']: quest for quest in
            ([quests['main']] if quests.get('main') else []) + list(quests.get('side') or [])}


def validate_location_definitions(chapters) -> None:
    """Reject invalid scene references/coordinates/dependencies at startup.

    No image file needs to exist while new content is being authored; the
    existing asset checker is responsible for production file references.
    """
    for chapter in chapters:
        chapter_id = chapter['id']
        locations = chapter.get('locations', [])
        if not isinstance(locations, list):
            raise ValueError(f'章节 {chapter_id} 的 locations 必须是数组')
        ids: set[str] = set()
        defined_quests = _quests(chapter)
        for index, item in enumerate(locations):
            where = f'章节 {chapter_id} 地点[{index}]'
            if not isinstance(item, dict):
                raise ValueError(f'{where} 必须是对象')
            loc_id = item.get('id')
            if not isinstance(loc_id, str) or not LOCATION_ID.fullmatch(loc_id):
                raise ValueError(f'{where} 的地点 ID 不合法')
            if loc_id in ids:
                raise ValueError(f'{where} 的地点 ID 重复：{loc_id}')
            ids.add(loc_id)
            if not isinstance(item.get('name'), str) or not item['name'].strip():
                raise ValueError(f'{where} 的地点名称不能为空')
            background = item.get('background')
            if background is not None and (not isinstance(background, str) or
                                           not SCENE_URL.fullmatch(background)):
                raise ValueError(f'{where} 的背景图片路径无效')
            if 'spawnX' in item and not _number(item['spawnX'], 35, 989):
                raise ValueError(f'{where} 的 spawnX 必须在 35..989 之间')
            if 'mapPoint' in item:
                point = item['mapPoint']
                if (not isinstance(point, dict) or set(point) != {'x', 'y'} or
                        not all(_number(point[k], 0, 1) for k in ('x', 'y'))):
                    raise ValueError(f'{where} 的 mapPoint 坐标必须是 0..1')
            prerequisites = item.get('entryPrerequisites', [])
            if (not isinstance(prerequisites, list) or
                    any(not isinstance(qid, str) for qid in prerequisites) or
                    len(prerequisites) != len(set(prerequisites)) or
                    any(qid not in defined_quests for qid in prerequisites)):
                raise ValueError(f'{where} 的 entryPrerequisites 引用了未知或重复任务')


def validate_location_state(chapter: Mapping, state: Mapping) -> None:
    """Check optional per-location position data without requiring migrations.

    The old `position` is intentionally *not* revalidated: older builds used a
    different room width and the existing renderer converts those coordinates.
    """
    if not isinstance(state, dict):
        raise ValueError('章节存档必须是对象')
    locations = {loc['id']: loc for loc in chapter.get('locations') or []}
    location_id = state.get('locationId')
    if 'locationId' in state and (not isinstance(location_id, str) or
                                  location_id not in locations):
        raise ValueError('存档引用了不存在的地点 locationId')
    if 'locationPositions' not in state:
        return  # Truly unchanged legacy state. Do not add a field on save.
    positions = state['locationPositions']
    if not isinstance(positions, dict):
        raise ValueError('locationPositions 必须是对象')
    for loc_id, position in positions.items():
        if loc_id not in locations:
            raise ValueError(f'locationPositions 引用了未登记地点 {loc_id}')
        if (not isinstance(position, dict) or set(position) != {'x'} or
                not _number(position['x'], ROOM_X_MIN, ROOM_X_MAX)):
            raise ValueError(f'地点 {loc_id} 的位置必须为有限坐标 {{x:0..1024}}')
    if not positions:
        return  # An opt-in empty map is allowed while the client initializes.
    if location_id in positions and 'position' in state:
        active = state['position']
        if (not isinstance(active, dict) or not _number(active.get('x'), ROOM_X_MIN, ROOM_X_MAX) or
                active['x'] != positions[location_id]['x']):
            raise ValueError('当前 position 与 locationPositions 中的活动地点位置不一致')


def _quest_complete(chapter: Mapping, state: Mapping, quest_id: str) -> bool:
    definition = _quests(chapter).get(quest_id)
    tasks = state.get('tasks') if isinstance(state, dict) else None
    if not isinstance(tasks, dict) or definition is None:
        return False
    side = tasks.get('side')
    progress = (tasks.get('main') if definition['type'] == 'main'
                else side.get(quest_id) if isinstance(side, dict) else None)
    return isinstance(progress, dict) and progress.get('status') in ('completed', 'submitted')


def missing_entry_prerequisites(chapter: Mapping, state: Mapping, location: Mapping) -> list[str]:
    return [qid for qid in location.get('entryPrerequisites', [])
            if not _quest_complete(chapter, state, qid)]


def validate_location_transition(chapter: Mapping, before: Mapping, after: Mapping) -> None:
    """Enforce a room entry against the LAST COMMITTED progress revision.

    A single PUT may not mark a prerequisite complete and enter its locked
    destination. Revisiting an existing location without changing locationId
    is still allowed for old saves even if authored unlock rules later change.
    """
    validate_location_state(chapter, after)
    loc_id = after.get('locationId')
    if loc_id is None or loc_id == before.get('locationId'):
        return
    location = next(loc for loc in chapter['locations'] if loc['id'] == loc_id)
    if missing := missing_entry_prerequisites(chapter, before, location):
        raise ValueError(f"地点 {loc_id} 尚未解锁，前置任务未完成：{', '.join(missing)}")


def _resume_x(chapter: Mapping, state: Mapping, location: Mapping, index: int) -> float:
    loc_id = location['id']
    remembered = state.get('locationPositions')
    if isinstance(remembered, dict) and isinstance(remembered.get(loc_id), dict):
        x = remembered[loc_id].get('x')
        if _number(x, ROOM_X_MIN, ROOM_X_MAX):
            return x
    active = state.get('locationId')
    if active == loc_id or (active is None and index == 0):
        legacy = state.get('position')
        if isinstance(legacy, dict) and _number(legacy.get('x'), 0, 1400):
            x = legacy['x']
            if x > ROOM_X_MAX:
                x = x * ROOM_X_MAX / 1400
            return min(989, max(35, x))
    return location.get('spawnX', DEFAULT_SPAWN_X)


def public_location_entries(chapter: Mapping, state: Mapping,
                            story: Mapping | None = None) -> list[dict]:
    """Render-agnostic metadata for a future multi-marker map or room loader.

    No player state is sent to other users and no quest/score is fabricated.
    """
    state = state if isinstance(state, dict) else {}
    overlays = {item['id']: item for item in (story or {}).get('locations', [])}
    result = []
    for index, location in enumerate(chapter.get('locations') or []):
        blocked = missing_entry_prerequisites(chapter, state, location)
        # Only authored dialogue/character fields may overlay authoritative
        # scene metadata. Deployed story routes were validated at startup.
        overlay = {k: v for k, v in overlays.get(location['id'], {}).items()
                   if k in {'npc', 'npcLine', 'characterId', 'dialogueId',
                            'characterPlacements'}}
        result.append({
            **location,
            **overlay,
            'canEnter': bool(chapter.get('implemented')) and not blocked,
            'blockedBy': blocked,
            'resumeX': _resume_x(chapter, state, location, index),
        })
    return result
