/**
 * 归档回顾按小地图上的物理光点分组，而非当前显示的日/夜房间。
 * Quest targets and saved steps are authoritative; this module never writes to state.
 * Keep these aliases aligned with chapter-one-region-maps.js and mengjin-stage-route.js.
 */
import {completedSceneReviewEntries} from './story-review-model.js';

export const STORY_SPOTS = Object.freeze({
  'mengjin-river-gate':Object.freeze(['mengjin-jade-courtyard','mengjin-diviner-residence']),
  'mengjin-inner-court':Object.freeze(['mengjin-school-courtyard']),
  'taosi-old-academy-dot':Object.freeze(['taosi-old-academy','taosi-old-academy-return']),
  'yanwei-workshop-dot':Object.freeze(['yanwei-riverside-day','yanwei-riverside-night']),
});
const SPOT_LABELS = Object.freeze({
  'mengjin-jade-mainline':'日场 · 玉匠铺',
  'mengjin-diviner-mainline':'夜场 · 贞人居所',
  'mengjin-school-upper':'授业学舍 · 上',
  'mengjin-school-lower':'授业学舍 · 下',
  'taosi-three-pages':'子时 · 算稿前三页',
  'taosi-chou-handoff':'丑时 · 旧学舍',
  'yanwei-day-four':'日场 · 算稿第四页',
  'yanwei-night-five-six':'夜场 · 算稿五、六页',
});

export function spotIdAtLocation(locationId) {
  for (const [spotId,locations] of Object.entries(STORY_SPOTS)) {
    if (locations.includes(locationId)) return spotId;
  }
  return null;
}

/** Includes only author-registered *finished steps*. Active and locked steps are never exposed. */
export function reviewScenesAtSpot(chapter,state,locationId) {
  const spotId=spotIdAtLocation(locationId);
  if (!spotId) return [];
  const locations=STORY_SPOTS[spotId];
  const side=state?.tasks?.side||{};
  return (chapter?.quests?.side||[]).flatMap(quest=>{
    if (!locations.includes(quest.locationId) || !chapter?.questTargets?.[quest.id]?.scene)
      return [];
    const progress=side[quest.id];
    const entries=completedSceneReviewEntries(chapter,quest,progress)
      .filter(entry=>entry.kind==='dialogue'||entry.kind==='board');
    if (!entries.length) return [];
    return [{questId:quest.id,locationId:quest.locationId,
      title:SPOT_LABELS[quest.id]||quest.title,
      completed:progress?.status==='submitted',entries}];
  });
}

/** Validated against a model-generated entry; never use a free-form target ID. */
export function reviewEntryRoute(scene,entry) {
  if (!scene || !scene.entries?.includes(entry)) return null;
  if (entry.kind==='dialogue') return {
    locationId:scene.locationId,questId:scene.questId,catalogEntryId:entry.targetId,
  };
  if (entry.kind==='board') return {
    locationId:scene.locationId,questId:scene.questId,catalogBoardId:entry.targetId,
  };
  return null;
}
