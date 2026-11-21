/**
 * Generic task-book destination resolver.
 * Pure rules: never change progress, trigger a level, or grant completion.
 * All IDs come from the loaded chapter's quest and destination definitions.
 */
import {questPrerequisitesSatisfied} from './task-model.js';

const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

/** Follow authored dialogue choices, without interpreting narrative text. */
export function dialogueTargetReachable(dialogues, startingId, endingId) {
  if (!Array.isArray(dialogues)) return false;
  const nodes = new Map(dialogues.filter(node => node?.id).map(node => [node.id, node]));
  if (!nodes.has(startingId) || !nodes.has(endingId)) return false;
  const visited = new Set();
  const pending = [startingId];
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === endingId) return !nodes.get(id)?.options?.length;
    for (const choice of nodes.get(id)?.options || []) {
      if (choice?.target?.type === 'dialogue' && nodes.has(choice.target.id)) {
        pending.push(choice.target.id);
      }
    }
  }
  return false;
}

export function resolveQuestDestination({
  entry, chapter, state, locationId,
  canGoToLevel = false, reviewTarget = null,
} = {}) {
  if (!entry?.quest || !entry?.progress) return {reason:'暂无任务'};
  const quest = entry.quest;
  const progress = entry.progress;
  if (!questPrerequisitesSatisfied(chapter, state, quest)) {
    return {reason:'请先完成前置任务'};
  }
  // Both dialogue and level targets must stay inside the quest's location.
  if (quest.locationId && quest.locationId !== locationId) {
    return {reason:'请先前往任务对应地点'};
  }

  const ordered = quest.completion?.requireAllSteps === true;
  const steps = Array.isArray(quest.steps) ? quest.steps : [];
  const currentStep = ordered
    ? steps.find(step => progress.steps?.[step.id]?.status !== 'done')
    : (steps.find(step => progress.steps?.[step.id]?.status === 'current')
      || steps.find(step => !['done', 'skipped'].includes(progress.steps?.[step.id]?.status)));
  const stepId = currentStep?.id || null;

  // Finished ordered quests may expose a configured review action.
  if (ordered && !currentStep) {
    const configuredReview = chapter?.questTargets?.[quest.id]?.review;
    if (reviewTarget && reviewTarget.type === 'dialogue' && nonempty(reviewTarget.id) &&
        configuredReview?.type === 'dialogue' && configuredReview.id === reviewTarget.id &&
        chapter?.dialogues?.some(item => item.id === reviewTarget.id)) {
      return {
        target:{...reviewTarget, title:reviewTarget.title || '重温已完成剧情'},
        questId:quest.id, stepId:null, locationId,
      };
    }
    return {reason:'此任务已完成'};
  }

  const configured = chapter?.questTargets?.[quest.id];
  const target = configured?.steps ? configured.steps[stepId] : configured;
  if (!isObject(target) || !nonempty(target.id)) {
    return {reason:'此任务暂未配置可前往的目标'};
  }
  const title = nonempty(target.title) ? target.title : '';

  if (target.type === 'level') {
    const level = chapter?.levels?.find(item => item.id === target.id);
    if (!level || !canGoToLevel) return {reason:'此关卡暂不可进入'};
    if (quest.completion?.mode !== 'official-circuit' ||
        !quest.completion?.levelIds?.includes(target.id)) {
      return {reason:'此关卡尚未关联到该任务'};
    }
    // An ordered quest may have several levels: the selected target must match
    // the first unfinished step's configured completion condition.
    if (ordered && currentStep?.condition?.type !== 'level-completed') {
      return {reason:'此任务的关卡步骤配置不匹配'};
    }
    if (ordered && currentStep?.condition?.levelId !== target.id) {
      return {reason:'此任务的关卡步骤配置不匹配'};
    }
    return {
      target:{...target, title:title || level.title || '进入关卡'},
      level, questId:quest.id, stepId, locationId,
    };
  }

  if (target.type === 'dialogue') {
    if (!Array.isArray(chapter?.dialogues) ||
        !chapter.dialogues.some(item => item.id === target.id)) {
      return {reason:'此对白尚未接入当前场景'};
    }
    if (ordered && (currentStep?.condition?.type !== 'dialogue-finished' ||
        !dialogueTargetReachable(chapter.dialogues, target.id, currentStep.condition.dialogueId))) {
      return {reason:'此任务的对白步骤配置不匹配'};
    }
    // Only a real playback finish event can complete the reachable ending;
    // this resolver never changes any task progress.
    return {
      target:{...target, title:title || '与人物交谈'},
      questId:quest.id, stepId, locationId,
    };
  }

  return {reason:'此任务的互动尚未开放'};
}
