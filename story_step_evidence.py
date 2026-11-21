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


def validate_ordered_evidence(
    definition: dict | None, progress: dict, previous: dict | None = None,
) -> None:
    """Verify NEW completed steps, while preserving immutable legacy proof.

    Called with ``previous`` from the same database transaction as the save.
    A previously completed step may lack evidence from an old project version:
    it can be saved unchanged, but its evidence cannot be inserted, removed,
    or altered by the client. A new ``done`` step always requires evidence
    matching its registered dialogue or level ID. The database separately
    verifies real server-side circuit grades and step order.

    ``previous=None`` performs strict standalone evidence validation (useful
    for content tests and new records); it never grants a legacy exception.
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
    previous_steps = (previous.get('steps')
                      if isinstance(previous, dict) and isinstance(previous.get('steps'), dict)
                      else {})

    for step in definition.get('steps') or ():
        step_id = step.get('id')
        saved = saved_steps.get(step_id)
        if not isinstance(saved, dict) or saved.get('status') != 'done':
            continue

        old = previous_steps.get(step_id)
        if isinstance(old, dict) and old.get('status') == 'done':
            if saved.get('evidence') != old.get('evidence'):
                raise ValueError(f'已完成的任务步骤证据不得修改：{step_id}')
            # Historical completion: no new claim is being made in this save.
            # Never require the user to fabricate evidence for old progress.
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
