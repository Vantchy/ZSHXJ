"""Quest definitions and saved progress: explicit structures, no invented content.

Definitions belong to chapters.py.  A student's progress is stored in the
existing chapter progress JSON; no duplicate quest table or fake story seed.
"""
from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

QuestStatus = Literal['not-accepted', 'accepted', 'completed', 'submitted']
StepStatus = Literal['pending', 'current', 'done', 'skipped']
CompletionMode = Literal['official-circuit', 'test-only', 'not-implemented']

STATUSES = frozenset(('not-accepted', 'accepted', 'completed', 'submitted'))
STEP_STATUSES = frozenset(('pending', 'current', 'done', 'skipped'))
TRANSITIONS = {
    'not-accepted': frozenset(('accepted',)),
    'accepted': frozenset(('completed',)),
    'completed': frozenset(('submitted',)),
    'submitted': frozenset(),
}

class QuestStepDefinition(TypedDict):
    id: str
    title: str
    description: str  # empty until developed
    condition: dict | None  # no invented game triggers

class QuestCompletion(TypedDict):
    mode: CompletionMode
    levelIds: list[str]  # official-circuit only; empty for test-only

class QuestDefinition(TypedDict):
    id: str
    type: Literal['main', 'side']
    title: str
    description: str
    hint: str
    chapterId: str
    locationId: str | None
    steps: list[QuestStepDefinition]
    prerequisites: list[str]
    rewards: list[dict]
    tags: list[str]
    completion: QuestCompletion

class QuestStepProgress(TypedDict):
    status: StepStatus
    updatedAt: str | None
    evidence: dict | None

class QuestProgress(TypedDict):
    status: QuestStatus
    steps: dict[str, QuestStepProgress]
    acceptedAt: str | None
    completedAt: str | None
    submittedAt: str | None
    updatedAt: str | None

class QuestCollection(TypedDict):
    schemaVersion: int
    main: QuestProgress
    side: dict[str, QuestProgress]


def blank_progress(definition: QuestDefinition | None = None) -> QuestProgress:
    return {
        'status': 'not-accepted',
        'steps': {step['id']: {'status': 'pending', 'updatedAt': None, 'evidence': None}
                  for step in (definition or {}).get('steps', [])},
        'acceptedAt': None, 'completedAt': None, 'submittedAt': None,
        'updatedAt': None,
    }


def normalize_progress(progress: dict | None, definition: QuestDefinition | None = None) -> QuestProgress:
    """Bring minimal legacy {status} snapshots into the current stable shape."""
    result = blank_progress(definition)
    if not isinstance(progress, dict):
        return result
    if progress.get('status') in STATUSES:
        result['status'] = progress['status']
    existing = progress.get('steps') if isinstance(progress.get('steps'), dict) else {}
    for key, default in result['steps'].items():
        value = existing.get(key)
        if isinstance(value, dict) and value.get('status') in STEP_STATUSES:
            default['status'] = value['status']
            default['updatedAt'] = value.get('updatedAt') if isinstance(value.get('updatedAt'), str) else None
            default['evidence'] = value.get('evidence') if isinstance(value.get('evidence'), dict) else None
    for key in ('acceptedAt', 'completedAt', 'submittedAt', 'updatedAt'):
        value = progress.get(key)
        result[key] = value if isinstance(value, str) else None
    return result


def validate_chapter_definitions(chapters: tuple[dict, ...]) -> None:
    """Fail fast on contradictory content rather than fabricating missing data."""
    for chapter in chapters:
        container = chapter.get('quests') or {}
        quests = ([container['main']] if container.get('main') else []) + list(container.get('side') or [])
        seen = set()
        for task in quests:
            if task['id'] in seen or not task.get('id') or task.get('chapterId') != chapter['id']:
                raise ValueError('Duplicate/invalid quest identifier')
            seen.add(task['id'])
            if task.get('type') not in ('main', 'side'):
                raise ValueError('Invalid quest category')
            if task['type'] == 'main' and task is not container.get('main'):
                raise ValueError('Main quest must use the main slot')
            steps = task.get('steps')
            if not isinstance(steps, list) or len({s['id'] for s in steps}) != len(steps):
                raise ValueError('Quest steps must have unique identifiers')
            if task.get('completion', {}).get('mode') not in ('official-circuit', 'test-only', 'not-implemented'):
                raise ValueError('Quest completion strategy missing')


def validate_quest_state(chapter: dict, state: dict) -> None:
    """Validate persistence shapes without forcing unfinished features to have data.

    A legacy snapshot with only `{status:...}` remains valid.  Unknown task/step
    keys are rejected to prevent accidental phantom quests in new saves.
    """
    tasks = state.get('tasks')
    if tasks is None:
        return  # e.g. circuit-only legacy state
    if not isinstance(tasks, dict):
        raise ValueError('tasks must be an object')
    if 'schemaVersion' in tasks and (type(tasks['schemaVersion']) is not int or tasks['schemaVersion'] != 1):
        raise ValueError('Unsupported quest progress schema version')
    defined = chapter.get('quests') or {}
    allowed_side = {task['id']: task for task in defined.get('side') or []}
    side = tasks.get('side', {})
    if not isinstance(side, dict) or set(side) - set(allowed_side):
        raise ValueError('Unknown or malformed side quest progress')
    main = tasks.get('main')
    if main is not None:
        if defined.get('main') is None and main not in ({}, {'status': 'not-accepted'}):
            raise ValueError('No main quest is defined')
        if not isinstance(main, dict):
            raise ValueError('Malformed main quest progress')
        _check_progress(main, defined.get('main'))
    for key, progress in side.items():
        _check_progress(progress, allowed_side[key])


def _check_progress(progress: dict, definition: dict | None) -> None:
    if not isinstance(progress, dict) or progress.get('status', 'not-accepted') not in STATUSES:
        raise ValueError('Invalid quest status')
    steps = progress.get('steps', {})
    defined_ids = {step['id'] for step in (definition or {}).get('steps', [])}
    if not isinstance(steps, dict) or set(steps) - defined_ids:
        raise ValueError('Unknown/malformed quest steps')
    for value in steps.values():
        if not isinstance(value, dict) or value.get('status') not in STEP_STATUSES:
            raise ValueError('Invalid step progress')
        if value.get('evidence') is not None and not isinstance(value['evidence'], dict):
            raise ValueError('Step evidence must be an object or null')
    for key in ('acceptedAt', 'completedAt', 'submittedAt', 'updatedAt'):
        if key in progress and progress[key] is not None and not isinstance(progress[key], str):
            raise ValueError('Quest timestamp must be a string or null')
