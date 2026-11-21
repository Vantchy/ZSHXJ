/** 玉匠铺样板的进度规则。对白回看不调用这些写入函数；成绩只接受正式测评记录。 */
import {normalizeQuestProgress, changeQuestStatus} from './task-model.js';

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
  const next = normalizeQuestProgress(progress, quest);
  // Keep old done steps and lifecycle statuses. A v0.8 pass still needs the
  // newly added dialogue, but never loses its circuit or formal score.
  let found = false;
  for (const step of quest.steps) {
    const item = next.steps[step.id];
    if (item.status === 'done') continue;
    item.status = found ? 'pending' : 'current';
    found = true;
  }
  return next;
}

export function finishWorkshopDialogue(progress, quest, stepId) {
  const next = normalizeWorkshopProgress(progress, quest);
  const expected = stepId === WORKSHOP_INTRO ? 'intro' : 'report';
  if (![WORKSHOP_INTRO, WORKSHOP_REPORT].includes(stepId) || workshopStage(next) !== expected) return next;
  if (next.status === 'not-accepted') throw new Error('请先接取玉匠铺任务。');
  const now = new Date().toISOString();
  next.steps[stepId] = {status:'done', updatedAt:now,
    evidence:{type:'dialogue-finished', dialogueId:quest.steps.find(s => s.id === stepId).condition.dialogueId}};
  next.updatedAt = now;
  const result = normalizeWorkshopProgress(next, quest);
  return workshopStage(result) === 'done' && result.status === 'accepted'
    ? changeQuestStatus(result, 'completed') : result;
}

export function workshopProgressWithPass(progress, quest, results) {
  const next = normalizeWorkshopProgress(progress, quest);
  if (workshopStage(next) !== 'exercise' || next.status === 'not-accepted') return next;
  const levelId = quest.steps.find(step => step.id === WORKSHOP_LEVEL).condition.levelId;
  const proof = results.find(row => row.levelId === levelId && row.completed === true && row.assessmentType === 'circuit_server');
  if (!proof) return next;
  const now = new Date().toISOString();
  next.steps[WORKSHOP_LEVEL] = {status:'done', updatedAt:now,
    evidence:{levelId, assessmentType:'circuit_server'}};
  next.updatedAt = now;
  return normalizeWorkshopProgress(next, quest);
}
