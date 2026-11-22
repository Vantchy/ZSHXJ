"""Validate new ordered-story step evidence without altering old evidence."""
from __future__ import annotations
from story_board_rules import valid_board_answers


def validate_ordered_evidence(definition: dict | None, progress: dict, previous: dict | None = None) -> None:
    if not isinstance(definition, dict) or (definition.get('completion') or {}).get('requireAllSteps') is not True:
        return
    if not isinstance(progress, dict) or not isinstance(progress.get('steps'), dict):
        return
    saved_steps = progress['steps']
    prev_steps = (previous.get('steps') if isinstance(previous, dict) and
                  isinstance(previous.get('steps'), dict) else {})
    for step in definition.get('steps') or ():
        step_id = step.get('id')
        saved = saved_steps.get(step_id)
        if not isinstance(saved, dict) or saved.get('status') != 'done':
            continue
        old = prev_steps.get(step_id)
        if isinstance(old, dict) and old.get('status') == 'done':
            if saved.get('evidence') != old.get('evidence'):
                raise ValueError(f'已完成的任务步骤证据不得修改：{step_id}')
            continue
        condition = step.get('condition') or {}
        if not isinstance(condition, dict):
            continue
        kind = condition.get('type')
        if kind not in ('dialogue-finished', 'level-completed'):
            continue
        evidence = saved.get('evidence')
        if not isinstance(evidence, dict):
            raise ValueError(f'已完成的任务步骤缺少证据：{step_id}')
        if kind == 'dialogue-finished':
            if not (isinstance(condition.get('dialogueId'), str) and condition['dialogueId'] and
                    evidence.get('type') == 'dialogue-finished' and
                    evidence.get('dialogueId') == condition['dialogueId']):
                raise ValueError(f'剧情对白证据与任务定义不一致：{step_id}')
            board_id = condition.get('boardId')
            if board_id and (evidence.get('boardId') != board_id or
                             not valid_board_answers(board_id, evidence.get('boardAnswers'))):
                raise ValueError(f'教学题板没有通过服务端校验：{step_id}')
        elif kind == 'level-completed':
            if (not isinstance(condition.get('levelId'), str) or
                    evidence.get('levelId') != condition.get('levelId') or
                    evidence.get('assessmentType') != 'circuit_server'):
                raise ValueError(f'电路关卡证据与任务定义不一致：{step_id}')
