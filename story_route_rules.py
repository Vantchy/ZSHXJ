"""Server-owned task-to-target link validation for authored chapter stories.

Pure rules and immutable-at-startup configuration: only deployed chapter quest
and story JSON files are trusted. Client-supplied 'target' fields never select a
quest step or a level in a server transaction.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

STORY_DIR = Path(__file__).resolve().parent / 'public' / 'story'


def _quest_defs(chapter):
    quests = chapter.get('quests') or {}
    return ([quests['main']] if quests.get('main') else []) + list(quests.get('side') or [])


def _dialogue_reachable(nodes, starting, ending):
    pending = [starting]
    visited = set()
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        if current == ending:
            return True
        for option in (nodes.get(current) or {}).get('options') or []:
            target = option.get('target') or {}
            if target.get('type') == 'dialogue' and target.get('id') in nodes:
                pending.append(target['id'])
    return False


def validate_story_routes(chapter: dict, story: dict, registry: dict | None = None) -> dict:
    """Check quest target type, location, level and dialogue ending/reachability.

    The authored story may define standalone dialogues; only quests using
    requireAllSteps must configure all their step targets. Legacy test-only
    quests with no task-book target remain valid placeholders.
    """
    if not isinstance(story, dict) or story.get('chapterId') != chapter['id']:
        raise ValueError('剧情目标文件与章节编号不一致')
    routes = story.get('questTargets') or {}
    if not isinstance(routes, dict):
        raise ValueError('questTargets 必须为对象')
    definitions = {quest['id']: quest for quest in _quest_defs(chapter)}
    if set(routes) - set(definitions):
        raise ValueError('剧情目标引用了未登记的任务')
    locations = {loc['id'] for loc in chapter.get('locations') or []}
    levels = {level['id'] for level in chapter.get('levels') or []}
    dialogues = story.get('dialogues') or []
    if not isinstance(dialogues, list) or any(not isinstance(d, dict) for d in dialogues):
        raise ValueError('剧情对白配置必须为数组')
    ids = [d.get('id') for d in dialogues]
    if any(not isinstance(id_, str) or not id_ for id_ in ids) or len(ids) != len(set(ids)):
        raise ValueError('剧情对白编号无效或重复')
    nodes = {d['id']: d for d in dialogues}
    local_characters = story.get('characters', [])
    if not isinstance(local_characters, list) or any(
            not isinstance(c, dict) or not isinstance(c.get('id'), str)
            or not c['id'] for c in local_characters):
        raise ValueError('剧情人物列表必须包含合法的角色 ID')
    names = [c['id'] for c in local_characters]
    if len(names) != len(set(names)):
        raise ValueError('剧情人物 ID 重复')
    known_characters = set(names) | {
        c['id'] for c in (registry or {}).get('characters', [])
    }

    # The story JSON supplies dialogue and character overlays only. Scene
    # backgrounds, map points, unlock rules and spawn coordinates belong to
    # the authoritative server locations registered in chapters.py. Without
    # this boundary, loadGame's per-ID merge could silently replace a server-
    # validated background or invent a clickable location in the browser.
    location_overrides = story.get('locations', [])
    if not isinstance(location_overrides, list):
        raise ValueError('剧情 locations 必须为地点数组')
    seen_overrides = set()
    allowed_overlay = {'id', 'npc', 'npcLine', 'characterId',
                       'dialogueId', 'characterPlacements'}
    for overlay in location_overrides:
        if not isinstance(overlay, dict) or overlay.get('id') not in locations:
            raise ValueError('剧情地点引用了未知地点 ID')
        if overlay['id'] in seen_overrides:
            raise ValueError('剧情地点覆盖项 ID 重复')
        seen_overrides.add(overlay['id'])
        if set(overlay) - allowed_overlay:
            raise ValueError('剧情地点不能覆盖背景、地图坐标或解锁配置')
        if overlay.get('dialogueId') and overlay['dialogueId'] not in nodes:
            raise ValueError('剧情地点的默认对白不存在')
        placements = overlay.get('characterPlacements', [])
        if not isinstance(placements, list):
            raise ValueError('剧情地点人物站位必须为数组')
        if placements and ('characterId' in overlay or 'dialogueId' in overlay):
            raise ValueError('多人物站位与单人物字段不能混用')
        if 'characterId' in overlay and overlay['characterId'] not in known_characters:
            raise ValueError('剧情地点引用了不存在的角色')
        occupied_characters, occupied_positions = set(), set()
        for placement in placements:
            if not isinstance(placement, dict) or set(placement) - {
                    'characterId','x','dialogueId'}:
                raise ValueError('剧情地点人物站位字段不合法')
            char_id, x = placement.get('characterId'), placement.get('x')
            if char_id not in known_characters or char_id in occupied_characters:
                raise ValueError('剧情地点站位角色未知或重复')
            if type(x) not in (int, float) or not math.isfinite(x) or not 0 <= x <= 1024:
                raise ValueError('剧情地点人物站位 x 必须是 0..1024')
            if x in occupied_positions:
                raise ValueError('剧情地点人物站位坐标重复')
            if placement.get('dialogueId') and placement['dialogueId'] not in nodes:
                raise ValueError('剧情地点人物站位引用了不存在的对白')
            occupied_characters.add(char_id)
            occupied_positions.add(x)

    for quest in definitions.values():
        if quest.get('locationId') and quest['locationId'] not in locations:
            raise ValueError(f"任务 {quest['id']} 引用了不存在的地点")
    for quest_id, configured in routes.items():
        quest = definitions[quest_id]
        if not isinstance(configured, dict):
            raise ValueError(f'任务 {quest_id} 的导航目标必须为对象')
        if quest.get('completion', {}).get('requireAllSteps') is True:
            if set(configured) - {'steps','review'}:
                raise ValueError(f'有序任务 {quest_id} 包含未知导航字段')
            steps = quest.get('steps') or []
            mappings = configured.get('steps')
            if not isinstance(mappings, dict) or set(mappings) != {s['id'] for s in steps}:
                raise ValueError(f'有序任务 {quest_id} 缺少步骤目标或含有未知步骤')
            for step in steps:
                _validate_target(quest, mappings[step['id']], nodes, levels, step)
            if 'review' in configured:
                if (not isinstance(configured['review'], dict) or
                        configured['review'].get('type') != 'dialogue'):
                    raise ValueError('复述剧情目标必须为对白')
                _validate_target(quest, configured['review'], nodes, levels, None)
        else:
            if 'steps' in configured:
                raise ValueError(f'非有序任务 {quest_id} 不支持步骤目标映射')
            _validate_target(quest, configured, nodes, levels, None)

    for quest in definitions.values():
        if quest.get('completion', {}).get('requireAllSteps') and quest['id'] not in routes:
            raise ValueError(f"有序任务 {quest['id']} 缺少服务端可核验的导航目标")
    return story


def _validate_target(quest, target, nodes, levels, step):
    if not isinstance(target, dict):
        raise ValueError('任务导航目标必须为对象')
    kind, target_id = target.get('type'), target.get('id')
    if not isinstance(target_id, str) or not target_id:
        raise ValueError('任务导航目标缺少合法 ID')
    if target.get('locationId') and target['locationId'] != quest.get('locationId'):
        raise ValueError('步骤导航目标地点与任务地点不一致')
    condition = (step or {}).get('condition') or {}
    if kind == 'level':
        if (target_id not in levels or quest.get('completion', {}).get('mode') != 'official-circuit'
                or target_id not in (quest.get('completion') or {}).get('levelIds', [])):
            raise ValueError('任务导航关卡未登记或未关联到此任务')
        if step and (condition.get('type') != 'level-completed' or
                     condition.get('levelId') != target_id):
            raise ValueError('关卡步骤的完成条件与导航目标不一致')
    elif kind == 'dialogue':
        if target_id not in nodes:
            raise ValueError('任务导航对白不存在')
        if step:
            finish_id = condition.get('dialogueId')
            if condition.get('type') != 'dialogue-finished' or finish_id not in nodes:
                raise ValueError('对白步骤未登记合法的完成段落')
            if not _dialogue_reachable(nodes, target_id, finish_id):
                raise ValueError('完成对白无法从本步骤入口抵达')
            if nodes[finish_id].get('options'):
                raise ValueError('用于完成任务的对白必须是可结束的末段')
    else:
        raise ValueError('剧情目标种类必须为 dialogue 或 level')


def load_story_routes(chapters, story_dir=STORY_DIR, registry=None):
    result = {}
    for chapter in chapters:
        path = Path(story_dir) / f"{chapter['id']}.json"
        if not path.is_file():
            if any(q.get('completion', {}).get('requireAllSteps') for q in _quest_defs(chapter)):
                raise ValueError(f"缺少有序任务的剧情配置：{path.name}")
            continue
        try:
            story = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ValueError(f'无法读取剧情目标：{path.name}') from error
        result[chapter['id']] = validate_story_routes(chapter, story, registry)
    return result
