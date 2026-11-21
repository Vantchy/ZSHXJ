/**
 * Persist just enough metadata to return from a circuit level to the room and
 * the task step from which the player entered. Data lives in the existing
 * chapter progress snapshot (state.questReturn), no new database or API.
 */
const textId = value => typeof value === 'string' && value.length > 0 &&
  value.length < 160 && /^[a-z0-9][a-z0-9._-]*$/i.test(value);

export function makeQuestReturnContext({
  chapterId, locationId, levelId, questId = null, stepId = null, playerX = null,
} = {}) {
  if (![chapterId, locationId, levelId].every(textId) ||
      (questId !== null && !textId(questId)) ||
      (stepId !== null && !textId(stepId))) {
    throw new Error('任务返回信息包含无效的章节、地点或关卡编号');
  }
  return {
    version:1, chapterId, locationId, levelId, questId, stepId,
    playerX:Number.isFinite(playerX) ? playerX : null,
  };
}

export function readQuestReturnContext(value, {
  chapterId, levelId, locations = [],
} = {}) {
  if (!value || value.version !== 1 ||
      value.chapterId !== chapterId || value.levelId !== levelId ||
      !textId(value.locationId) ||
      !Array.isArray(locations) ||
      !locations.some(loc => loc?.id === value.locationId)) return null;

  // The client may keep an old or malformed snapshot. Only trust the
  // chapter's current location registry, never arbitrary route text.
  return {
    version:1, chapterId, locationId:value.locationId, levelId,
    questId:textId(value.questId) ? value.questId : null,
    stepId:textId(value.stepId) ? value.stepId : null,
    playerX:Number.isFinite(value.playerX) ? value.playerX : null,
  };
}

export function resolveReturnLocation(state, chapter, levelId) {
  const context = readQuestReturnContext(state?.questReturn, {
    chapterId:chapter?.id, levelId, locations:chapter?.locations,
  });
  if (context) return context.locationId;
  // Existing saves had only locationId. Preserve that route as the fallback,
  // but never send a player to a non-existent location.
  const oldId = state?.locationId;
  if (chapter?.locations?.some(loc => loc.id === oldId)) return oldId;
  return chapter?.locations?.[0]?.id || null;
}
