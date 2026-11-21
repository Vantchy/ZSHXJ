/**
 * Workshop adapter: preserve all v0.9 imports, IDs, stage names and save format.
 * The reusable ordered-step rules live in quest-flow.js.
 *
 * Do not rename/delete this file yet: room.js and app.js still import it.
 */
import {
  normalizeFlowProgress,
  finishFlowDialogue, syncFlowOfficialPass,
} from './quest-flow.js';

export const WORKSHOP_ID = 'binary-decoder';
export const WORKSHOP_INTRO = 'listen-workshop';
export const WORKSHOP_LEVEL = 'decode-four-combinations';
export const WORKSHOP_REPORT = 'report-workshop';

export function isWorkshopQuest(quest) {
  return quest?.id === WORKSHOP_ID && quest.completion?.requireAllSteps === true;
}

export function workshopStage(progress) {
  if (progress?.steps?.[WORKSHOP_INTRO]?.status !== 'done') return 'intro';
  if (progress?.steps?.[WORKSHOP_LEVEL]?.status !== 'done') return 'exercise';
  if (progress?.steps?.[WORKSHOP_REPORT]?.status !== 'done') return 'report';
  return 'done';
}

export function normalizeWorkshopProgress(progress, quest) {
  return normalizeFlowProgress(progress, quest);
}

export function finishWorkshopDialogue(progress, quest, stepId) {
  const normalized = normalizeWorkshopProgress(progress, quest);
  const expected = stepId === WORKSHOP_INTRO ? 'intro' : 'report';
  if (![WORKSHOP_INTRO, WORKSHOP_REPORT].includes(stepId) ||
      workshopStage(normalized) !== expected) return normalized;
  const dialogueId = quest.steps.find(step => step.id === stepId)?.condition?.dialogueId;
  if (!dialogueId) return normalized;
  // Preserve the previous workshop-specific warning exactly.
  if (normalized.status === 'not-accepted') throw new Error('请先接取玉匠铺任务。');
  return finishFlowDialogue(normalized, quest, {stepId, dialogueId});
}

export function workshopProgressWithPass(progress, quest, results) {
  return syncFlowOfficialPass(progress, quest, results);
}
