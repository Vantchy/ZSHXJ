import {questPrerequisitesSatisfied} from '../public/task-model.js';
import {syncFlowOfficialPass} from '../public/quest-flow.js';
/**
 * Real app.js score-sync function + real serialized queue.
 * Forces GET and an unrelated draft PUT to complete in an adverse order.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createProgressSaveQueue,SessionChangedError} from '../public/progress-save-queue.js';
import {normalizeQuestCollection,changeQuestStatus} from '../public/task-model.js';
import {isWorkshopQuest,workshopProgressWithPass,workshopStage} from '../public/workshop-quest.js';

const chapter=JSON.parse(execFileSync('python',['-S','-c',
  "import json;from chapters import BY_ID;print(json.dumps(BY_ID['ch1']))"],
  {encoding:'utf8'}));
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const begin=app.indexOf('async function syncFirstCircuitQuestCompletion(');
const end=app.indexOf('async function showLevel(',begin);
assert.ok(begin>=0 && end>begin);

const quest=chapter.quests.side.find(isWorkshopQuest);
assert.ok(quest);
const levelId=quest.completion.levelIds[0];
const proof=[{levelId,assessmentType:'circuit_server',completed:true}];

let version=3;
let sessionToken='A';
const getAuthSnapshot=()=>({token:sessionToken,generation:version});
const isAuthSnapshotCurrent=session=>session.generation===version && session.token===sessionToken;
const deferred=()=>{
  let resolve;
  const promise=new Promise(r=>resolve=r);
  return {promise,resolve};
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const saves=[];
const saved=new Map();
let serverRevision=7;
let blockDraft=null;
let blockScores=null;
let rows=proof;

const sendProgress=async(id,payload,authToken)=>{
  saves.push({checkpoint:payload.checkpoint,
    authToken,expectedRevision:payload.expectedRevision,
    state:structuredClone(payload.state)});
  if(payload.checkpoint==='save_latest_draft') await blockDraft.promise;
  assert.equal(authToken,'A');
  assert.equal(payload.expectedRevision,serverRevision,
    'Serialized writes must take newest server revision');
  serverRevision++;
  return {progress:{revision:serverRevision,state:structuredClone(payload.state)}};
};
const queue=createProgressSaveQueue({
  getSession:getAuthSnapshot,isCurrentSession:isAuthSnapshotCurrent,
  getProgress:id=>saved.get(id),setProgress:(id,record)=>saved.set(id,record),
  sendProgress,copy:structuredClone,
});
const scoreApi=async(method,path,body,options)=>{
  assert.equal(method,'GET');
  assert.equal(path,'/api/circuit/results/mine');
  assert.equal(options.authToken,'A');
  if(blockScores) await blockScores.promise;
  return {results:rows};
};
const ctx={
  saved,requireChapter:()=>chapter,isWorkshopQuest,workshopProgressWithPass,changeQuestStatus,questPrerequisitesSatisfied,syncFlowOfficialPass,
  getAuthSnapshot,isAuthSnapshotCurrent,SessionChangedError,
  api:scoreApi,progressQueue:queue,
};
vm.runInNewContext(app.slice(begin,end)+'\nglobalThis.sync=syncFirstCircuitQuestCompletion;',ctx);

function initial() {
  const tasks=normalizeQuestCollection(null,chapter.quests);
  tasks.side[quest.id]=changeQuestStatus(tasks.side[quest.id],'accepted');
  const intro=quest.steps[0];
  tasks.side[quest.id].steps[intro.id]={
    status:'done',updatedAt:'old',
    evidence:{type:'dialogue-finished',dialogueId:intro.condition.dialogueId}
  };
  return {
    schemaVersion:2, position:{x:100},locationId:'gate-road',
    circuitLevels:{[levelId]:{graph:{components:[{id:'before-draft'}]}}},
    questReturn:{version:1,levelId,locationId:'gate-road',questId:quest.id},
    tasks,
  };
}
saved.set('ch1',{revision:7,state:initial()});
blockScores=deferred();
blockDraft=deferred();

// Score sync begins first, but GET is deliberately stalled.
const synchronizing=ctx.sync('ch1');
await tick();
assert.equal(saves.length,0);

// The editor saves a newer draft while score GET is still in flight.
const fresh=structuredClone(saved.get('ch1').state);
fresh.position.x=987;
fresh.locationId='new-room';
fresh.questReturn.locationId='new-room';
fresh.circuitLevels[levelId].graph.components=[{id:'latest-draft'}];
const saving=queue.save('ch1',fresh,'save_latest_draft');
await tick();
assert.equal(saves.length,1);
assert.equal(saves[0].checkpoint,'save_latest_draft');

// Now let score GET finish, but keep the draft PUT pending.
blockScores.resolve();
await tick();
assert.equal(saves.length,1,'Score merge must wait behind earlier queued save');
blockDraft.resolve();
await Promise.all([saving,synchronizing]);

const result=saved.get('ch1');
assert.equal(result.revision,9);
assert.equal(result.state.circuitLevels[levelId].graph.components[0].id,'latest-draft');
assert.equal(result.state.position.x,987);
assert.equal(result.state.locationId,'new-room');
assert.equal(result.state.questReturn.locationId,'new-room');
assert.equal(workshopStage(result.state.tasks.side[quest.id]),'report');
assert.equal(saves[1].checkpoint,'official_circuit_tasks_completed');
assert.equal(saves[1].expectedRevision,8);
assert.equal(saves[1].state.circuitLevels[levelId].graph.components[0].id,'latest-draft',
  'The PUT payload itself must have the newest editor graph');

// Repeated reconciliation must not create a duplicate write or reward.
const before=saves.length;
blockScores=null;
await Promise.all([ctx.sync('ch1',proof),ctx.sync('ch1',proof)]);
assert.equal(saves.length,before);
assert.equal(result.state.questReturn.locationId,'new-room');

// A result GET issued for A that completes after switching to B is ignored.
saved.set('ch1',{revision:10,state:initial()});
serverRevision=10;
blockScores=deferred();
const oldSync=ctx.sync('ch1');
await tick();
version++;
sessionToken='B';
queue.invalidatePending();
saved.set('ch1',{revision:0,state:{owner:'B'}});
blockScores.resolve();
const outcome=await Promise.allSettled([oldSync]);
assert.equal(outcome[0].status,'rejected');
assert.equal(outcome[0].reason.code,'SESSION_CHANGED');
assert.equal(saved.get('ch1').state.owner,'B');
assert.equal(saves.length,before);

console.log('Score-sync race PASS: latest draft/position/questReturn preserved, latest revision used, repeated proofs idempotent, delayed A score cannot mutate B.');
