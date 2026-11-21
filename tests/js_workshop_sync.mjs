import {sceneConfig} from '../public/quest-scene.js';
import {questPrerequisitesSatisfied} from '../public/task-model.js';
import {syncFlowOfficialPass} from '../public/quest-flow.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {normalizeQuestCollection, changeQuestStatus} from '../public/task-model.js';
import {isWorkshopQuest, workshopProgressWithPass, workshopStage} from '../public/workshop-quest.js';
const chapter=JSON.parse(execFileSync('python',['-c',"import json;from chapters import BY_ID;print(json.dumps(BY_ID['ch1']))"],{encoding:'utf8'}));
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const syncSource=source.slice(source.indexOf('async function syncFirstCircuitQuestCompletion'),source.indexOf('async function showLevel('));
let writes=0;
const saved=new Map();
const ctx={saved,requireChapter:()=>chapter,copy:structuredClone,changeQuestStatus,isWorkshopQuest,workshopProgressWithPass,questPrerequisitesSatisfied,sceneConfig,syncFlowOfficialPass,
  getAuthSnapshot:()=>({token:'test-session',generation:1}),
  isAuthSnapshotCurrent:()=>true,
  SessionChangedError:Error,
  api:async()=>{throw Error('Tests supply explicit official rows');},
  progressQueue:{mutateLatest:async(id,checkpoint,mutate)=>{
    const state=structuredClone(saved.get(id)?.state);
    if (mutate(state)) {writes++; saved.set(id,{state});}
  }}};
vm.runInNewContext(syncSource+';globalThis.sync=syncFirstCircuitQuestCompletion;',ctx);
const quest=chapter.quests.side.find(isWorkshopQuest);
const proof=[{levelId:'ch1_binary_decoder',assessmentType:'circuit_server',completed:true}];
const fresh=()=>({tasks:normalizeQuestCollection(null,chapter.quests),circuitLevels:{ch1_binary_decoder:{graph:'kept'}}});
let state=fresh();saved.set('ch1',{state});await ctx.sync('ch1',proof);assert.equal(writes,0);
state.tasks.side[quest.id]=changeQuestStatus(state.tasks.side[quest.id],'accepted');
await ctx.sync('ch1',proof);assert.equal(workshopStage(saved.get('ch1').state.tasks.side[quest.id]),'intro');
state=saved.get('ch1').state;state.tasks.side[quest.id].steps['listen-workshop'].status='done';
await ctx.sync('ch1',[{...proof[0],completed:false}]);assert.equal(workshopStage(saved.get('ch1').state.tasks.side[quest.id]),'exercise');
await ctx.sync('ch1',proof);state=saved.get('ch1').state;
assert.equal(state.tasks.side[quest.id].status,'accepted');assert.equal(workshopStage(state.tasks.side[quest.id]),'report');
assert.equal(state.tasks.main.status,'not-accepted');assert.equal(state.circuitLevels.ch1_binary_decoder.graph,'kept');
const previous=writes;await ctx.sync('ch1',proof);assert.equal(writes,previous,'Repeated sync must not write or advance twice');
state=fresh();state.tasks.side[quest.id]={status:'completed',steps:{'decode-four-combinations':{status:'done'}}};saved.set('ch1',{state});
await ctx.sync('ch1',proof);state=saved.get('ch1').state;
assert.equal(state.tasks.side[quest.id].status,'completed');assert.equal(workshopStage(state.tasks.side[quest.id]),'intro');
assert.equal(state.tasks.side[quest.id].steps['decode-four-combinations'].status,'done');
console.log('Workshop app sync PASS: actual entry reconciler, official evidence, report gating, legacy saves and idempotent updates.');
