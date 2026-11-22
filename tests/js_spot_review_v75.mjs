import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {reviewScenesAtSpot,reviewEntryRoute} from '../public/story-spot-review.js';
import {MENGJIN_ACTS} from '../public/mengjin-story-catalog.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const room=fs.readFileSync(path.join(root,'public/room.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/mengjin-story.css'),'utf8');
const story=JSON.parse(fs.readFileSync(path.join(root,'public/story/ch1.json'),'utf8'));
const quests=new Map();
for (const act of MENGJIN_ACTS){
  if(!quests.has(act.quest))quests.set(act.quest,{id:act.quest,locationId:act.locationId,steps:[]});
  quests.get(act.quest).steps.push({id:act.step,title:act.title,condition:{
    dialogueId:act.entryId||story.questTargets[act.quest].steps[act.step].id,
    ...(act.boardId?{boardId:act.boardId}:{})
  }});
}
const chapter={quests:{side:[...quests.values()]},questTargets:story.questTargets,dialogues:story.dialogues};
const state={tasks:{side:{}}};
function submit(id){
 const quest=quests.get(id);
 state.tasks.side[id]={status:'submitted',steps:Object.fromEntries(
   quest.steps.map(step=>[step.id,{status:'done'}]))};
}
submit('mengjin-jade-mainline');submit('mengjin-diviner-mainline');
const before=JSON.stringify(state);
const atNight=reviewScenesAtSpot(chapter,state,'mengjin-diviner-residence');
assert.deepEqual(atNight.map(scene=>scene.title),['日场 · 玉匠铺','夜场 · 贞人居所']);
assert.equal(atNight[1].entries.length,3);
const previousDay=reviewEntryRoute(atNight[0],atNight[0].entries[0]);
assert.equal(previousDay.locationId,'mengjin-jade-courtyard');
assert.equal(JSON.stringify(state),before,'spot review selection remains read-only');
// All completed-scene paths now open the existing task-book section.
assert.match(room,/function openSpotReviewInTaskBook\(preferredQuestId = sceneQuest\?\.id\)/);
assert.match(room,/selectedSpotReviewQuestId=chosen\.questId;\s*openTaskPanel\(\)/);
assert.match(room,/if \(replayThisScene\) \{\s*openSpotReviewInTaskBook\(current\.quest\.id\)/);
assert.match(room,/if \(!activeSceneStep\(sceneQuest,currentSceneProgress\(\)\)\) \{\s*openSpotReviewInTaskBook\(sceneQuest\.id\)/);
assert.match(room,/review: \(\) => openSpotReviewInTaskBook\(sceneQuest\.id\)/);
assert.match(room,/node\('strong','本光点回顾',heading\)/);
assert(!room.includes('openSceneReplayPanel'));
assert(!room.includes('closeSceneReplayPanel'));
assert(!room.includes('mj-scene-replay'));
assert(!css.includes('.mj-scene-replay '));
console.log('PASS V7.5 同光点回顾统一入口：人物/重温本场→任务书，旧弹窗删除，日夜可回顾');
