import assert from 'node:assert/strict';
import {normalizeQuestCollection,changeQuestStatus,advanceTestStep,
        currentTestStep} from '../public/task-model.js';
const steps = [{id:'step-1',title:'步骤一'}, {id:'step-2',title:'步骤二'}];
const main = {id:'main',type:'main',title:'主线任务',steps,
  completion:{mode:'official-circuit',levelIds:['ch1_cmos_not']}};
const side = {id:'side-test',type:'side',title:'支线任务',steps,
  completion:{mode:'test-only',levelIds:[]}};
const tasks = normalizeQuestCollection({main:{status:'accepted'},side:{}},{main,side:[side]});
assert.equal(tasks.schemaVersion,1);
assert.equal(tasks.main.status,'accepted');
assert.deepEqual(Object.keys(tasks.side),['side-test']);
let sideState=changeQuestStatus(tasks.side['side-test'],'accepted');
assert.equal(sideState.steps['step-1'].status,'current');
assert.equal(tasks.side['side-test'].steps['step-1'].status,'pending','Transition must not mutate prior state');
assert.equal(currentTestStep(side,sideState).title,'步骤一');
sideState=advanceTestStep(sideState,side);
assert.equal(sideState.steps['step-1'].status,'done');
assert.equal(sideState.steps['step-2'].status,'current');
sideState=advanceTestStep(sideState,side);
assert.equal(sideState.status,'completed');
assert.equal(sideState.steps['step-2'].status,'done');
sideState=changeQuestStatus(sideState,'submitted');
assert.equal(sideState.status,'submitted');
assert.throws(()=>advanceTestStep(sideState,side),/Only accepted/);
assert.throws(()=>changeQuestStatus(tasks.main,'submitted'),/Invalid quest transition/);
console.log('Task model smoke: typed definitions, forward-only transitions, two test steps, immutability PASS.');
