import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getChapterOneRegion} from '../public/chapter-one-region-maps.js';
import {activeYangchengStage,resolveMengjinStageLocation,resolveMengjinDefaultLocation,
        yangchengLocationAtSpot,YANGCHENG_ARMY_STAGES} from '../public/mengjin-stage-route.js';
import {STORY_SPOTS,reviewScenesAtSpot,reviewEntryRoute} from '../public/story-spot-review.js';
const region=getChapterOneRegion('yangcheng');
assert(region && region.hotspots.length===3);
assert.deepEqual(region.hotspots.map(s=>s.id),[
  'yangcheng-valley-dot','yangcheng-camp-dot','yangcheng-watch-dot']);
const ids=['not','and','or','nor','xor','xnor'];
const quests=YANGCHENG_ARMY_STAGES.map(s=>s.quest);
assert.deepEqual(quests,ids.map(x=>`yangcheng-army-${x}`));
const state={tasks:{side:{'taosi-nand-first':{status:'submitted'}}}};
const chapter={locations:YANGCHENG_ARMY_STAGES.map(item=>({id:item.locationId}))};
assert.equal(resolveMengjinDefaultLocation(state),'yangcheng-valley-deception');
for(let i=0;i<6;i++){
  const stage=activeYangchengStage(state);
  assert.equal(stage.quest,quests[i]);
  assert.equal(resolveMengjinDefaultLocation(state),stage.locationId);
  const spot=region.hotspots.find(spot=>spot.id===stage.spotId);
  assert.equal(resolveMengjinStageLocation(chapter,state,spot),stage.locationId);
  state.tasks.side[stage.quest]={status:'submitted'};
}
assert.equal(resolveMengjinDefaultLocation(state),'yangcheng-camp-seal');
for(const [spot,expected] of Object.entries({
  'yangcheng-valley-dot':2,'yangcheng-camp-dot':3,'yangcheng-watch-dot':1})){
  assert.equal(STORY_SPOTS[spot].length,expected);
}
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert(app.includes("locationId.startsWith('yangcheng-')"));
assert(app.includes("if (regionId === 'yangcheng')"));
assert(app.includes("location.id.startsWith('yangcheng-') ? 'yangcheng'"));
// A completed formal level appears under this physical dot's task-book review,
// with a validated replay route to the existing editor.
const story=JSON.parse(fs.readFileSync(new URL('../public/story/ch1.json',import.meta.url),'utf8'));
const mockChapter={dialogues:story.dialogues,questTargets:story.questTargets,
  quests:{side:ids.map((name,i)=>({
    id:`yangcheng-army-${name}`,locationId:YANGCHENG_ARMY_STAGES[i].locationId,
    steps:['intro','circuit','report'].map(s=>({id:`army-${name}-${s}`,title:s,
      condition:s==='circuit'?{type:'level-completed',levelId:`ch1_army_${name}`}
        :{type:'dialogue-finished',dialogueId:`army-${name}-${s}`}}))
  }))}};
const completed={tasks:{side:Object.fromEntries(ids.map(name=>[
  `yangcheng-army-${name}`,
  {status:'submitted',steps:Object.fromEntries(['intro','circuit','report'].map(s=>[
    `army-${name}-${s}`,{status:'done'}]))}
]))}};
for(const [spotId,expected] of Object.entries({
  'yangcheng-valley-dot':2,'yangcheng-camp-dot':3,'yangcheng-watch-dot':1})){
  const location=STORY_SPOTS[spotId][0];
  const scenes=reviewScenesAtSpot(mockChapter,completed,location);
  assert.equal(scenes.length,expected);
  for(const scene of scenes){
    assert.deepEqual(scene.entries.map(x=>x.kind),['dialogue','level','dialogue']);
    const level=scene.entries.find(x=>x.kind==='level');
    const route=reviewEntryRoute(scene,level);
    assert.equal(route.catalogLevelId,`ch1_army_${scene.questId.split('-').at(-1)}`);
    assert.equal(route.catalogStepId,level.stepId);
  }
}
console.log('PASS Yangcheng 6 formal story spots, progress router, locator and editor replay');
