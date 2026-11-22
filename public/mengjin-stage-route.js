/**
 * Mengjin river-gate stage selection. One physical dot; no click counter and
 * no client-only flags. Uses the recorded ordered story quest lifecycle.
 * The saved chapter state is the same canonical snapshot used by task-book.
 */
export const JADE_LOCATION = 'mengjin-jade-courtyard';
export const DIVINER_LOCATION = 'mengjin-diviner-residence';
export const JADE_QUEST = 'mengjin-jade-mainline';
export const DIVINER_QUEST = 'mengjin-diviner-mainline';
const finished = status => status === 'submitted';
export function resolveMengjinStageLocation(chapter, state, spot) {
  if (spot?.id !== 'mengjin-river-gate' || spot.locationId !== JADE_LOCATION)
    return spot?.locationId ?? null;
  const jade = chapter?.quests?.side?.find(q => q.id === JADE_QUEST);
  const diviner = chapter?.locations?.find(place => place.id === DIVINER_LOCATION);
  if (!jade || !diviner) return JADE_LOCATION;
  const progress = state?.tasks?.side?.[JADE_QUEST];
  return finished(progress?.status) ? DIVINER_LOCATION : JADE_LOCATION;
}
