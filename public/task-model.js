/**
 * Task state model. Definitions are delivered by /api/chapters; this module
 * normalizes persisted progress and applies test-only step updates.
 *
 * @typedef {'not-accepted'|'accepted'|'completed'|'submitted'} QuestStatus
 * @typedef {'pending'|'current'|'done'|'skipped'} StepStatus
 * @typedef {{id:string,title:string,description:string,condition:object|null}} QuestStepDefinition
 * @typedef {{mode:'official-circuit'|'test-only'|'not-implemented',levelIds:string[]}} QuestCompletion
 * @typedef {{id:string,type:'main'|'side',title:string,description:string,hint:string,
 *   chapterId:string,locationId:string|null,steps:QuestStepDefinition[],prerequisites:string[],
 *   rewards:object[],tags:string[],completion:QuestCompletion}} QuestDefinition
 * @typedef {{status:StepStatus,updatedAt:string|null,evidence:object|null}} StepProgress
 * @typedef {{status:QuestStatus,steps:Record<string,StepProgress>,acceptedAt:string|null,
 *   completedAt:string|null,submittedAt:string|null,updatedAt:string|null}} QuestProgress
 * @typedef {{schemaVersion:1,main:QuestProgress,side:Record<string,QuestProgress>}} QuestCollection
 */

export const QUEST_STATUSES = Object.freeze(['not-accepted', 'accepted', 'completed', 'submitted']);
export const STEP_STATUSES = Object.freeze(['pending', 'current', 'done', 'skipped']);
const TRANSITIONS = Object.freeze({
  'not-accepted': ['accepted'], accepted: ['completed'], completed: ['submitted'], submitted: [],
});
const isRecord = value => value != null && typeof value === 'object' && !Array.isArray(value);
const stringOrNull = value => typeof value === 'string' ? value : null;
const utcNow = () => new Date().toISOString();

/** @returns {QuestProgress} */
export function emptyQuestProgress(quest = null) {
  const steps = {};
  for (const step of quest?.steps || []) {
    steps[step.id] = {status:'pending',updatedAt:null,evidence:null};
  }
  return {status:'not-accepted',steps,acceptedAt:null,completedAt:null,
          submittedAt:null,updatedAt:null};
}

/** @returns {QuestProgress} */
export function normalizeQuestProgress(data, quest = null) {
  const out = emptyQuestProgress(quest);
  if (!isRecord(data)) return out;
  if (QUEST_STATUSES.includes(data.status)) out.status = data.status;
  const incoming = isRecord(data.steps) ? data.steps : {};
  for (const [id, fallback] of Object.entries(out.steps)) {
    const saved = incoming[id];
    if (isRecord(saved) && STEP_STATUSES.includes(saved.status)) {
      out.steps[id] = {
        status:saved.status,
        updatedAt:stringOrNull(saved.updatedAt),
        evidence:isRecord(saved.evidence) ? saved.evidence : null,
      };
    } else out.steps[id] = fallback;
  }
  for (const key of ['acceptedAt','completedAt','submittedAt','updatedAt']) {
    out[key] = stringOrNull(data[key]);
  }
  return out;
}

/** @returns {QuestCollection} */
export function normalizeQuestCollection(data, definitions = {}) {
  const input = isRecord(data) ? data : {};
  const side = {};
  for (const quest of definitions.side || []) {
    side[quest.id] = normalizeQuestProgress(input.side?.[quest.id], quest);
  }
  return {
    schemaVersion:1,
    main:normalizeQuestProgress(input.main, definitions.main || null),
    side,
  };
}

/** @returns {QuestProgress} */
export function changeQuestStatus(progress, status) {
  if (!TRANSITIONS[progress.status]?.includes(status)) {
    throw new Error(`Invalid quest transition: ${progress.status} -> ${status}`);
  }
  const now = utcNow();
  const next = {...progress, steps:Object.fromEntries(
    Object.entries(progress.steps || {}).map(([id, item]) => [id, {...item}])
  ), status, updatedAt:now};
  if (status === 'accepted') {
    next.acceptedAt = now;
    const first = Object.values(next.steps).find(item => item.status === 'pending');
    if (first) first.status = 'current';
  }
  if (status === 'completed') next.completedAt = now;
  if (status === 'submitted') next.submittedAt = now;
  return next;
}

/** Return a separate snapshot; never invent completion for an unfinished quest. */
export function advanceTestStep(progress, definition) {
  if (definition?.completion?.mode !== 'test-only' || progress.status !== 'accepted') {
    throw new Error('Only accepted test-only quests can advance steps manually');
  }
  const copy = normalizeQuestProgress(progress, definition);
  const steps = definition.steps || [];
  const current = steps.find(step => !['done','skipped'].includes(copy.steps[step.id]?.status));
  if (!current) return copy;
  const now = utcNow();
  copy.steps[current.id] = {...copy.steps[current.id],status:'done',updatedAt:now};
  const upcoming = steps.find(step => copy.steps[step.id]?.status === 'pending');
  if (upcoming) copy.steps[upcoming.id] = {...copy.steps[upcoming.id],status:'current',updatedAt:now};
  else {
    copy.status = 'completed';
    copy.completedAt = now;
  }
  copy.updatedAt = now;
  return copy;
}

export function currentTestStep(quest, progress) {
  if (quest?.completion?.mode !== 'test-only' || progress?.status !== 'accepted') return null;
  return (quest.steps || []).find(step =>
    ['pending','current'].includes(progress.steps?.[step.id]?.status)) || null;
}
