/**
 * 归档回顾按小地图上的物理光点分组，而非当前显示的日/夜房间。
 * Quest targets and saved steps are authoritative; this module never writes to state.
 * Keep these aliases aligned with chapter-one-region-maps.js and mengjin-stage-route.js.
 */
import {completedSceneReviewEntries} from './story-review-model.js';

export const STORY_SPOTS = Object.freeze({
  'mengjin-river-gate':Object.freeze(['mengjin-jade-courtyard','mengjin-diviner-residence']),
  'mengjin-inner-court':Object.freeze(['mengjin-school-courtyard']),
  'taosi-old-academy-dot':Object.freeze(['taosi-old-academy','taosi-old-academy-return','taosi-old-academy-night']),
  'yanwei-workshop-dot':Object.freeze(['yanwei-riverside-day','yanwei-riverside-night']),
  'yangcheng-valley-dot':Object.freeze(["yangcheng-valley-deception", "yangcheng-valley-bivouac"]),
  'yangcheng-camp-dot':Object.freeze(["yangcheng-camp-assault", "yangcheng-camp-supply", "yangcheng-camp-seal"]),
  'yangcheng-watch-dot':Object.freeze(["yangcheng-watch-night"]),
  'yin-zhongcun-tent-dot':Object.freeze(["yin-zhongcun-tent"]),
  'yin-zhenxun-road-dot':Object.freeze(["yin-zhenxun-road"]),
  'yin-jingbo-meeting-dot':Object.freeze(["yin-jingbo-meeting"]),
  'yin-jingbo-peach-dot':Object.freeze(["yin-jingbo-peach-dusk", "yin-jingbo-peach-night", "yin-jingbo-peach-cla", "yin-jingbo-peach-vow", "yin-jingbo-peach-wait"]),
  'yin-jingbo-accounts-dot':Object.freeze(["yin-jingbo-accounts"]),
  'yin-zhenxun-hq-dot':Object.freeze(["yin-zhenxun-hq-exam", "yin-zhenxun-hq-war", "yin-zhenxun-hq-insight", "yin-zhenxun-hq-death"]),
});
const SPOT_LABELS = Object.freeze({
  'mengjin-jade-mainline':'日场 · 玉匠铺',
  'mengjin-diviner-mainline':'夜场 · 贞人居所',
  'mengjin-school-upper':'授业学舍 · 上',
  'mengjin-school-lower':'授业学舍 · 下',
  'taosi-three-pages':'子时 · 算稿前三页',
  'taosi-chou-handoff':'丑时 · 旧学舍',
  'taosi-nand-first':'丑时 · 夜制与非门',
  'yanwei-day-four':'日场 · 算稿第四页',
  'yanwei-night-five-six':'夜场 · 算稿五、六页',
  'yangcheng-army-not':'其一·识诈 · 非门',
  'yangcheng-army-and':'其二·会攻 · 与门',
  'yangcheng-army-or':'其三·粮道 · 或门',
  'yangcheng-army-nor':'其四·扎营 · 或非门',
  'yangcheng-army-xor':'其五·夜巡口令 · 异或门',
  'yangcheng-army-xnor':'其六·验符 · 同或门',
  'yin-majority':'寅时·承军与三人表决器',
  'yin-mux':'寅时·山道多路选择器',
  'yin-summit':'寅时·景亳会盟',
  'yin-halfadder':'寅时·桃林半加器',
  'yin-fulladder':'寅时·月下全加器',
  'yin-ripple':'寅时·行波进位四位加法器',
  'yin-cla':'寅时·超前进位四位加法器',
  'yin-final-exam':'寅时·决战前的八位终考',
  'yin-final-vow':'寅时结局·战前之约',
  'yin-final-war':'寅时结局·决战',
  'yin-final-insight':'寅时结局·算完即散',
  'yin-final-wait':'寅时结局·失约',
  'yin-final-death':'寅时结局·寅时终',
});

export function spotIdAtLocation(locationId) {
  for (const [spotId,locations] of Object.entries(STORY_SPOTS)) {
    if (locations.includes(locationId)) return spotId;
  }
  return null;
}

/**
 * 只有整场任务已交付才能“重温本场”。
 * 电路条目按剧情登记的 stepId / levelId 生成，不依赖过去的电路图、
 * 单步历史完成标记或 scene.allowReplay；对白和题板仍使用原完成记录。
 */
export function reviewScenesAtSpot(chapter,state,locationId) {
  if (!chapter || !state || !locationId) return [];
  const spotId=spotIdAtLocation(locationId);
  const locations=spotId ? STORY_SPOTS[spotId] : [locationId];
  const quests=[chapter.quests?.main,...(chapter.quests?.side||[])].filter(Boolean);

  return quests.flatMap(quest=>{
    if (!locations.includes(quest.locationId) ||
        !chapter.questTargets?.[quest.id]?.scene) return [];
    const progress=quest.id===chapter.quests?.main?.id
      ? state.tasks?.main : state.tasks?.side?.[quest.id];
    if (progress?.status!=='submitted') return [];

    const completed=completedSceneReviewEntries(chapter,quest,progress)
      .filter(entry=>entry.kind==='dialogue'||entry.kind==='board');
    const completedByStep=new Map(completed.map(entry=>[entry.stepId,entry]));
    const entries=(quest.steps||[]).flatMap(step=>{
      if (step.condition?.type==='level-completed') {
        const levelId=step.condition.levelId;
        const target=chapter.questTargets[quest.id]?.steps?.[step.id];
        if (levelId && target?.type==='level' && target.id===levelId &&
            chapter.levels?.some(level=>level.id===levelId)) {
          return [{stepId:step.id,title:step.title,kind:'level',targetId:levelId}];
        }
        return [];
      }
      const entry=completedByStep.get(step.id);
      return entry?[entry]:[];
    });
    if (!entries.length) return [];
    return [{questId:quest.id,locationId:quest.locationId,
      title:SPOT_LABELS[quest.id]||quest.title,
      completed:true,entries}];
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
  if (entry.kind==='level') return {
    locationId:scene.locationId,questId:scene.questId,
    catalogLevelId:entry.targetId,catalogStepId:entry.stepId,
  };
  return null;
}
