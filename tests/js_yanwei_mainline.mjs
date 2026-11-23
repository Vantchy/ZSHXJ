import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expectedYanweiAnswers,verifyYanweiAnswers} from '../public/yanwei-teaching-board.js';
import {verifyTeachingAnswers,boardStationForLocation} from '../public/mengjin-board.js';
import {resolveMengjinStageLocation,resolveMengjinDefaultLocation} from '../public/mengjin-stage-route.js';
import {MENGJIN_ACTS,sceneIndexStatus} from '../public/mengjin-story-catalog.js';
import {getChapterOneRegion} from '../public/chapter-one-region-maps.js';
const cwd=path.dirname(fileURLToPath(import.meta.url));
const rules=JSON.parse(fs.readFileSync(path.join(cwd,'../public/scene-activities/mengjin-teaching-boards.json'),'utf8'));
assert(MENGJIN_ACTS.length >= 37, '保留历史剧情步骤，后续新幕不应导致旧测试失效');
assert.equal(boardStationForLocation('yanwei-riverside-day'),318);
assert.equal(boardStationForLocation('yanwei-riverside-night'),318);
for(const spec of Object.values(rules.yanwei)){
  const correct=expectedYanweiAnswers(spec.id,rules.yanwei);
  assert(correct);
  assert(verifyYanweiAnswers(spec.id,correct,rules.yanwei));
  assert(verifyTeachingAnswers(spec.id,correct,rules));
  assert(!verifyYanweiAnswers(spec.id,{...correct,unknown:true},rules.yanwei));
}
const region=getChapterOneRegion('guirui');
assert(region&&region.hotspots.length===1);
const spot=region.hotspots[0];
assert.equal(spot.id,'yanwei-workshop-dot');
const chapter={locations:[{id:'yanwei-riverside-day'},{id:'yanwei-riverside-night'}]};
const state={tasks:{side:{'mengjin-school-lower':{status:'submitted'},'taosi-three-pages':{status:'submitted'}}}};
assert.equal(resolveMengjinDefaultLocation(state),'yanwei-riverside-day');
assert.equal(resolveMengjinStageLocation(chapter,state,spot),'yanwei-riverside-day');
assert.equal(sceneIndexStatus(state,MENGJIN_ACTS[25]),'current');
assert.equal(sceneIndexStatus(state,MENGJIN_ACTS[26]),'locked');
state.tasks.side['yanwei-day-four']={status:'accepted',steps:{}};
for(const step of ['yanwei-four-intro','yanwei-four-board','yanwei-four-note']){
  const a=MENGJIN_ACTS.find(a=>a.step===step);
  assert.equal(sceneIndexStatus(state,a),'current');
  state.tasks.side['yanwei-day-four'].steps[step]={status:'done'};
}
state.tasks.side['yanwei-day-four'].status='submitted';
assert.equal(resolveMengjinDefaultLocation(state),'yanwei-riverside-night');
assert.equal(resolveMengjinStageLocation(chapter,state,spot),'yanwei-riverside-night');
assert.equal(sceneIndexStatus(state,MENGJIN_ACTS[28]),'current');
state.tasks.side['yanwei-night-five-six']={status:'accepted',steps:{}};
for(const a of MENGJIN_ACTS.filter(a=>a.quest==='yanwei-night-five-six')){
  assert.equal(sceneIndexStatus(state,a),'current');
  state.tasks.side['yanwei-night-five-six'].steps[a.step]={status:'done'};
}
state.tasks.side['yanwei-night-five-six'].status='submitted';
assert.equal(resolveMengjinDefaultLocation(state),'taosi-old-academy-return');
for(const a of MENGJIN_ACTS.filter(a=>a.quest==='yanwei-night-five-six'))assert.equal(sceneIndexStatus(state,a),'done');
console.log('PASS 嫣沩4-6：日夜光点、章节任务、九幕剧情数据及服务端同构答卷规则');
