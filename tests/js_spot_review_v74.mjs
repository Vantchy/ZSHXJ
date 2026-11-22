import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {STORY_SPOTS,spotIdAtLocation,reviewScenesAtSpot,reviewEntryRoute}
  from '../public/story-spot-review.js';
import {MENGJIN_ACTS} from '../public/mengjin-story-catalog.js';
import {CHAPTER_ONE_REGIONS} from '../public/chapter-one-region-maps.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const story=JSON.parse(fs.readFileSync(path.join(root,'public/story/ch1.json'),'utf8'));
const room=fs.readFileSync(path.join(root,'public/room.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const byQuest=new Map();
const locationByQuest={
 'mengjin-jade-mainline':'mengjin-jade-courtyard',
 'mengjin-diviner-mainline':'mengjin-diviner-residence',
 'mengjin-school-upper':'mengjin-school-courtyard',
 'mengjin-school-lower':'mengjin-school-courtyard',
 'taosi-three-pages':'taosi-old-academy',
 'taosi-chou-handoff':'taosi-old-academy-return',
 'yanwei-day-four':'yanwei-riverside-day',
 'yanwei-night-five-six':'yanwei-riverside-night',
};
for(const act of MENGJIN_ACTS){
 if(!byQuest.has(act.quest))byQuest.set(act.quest,{
   id:act.quest,locationId:act.locationId,steps:[],
 });
 const q=byQuest.get(act.quest);
 assert.equal(q.locationId,locationByQuest[act.quest]);
 q.steps.push({id:act.step,title:act.title,
   condition:{dialogueId:act.entryId||story.questTargets[act.quest].steps[act.step].id,
     ...(act.boardId ? {boardId:act.boardId}:{} )}});
}
const chapter={quests:{side:[...byQuest.values()]},questTargets:story.questTargets,dialogues:story.dialogues};
const state={tasks:{side:{}}};
const makeDone=(id)=>{
 const q=byQuest.get(id);
 state.tasks.side[id]={status:'submitted',steps:Object.fromEntries(q.steps.map(step=>[step.id,{status:'done'}]))};
};
const snapshot=()=>JSON.stringify(state);
// Physical map points cover all staged scene variants, not just the static spot.locationId.
const ids=new Set(CHAPTER_ONE_REGIONS.flatMap(r=>r.hotspots.map(s=>s.id)));
assert.deepEqual(Object.keys(STORY_SPOTS).sort(),[...ids].sort());
for(const [spot,locations] of Object.entries(STORY_SPOTS)){
  assert(ids.has(spot));
  for(const location of locations)assert.equal(spotIdAtLocation(location),spot);
}
assert.equal(spotIdAtLocation('gate-road'),null);
for(const act of MENGJIN_ACTS)assert(spotIdAtLocation(act.locationId),`剧情目录未归入光点: ${act.locationId}`);
assert.deepEqual(reviewScenesAtSpot(chapter,state,'mengjin-diviner-residence'),[]);
// Mengjin river gate: old daytime jade scene remains selectable while currently in night diviner.
makeDone('mengjin-jade-mainline');
const checkpoint0=snapshot();
let scenes=reviewScenesAtSpot(chapter,state,'mengjin-diviner-residence');
assert.deepEqual(scenes.map(s=>s.questId),['mengjin-jade-mainline']);
assert.equal(scenes[0].title,'日场 · 玉匠铺');
assert.equal(scenes[0].entries.length,4);
let dayBoard=scenes[0].entries.find(item=>item.kind==='board');
assert.deepEqual(reviewEntryRoute(scenes[0],dayBoard),{
  locationId:'mengjin-jade-courtyard',questId:'mengjin-jade-mainline',catalogBoardId:'mengjin-jade-sixbit',
});
assert.equal(JSON.stringify(state),checkpoint0);
makeDone('mengjin-diviner-mainline');
scenes=reviewScenesAtSpot(chapter,state,'mengjin-jade-courtyard');
assert.deepEqual(scenes.map(s=>s.title),['日场 · 玉匠铺','夜场 · 贞人居所']);
const nightDialogue=scenes[1].entries.find(item=>item.kind==='dialogue');
assert.deepEqual(reviewEntryRoute(scenes[1],nightDialogue),{
  locationId:'mengjin-diviner-residence',questId:'mengjin-diviner-mainline',catalogEntryId:'mengjin-diviner-intro',
});
// School: both upper/lower stories live at one spot with no room change needed.
makeDone('mengjin-school-upper'); makeDone('mengjin-school-lower');
scenes=reviewScenesAtSpot(chapter,state,'mengjin-school-courtyard');
assert.deepEqual(scenes.map(s=>s.questId),['mengjin-school-upper','mengjin-school-lower']);
assert(scenes[1].entries.filter(x=>x.kind==='board').length>=3);
// Yanwei: day and night share one spot; completed day is visible even when night is in progress.
makeDone('yanwei-day-four');
scenes=reviewScenesAtSpot(chapter,state,'yanwei-riverside-night');
assert.deepEqual(scenes.map(s=>s.title),['日场 · 算稿第四页']);
assert.equal(scenes[0].entries.filter(x=>x.kind==='board').length,1);
state.tasks.side['yanwei-night-five-six']={status:'accepted',steps:{'yanwei-five-intro':{status:'done'}}};
scenes=reviewScenesAtSpot(chapter,state,'yanwei-riverside-night');
assert.equal(scenes[1].entries.length,1);
assert.equal(scenes[1].entries[0].stepId,'yanwei-five-intro');
state.tasks.side['yanwei-night-five-six'].status='submitted';
makeDone('yanwei-night-five-six');
scenes=reviewScenesAtSpot(chapter,state,'yanwei-riverside-day');
assert.equal(scenes[1].entries.length,6);
assert.equal(reviewEntryRoute(scenes[1],scenes[1].entries.find(x=>x.kind==='board')).locationId,'yanwei-riverside-night');
// Taosi: Zi's older room and Chou's return share the same single dot, not a new region marker.
makeDone('taosi-three-pages'); makeDone('taosi-chou-handoff');
scenes=reviewScenesAtSpot(chapter,state,'taosi-old-academy-return');
assert.deepEqual(scenes.map(s=>s.questId),['taosi-three-pages','taosi-chou-handoff']);
assert.equal(scenes[0].entries.length,9);
assert.equal(scenes[1].entries.length,3);
const chapterSnapshot=snapshot();
assert.equal(reviewEntryRoute(null,{}),null);
assert.equal(reviewEntryRoute(scenes[0],{kind:'board',targetId:'taosi-representation-board'}),null);
assert.equal(JSON.stringify(state),chapterSnapshot,'lookup and route must not write to progress');
// UI route must save only normal position and invoke the existing read-only catalog context.
assert(room.includes("node('strong','本光点回顾',heading)"));
assert(room.includes('const spotReviews = reviewScenesAtSpot(chapter,state,location.id);'));
assert(room.includes("await onSave('room_spot_review_switch')"));
assert(room.includes('await onVisitStoryAct(route)'));
assert(app.includes('onVisitStoryAct: async (review) =>'));
assert(app.includes('catalogBoardId:review.catalogBoardId'));
assert(app.includes('catalogEntryId:review.catalogEntryId'));
console.log('PASS V7.4 同光点回顾：孟津日夜 / 学舍上下 / 陶寺子丑 / 嫣沩日夜，已完成步骤可回访且无进度写入');
