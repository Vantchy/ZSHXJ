import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MENGJIN_ACTS,sceneIndexStatus} from '../public/mengjin-story-catalog.js';
import {expectedSchoolAnswers,verifySchoolAnswers} from '../public/mengjin-school-board.js';
import {verifyTeachingAnswers,boardStationForLocation} from '../public/mengjin-board.js';
import {resolveMengjinStageLocation} from '../public/mengjin-stage-route.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const rules=JSON.parse(fs.readFileSync(path.join(here,'../public/scene-activities/mengjin-teaching-boards.json'),'utf8'));
const school=rules.school;
assert(MENGJIN_ACTS.length >= 37, '保留历史剧情步骤，后续新幕不应导致旧测试失效');
assert.equal(boardStationForLocation('mengjin-school-courtyard'),315);
assert.deepEqual(expectedSchoolAnswers(school.truth.id,school),{outputs:[0,0,0,1,0,1,1,1]});
for(const spec of Object.values(school)) {
  const good=expectedSchoolAnswers(spec.id,school);
  assert(verifySchoolAnswers(spec.id,good,school));
  assert(verifyTeachingAnswers(spec.id,good,rules));
  assert(!verifySchoolAnswers(spec.id,{...good,spoofed:true},school));
}
assert(!verifyTeachingAnswers(school.truth.id,{outputs:[0,0,0,0,0,1,1,1]},rules));
const state={tasks:{side:{}}};
const [day,diviner,upper,lower]=['mengjin-jade-mainline','mengjin-diviner-mainline','mengjin-school-upper','mengjin-school-lower'];
const act=n=>MENGJIN_ACTS[n-1];
assert.equal(sceneIndexStatus(state,act(1)),'current');
assert.equal(sceneIndexStatus(state,act(8)),'locked');
state.tasks.side[day]={status:'submitted',steps:{}};
assert.equal(sceneIndexStatus(state,act(5)),'current');
assert.equal(sceneIndexStatus(state,act(8)),'locked');
state.tasks.side[diviner]={status:'submitted',steps:{}};
assert.equal(sceneIndexStatus(state,act(8)),'current');
assert.equal(sceneIndexStatus(state,act(11)),'locked');
state.tasks.side[upper]={status:'accepted',steps:{'school-upper-intro':{status:'done'}}};
assert.equal(sceneIndexStatus(state,act(8)),'done');
assert.equal(sceneIndexStatus(state,act(9)),'current');
assert.equal(sceneIndexStatus(state,act(10)),'locked');
state.tasks.side[upper].status='submitted';
assert.equal(sceneIndexStatus(state,act(11)),'current');
state.tasks.side[lower]={status:'submitted',steps:{'school-mengjin-summary':{status:'done'}}};
assert.equal(sceneIndexStatus(state,act(16)),'done');
const chapter={quests:{side:[{id:day}]},locations:[{id:'mengjin-diviner-residence'}]};
assert.equal(resolveMengjinStageLocation(chapter,{tasks:{side:{[day]:{status:'submitted'}}}},{id:'mengjin-river-gate',locationId:'mengjin-jade-courtyard'}),'mengjin-diviner-residence');
assert.equal(resolveMengjinStageLocation(chapter,state,{id:'mengjin-inner-court',locationId:'mengjin-school-courtyard'}),'mengjin-school-courtyard');
// Regression guard: completed school-upper must select school-lower owner even
// while the submit dialogue action still holds the input busy lock.
const roomSource=fs.readFileSync(path.join(here,'../public/room.js'),'utf8');
assert.match(roomSource, /setActiveActor\(nextActor\.id, \{allowSubmittedTransition:true\}\)/);
assert.match(roomSource, /if \(!actor \|\| \(activeActor\?\.id !== actorId && !allowSubmittedTransition/);
console.log('孟津授业学舍：多幕回顾数据、关卡答案、阶段锁定、旧河门路由和两光点校验全部通过');
