"""Validate ordered story-step evidence against the actual quest definition.

This module is deliberately shared and stateless: it does not create an extra
story database or grant quest completion. The existing database transaction
continues to check step order, grade ownership, lifecycle transitions and
revision conflicts.

Important security boundary: a client-provided dialogue-finished claim is not
proof that the text was read. This layer checks that the claim is about the
correct dialogue and step; server-issued playback tickets would be needed to
prove a server-authorized playback session.
"""
from __future__ import annotations


def validate_ordered_evidence(definition: dict | None, progress: dict) -> None:
    """Reject mismatched evidence for completed steps of an ordered quest.

    Existing quests without ``completion.requireAllSteps`` keep their old
    validation behavior. Paused steps, old circuit-only saves and optional
    workflow fields are left untouched.
    """
    if not isinstance(definition, dict):
        return
    completion = definition.get('completion') or {}
    if completion.get('requireAllSteps') is not True:
        return
    if not isinstance(progress, dict):
        return
    saved_steps = progress.get('steps')
    if not isinstance(saved_steps, dict):
        return  # The outer quest_model validator handles malformed shapes.

    for step in definition.get('steps') or ():
        step_id = step.get('id')
        saved = saved_steps.get(step_id)
        if not isinstance(saved, dict) or saved.get('status') != 'done':
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
            dialogue_id = condition.get('dialogueId')
            if (not isinstance(dialogue_id, str) or not dialogue_id or
                    evidence.get('type') != 'dialogue-finished' or
                    evidence.get('dialogueId') != dialogue_id):
                raise ValueError(f'剧情对白证据与任务定义不一致：{step_id}')
        elif kind == 'level-completed':
            level_id = condition.get('levelId')
            if (not isinstance(level_id, str) or not level_id or
                    evidence.get('levelId') != level_id or
                    evidence.get('assessmentType') != 'circuit_server'):
                raise ValueError(f'电路关卡证据与任务定义不一致：{step_id}')
