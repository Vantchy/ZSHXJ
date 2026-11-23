/**
 * Mengjin river-gate stage selection. One physical dot; no click counter and
 * no client-only flags. Uses the recorded ordered story quest lifecycle.
 * The saved chapter state is the same canonical snapshot used by task-book.
 */
export const YANWEI_DAY_LOCATION = 'yanwei-riverside-day';
export const TAOSI_LOCATION = 'taosi-old-academy';
export const TAOSI_RETURN_LOCATION = 'taosi-old-academy-return';
export const TAOSI_RETURN_QUEST = 'taosi-chou-handoff';
export const TAOSI_NAND_LOCATION = 'taosi-old-academy-night';
export const TAOSI_NAND_QUEST = 'taosi-nand-first';
export const YANWEI_NIGHT_LOCATION = 'yanwei-riverside-night';
export const YANWEI_DAY_QUEST = 'yanwei-day-four';
export const YANWEI_NIGHT_QUEST = 'yanwei-night-five-six';
export const JADE_LOCATION = 'mengjin-jade-courtyard';
export const DIVINER_LOCATION = 'mengjin-diviner-residence';
export const JADE_QUEST = 'mengjin-jade-mainline';
export const DIVINER_QUEST = 'mengjin-diviner-mainline';
const finished = status => status === 'submitted';

/** 六件事的剧情次序与地图光点的物理位置相互独立。 */
export const YANGCHENG_ARMY_STAGES = Object.freeze([
  Object.freeze({quest:'yangcheng-army-not',locationId:'yangcheng-valley-deception',spotId:'yangcheng-valley-dot'}),
  Object.freeze({quest:'yangcheng-army-and',locationId:'yangcheng-camp-assault',spotId:'yangcheng-camp-dot'}),
  Object.freeze({quest:'yangcheng-army-or',locationId:'yangcheng-camp-supply',spotId:'yangcheng-camp-dot'}),
  Object.freeze({quest:'yangcheng-army-nor',locationId:'yangcheng-valley-bivouac',spotId:'yangcheng-valley-dot'}),
  Object.freeze({quest:'yangcheng-army-xor',locationId:'yangcheng-watch-night',spotId:'yangcheng-watch-dot'}),
  Object.freeze({quest:'yangcheng-army-xnor',locationId:'yangcheng-camp-seal',spotId:'yangcheng-camp-dot'}),
]);
export const YANGCHENG_FIRST_QUEST = 'yangcheng-army-not';

/** 当前未交付的第一件事；六事全交付时停留在末场。 */
export function activeYangchengStage(state) {
  const side=state?.tasks?.side||{};
  return YANGCHENG_ARMY_STAGES.find(stage=>side[stage.quest]?.status!=='submitted') ||
    YANGCHENG_ARMY_STAGES[YANGCHENG_ARMY_STAGES.length-1];
}
/** 允许历史光点仍可点开已做场次，但不越过未解锁的前置关。 */
export function yangchengLocationAtSpot(state, spotId) {
  const stages=YANGCHENG_ARMY_STAGES.filter(item=>item.spotId===spotId);
  if (!stages.length) return null;
  const active=activeYangchengStage(state);
  if (active.spotId===spotId) return active.locationId;
  const completed=[...stages].reverse().find(stage=>state?.tasks?.side?.[stage.quest]?.status==='submitted');
  return completed?.locationId || stages[0].locationId;
}

export function resolveMengjinStageLocation(chapter, state, spot) {
  if (spot?.id?.startsWith('yangcheng-')) return yangchengLocationAtSpot(state,spot.id) || spot.locationId;
  if (spot?.id === 'yanwei-workshop-dot' && spot.locationId === YANWEI_DAY_LOCATION) {
    const hasNight = chapter?.locations?.some(place=>place.id===YANWEI_NIGHT_LOCATION);
    return hasNight && finished(state?.tasks?.side?.[YANWEI_DAY_QUEST]?.status)
      ? YANWEI_NIGHT_LOCATION : YANWEI_DAY_LOCATION;
  }
  if (spot?.id === 'taosi-old-academy-dot' && spot.locationId === TAOSI_LOCATION) {
    const hasReturn = chapter?.locations?.some(place=>place.id===TAOSI_RETURN_LOCATION);
    const hasNand = chapter?.locations?.some(place=>place.id===TAOSI_NAND_LOCATION);
    if (hasNand && finished(state?.tasks?.side?.[TAOSI_RETURN_QUEST]?.status))
      return TAOSI_NAND_LOCATION;
    return hasReturn && finished(state?.tasks?.side?.[YANWEI_NIGHT_QUEST]?.status)
      ? TAOSI_RETURN_LOCATION : TAOSI_LOCATION;
  }
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
  if (finished(side[TAOSI_NAND_QUEST]?.status)) return activeYangchengStage(state).locationId;

  if (finished(side[TAOSI_RETURN_QUEST]?.status)) return TAOSI_NAND_LOCATION;
  if (finished(side[YANWEI_NIGHT_QUEST]?.status)) return TAOSI_RETURN_LOCATION;
  if (finished(side[YANWEI_DAY_QUEST]?.status)) return YANWEI_NIGHT_LOCATION;
  if (finished(side['taosi-three-pages']?.status)) return YANWEI_DAY_LOCATION;
  if (finished(side['mengjin-school-lower']?.status)) return TAOSI_LOCATION;
  if (finished(side[DIVINER_QUEST]?.status)) return 'mengjin-school-courtyard';
  if (finished(side[JADE_QUEST]?.status)) return DIVINER_LOCATION;
  return JADE_LOCATION;
}
