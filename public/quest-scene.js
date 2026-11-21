/**
 * Data-driven NPC scene adapter for authored, ordered quests.
 *
 * The quest's step IDs, dialogue entries, report, replay and button labels come
 * from chapter.questTargets[quest.id].scene. No workshop ID, level or paragraph
 * is hard-coded here. Progress and evidence belong to quest-flow /
 * quest-dialogue-event; this module only selects interactions.
 */
import {firstIncompleteFlowStep} from './quest-flow.js';

export function sceneConfig(chapter, quest, locationId = null) {
  if (!quest || quest.completion?.requireAllSteps !== true ||
      !Array.isArray(quest.steps) || !quest.steps.length ||
      (locationId && quest.locationId && quest.locationId !== locationId)) return null;
  const scene = chapter?.questTargets?.[quest.id]?.scene;
  return scene && typeof scene === 'object' && !Array.isArray(scene) ? scene : null;
}

export function sceneQuestAtLocation(chapter, locationId) {
  const definitions = [chapter?.quests?.main, ...(chapter?.quests?.side || [])];
  return definitions.find(quest => sceneConfig(chapter, quest, locationId)) || null;
}

export function sceneProgress(state, chapter, quest) {
  return quest?.id === chapter?.quests?.main?.id
    ? state?.tasks?.main : state?.tasks?.side?.[quest?.id];
}

export function activeSceneStep(quest, progress) {
  return firstIncompleteFlowStep(progress, quest);
}

export function sceneHint(chapter, quest, progress) {
  const step = activeSceneStep(quest, progress);
  const scene = sceneConfig(chapter, quest);
  return scene?.hints?.[step?.id || 'done'] || quest?.hint || quest?.title || '';
}

export function sceneCheckpoint(chapter, quest, kind, stepId = null) {
  const checkpoints = sceneConfig(chapter, quest)?.checkpoints || {};
  if (kind === 'step') return checkpoints.steps?.[stepId] ||
    `quest_dialogue_${quest.id}_${stepId}_finished`;
  return checkpoints[kind] || `quest_${quest.id}_${kind}`;
}

export function sceneDialogueContext(chapter, quest, progress, {review = false} = {}) {
  const scene = sceneConfig(chapter, quest);
  if (!scene) return null;
  if (review) {
    const entryId = scene.reviewEntryId ||
      chapter.questTargets?.[quest.id]?.review?.id;
    return entryId ? {kind:'scene-review', questId:quest.id, stepId:null, entryId} : null;
  }
  const step = activeSceneStep(quest, progress);
  const target = step && chapter.questTargets[quest.id]?.steps?.[step.id];
  let entryId;
  if (step?.condition?.type === 'dialogue-finished') {
    entryId = target?.type === 'dialogue' ? target.id : null;
  } else if (step?.condition?.type === 'level-completed') {
    entryId = scene.supportingDialogues?.[step.id];
  } else if (!step) {
    entryId = chapter.questTargets[quest.id]?.review?.id;
  }
  return entryId ? {kind:'scene-flow', questId:quest.id,
    stepId:step?.id || null, entryId} : null;
}

export function sceneEndActions(chapter, quest, progress, context) {
  const scene = sceneConfig(chapter, quest);
  if (!scene || context?.questId !== quest.id) return [];
  const step = activeSceneStep(quest, progress);
  const key = context.kind === 'scene-review' ? 'review' : step?.id || 'done';
  // A stale screen must never acquire buttons for a different story step.
  if (context.kind !== 'scene-review' && context.stepId !== (step?.id || null)) return [];
  return Array.isArray(scene.actions?.[key]) ? scene.actions[key] : [];
}

export function sceneLevelStep(quest, progress, {replay = false} = {}) {
  if (!replay) {
    const step = activeSceneStep(quest, progress);
    return step?.condition?.type === 'level-completed' ? step : null;
  }
  return quest?.steps?.find(step => step.condition?.type === 'level-completed') || null;
}

export function sceneReviewTarget(chapter, quest, locationId) {
  const scene = sceneConfig(chapter, quest, locationId);
  const review = chapter?.questTargets?.[quest.id]?.review;
  return scene && review?.type === 'dialogue' ? review : null;
}
