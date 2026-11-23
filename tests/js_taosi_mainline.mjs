import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {expectedTaosiAnswers,verifyTaosiAnswers} from '../public/taosi-teaching-board.js';
import {verifyTeachingAnswers,boardStationForLocation} from '../public/mengjin-board.js';
import {resolveMengjinDefaultLocation} from '../public/mengjin-stage-route.js';
import {MENGJIN_ACTS,sceneIndexStatus} from '../public/mengjin-story-catalog.js';
const base=path.dirname(fileURLToPath(import.meta.url));
const cfg=JSON.parse(fs.readFileSync(path.join(base,'../public/scene-activities/mengjin-teaching-boards.json'),'utf8'));
assert.equal(MENGJIN_ACTS.length,37);
assert.equal(boardStationForLocation('taosi-old-academy'),446);
for(const spec of Object.values(cfg.taosi)){
 const expected=expectedTaosiAnswers(spec.id,cfg.taosi);
 assert(expected);
 assert(verifyTaosiAnswers(spec.id,expected,cfg.taosi));
 assert(verifyTeachingAnswers(spec.id,expected,cfg));
 assert(!verifyTaosiAnswers(spec.id,{...expected,secret:true},cfg.taosi));
}
const state={tasks:{side:{}}};
assert.equal(sceneIndexStatus(state,MENGJIN_ACTS[16]),'locked');
state.tasks.side['mengjin-school-lower']={status:'submitted',steps:{}};
assert.equal(sceneIndexStatus(state,MENGJIN_ACTS[16]),'current');
assert.equal(sceneIndexStatus(state,MENGJIN_ACTS[17]),'locked');
assert.equal(resolveMengjinDefaultLocation(state),'taosi-old-academy');
const progress={status:'accepted',steps:{}};
state.tasks.side['taosi-three-pages']=progress;
const ids=['taosi-one-intro','taosi-one-board','taosi-one-note',
 'taosi-two-intro','taosi-two-board','taosi-two-note',
 'taosi-three-intro','taosi-three-board','taosi-three-note'];
for(let i=0;i<ids.length;i++){
  assert.equal(sceneIndexStatus(state,MENGJIN_ACTS[16+i]),'current');
  progress.steps[ids[i]]={status:'done'};
}
progress.status='submitted';
for(let i=0;i<9;i++)assert.equal(sceneIndexStatus(state,MENGJIN_ACTS[16+i]),'done');
const chapter=fs.readFileSync(path.join(base,'../public/room.js'),'utf8');
assert.match(chapter,/soloNarration \? sceneQuests\.map/);
assert.match(chapter,/element\.hidden=true/);
const app=fs.readFileSync(path.join(base,'../public/app.js'),'utf8');
assert.match(app,/regionId === 'taosi'/);
assert.match(app,/location\.id\.startsWith\('taosi-old-academy'\) \? 'taosi'/);
console.log('PASS 陶寺：9 步 3 关、服务端题板、地图解锁、剧情目录、无 NPC 自述');
