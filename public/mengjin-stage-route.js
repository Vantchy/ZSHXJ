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

/** Resolve the chapter's generic 'enter' button, which has no map-point ID.
 * Unlike the legacy gate-road fallback, this selects the active authored scene.
 * Do not require the room to exist here: showRoom must fail closed if a Python
 * process is still serving an old chapter registry.
 */
export function resolveMengjinDefaultLocation(state) {
  const side = state?.tasks?.side || {};
  if (finished(side['mengjin-school-lower']?.status)) return 'taosi-old-academy';
  if (finished(side[DIVINER_QUEST]?.status)) return 'mengjin-school-courtyard';
  if (finished(side[JADE_QUEST]?.status)) return DIVINER_LOCATION;
  return JADE_LOCATION;
}
