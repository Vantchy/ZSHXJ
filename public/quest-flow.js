/**
 * Ordered quest flow: shared logic for dialogue -> verified level -> report.
 *
 * All functions return a fresh normalized snapshot; never change the caller's
 * saved object, never grant rewards, and never write the database directly.
 * The existing chapter save endpoint remains the authority for transitions
 * and formal circuit score evidence.
 *
 * Designed for completion.requireAllSteps === true. Quest IDs, step IDs,
 * dialogue IDs and level IDs always come from the quest definition.
 */
import {normalizeQuestProgress, changeQuestStatus} from './task-model.js';

const hasOrderedSteps = (quest) =>
  quest?.completion?.requireAllSteps === true &&
  Array.isArray(quest?.steps) && quest.steps.length > 0;

const stepsOf = (quest) => hasOrderedSteps(quest) ? quest.steps : [];

export function firstIncompleteFlowStep(progress, quest) {
  return stepsOf(quest).find(step => progress?.steps?.[step.id]?.status !== 'done') || null;
}

export function flowIsDone(progress, quest) {
  return hasOrderedSteps(quest) && !firstIncompleteFlowStep(progress, quest);
}

/**
 * Normalize an old save without erasing completed steps or lifecycle status.
 *
 * Matches the previous workshop implementation: the first non-done step is
 * current, every later non-done step is pending (including old skipped rows).
 * Old formal scores are never invented from local save data.
 */
export function normalizeFlowProgress(progress, quest) {
  const next = normalizeQuestProgress(progress, quest);
  if (!hasOrderedSteps(quest)) return next;
  let foundCurrent = false;
  for (const step of quest.steps) {
    const item = next.steps[step.id];
    if (item.status === 'done') continue;
    item.status = foundCurrent ? 'pending' : 'current';
    foundCurrent = true;
  }
  return next;
}

/** Return the configured target for the current step; no hard-coded level. */
export function currentFlowTarget(progress, quest, questTargets) {
  const step = firstIncompleteFlowStep(progress, quest);
  if (!step) return null;
  const target = questTargets?.steps?.[step.id];
  if (!target || !['dialogue','level'].includes(target.type) ||
      typeof target.id !== 'string' || !target.id) return null;
  return {stepId:step.id, type:target.type, id:target.id,
          title:typeof target.title === 'string' ? target.title : ''};
}

/**
 * Mark exactly one active dialogue step complete.
 *
 * Caller must invoke this only after the dialogue player's *normal* finished
 * callback, not after "previous sentence", replay, or early close.
 * `dialogueId` must match the definition's completion condition.
 *
 * The server still validates the saved state; this is UI progress management,
 * not a proof that a human read the text.
 */
export function finishFlowDialogue(progress, quest, {stepId, dialogueId}) {
  const next = normalizeFlowProgress(progress, quest);
  if (!hasOrderedSteps(quest)) return next;
  const step = firstIncompleteFlowStep(next, quest);
  if (!step || step.id !== stepId ||
      step.condition?.type !== 'dialogue-finished' ||
      step.condition.dialogueId !== dialogueId) return next;
  if (next.status === 'not-accepted') throw new Error('请先接取当前剧情任务。');
  const now = new Date().toISOString();
  next.steps[step.id] = {
    status:'done', updatedAt:now,
    evidence:{type:'dialogue-finished', dialogueId:step.condition.dialogueId},
  };
  next.updatedAt = now;
  const result = normalizeFlowProgress(next, quest);
  return flowIsDone(result, quest) && result.status === 'accepted'
    ? changeQuestStatus(result, 'completed') : result;
}

/**
 * Only accept an actual formal server score for the *active* level step.
 * Local tests, other level IDs and failed assessments do not advance it.
 * The backend will re-check the real circuit score when the state is saved.
 */
export function syncFlowOfficialPass(progress, quest, results) {
  const next = normalizeFlowProgress(progress, quest);
  if (!hasOrderedSteps(quest) || next.status === 'not-accepted') return next;
  const step = firstIncompleteFlowStep(next, quest);
  if (!step || step.condition?.type !== 'level-completed') return next;
  const levelId = step.condition.levelId;
  if (!levelId || !Array.isArray(results) || !results.some(row =>
    row?.levelId === levelId &&
    row.completed === true &&
    row.assessmentType === 'circuit_server'
  )) return next;

  const now = new Date().toISOString();
  next.steps[step.id] = {
    status:'done', updatedAt:now,
    evidence:{levelId, assessmentType:'circuit_server'},
  };
  next.updatedAt = now;
  // Preserve v0.9 semantics: a score synchronizer only completes its step.
  // Final quest completion occurs at the final dialogue (or at a separately
  // defined terminal action), never as a hidden effect of polling scores.
  return normalizeFlowProgress(next, quest);
}
