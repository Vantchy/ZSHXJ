/** Real loadGame implementation: old GETs cannot undo newer PUTs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mergeRevisionedProgress, StaleOperationError} from '../public/progress-read-guard.js';
import {createProgressSaveQueue} from '../public/progress-save-queue.js';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('async function loadGame()');
const end=source.indexOf('function defaultState(',start);
assert.ok(start>0 && end>start);
const functionSource=source.slice(start,end);
const wait=()=>{let resolve,reject;const promise=new Promise((ok,bad)=>{resolve=ok;reject=bad;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
const chapterId='ch1';
const state=(marker)=>({
  tasks:{side:{'binary-decoder':{status:'accepted'}}},
  position:{x:marker},circuitLevels:{decoder:{graph:marker}},
  questReturn:{locationId:marker,levelId:'decoder'}
});
const record=(revision,marker)=>({chapterId,revision,state:state(marker)});
let sessionVersion=1, getProgressCalls=0, progressQueue=[];
const ctx={
  me:{role:'student'}, saved:new Map([[chapterId,record(7,'old')]]),
  chapters:[],characters:{},gameProfile:{balance:600},
  savedWriteGeneration:0, gameLoadGeneration:0,
  getAuthSnapshot:()=>({token:'user-A',generation:sessionVersion}),
  isAuthSnapshotCurrent:x=>x.generation===sessionVersion,
  SessionChangedError:class extends Error{constructor(){super('session');this.code='SESSION_CHANGED';}},
  StaleOperationError,mergeRevisionedProgress,
  progressQueue:{whenIdle:async()=>{}},
  api:async(method,path)=>{
    if(path==='/api/progress') {
      getProgressCalls++;
      return progressQueue.shift().promise;
    }
    if(path==='/api/chapters')return {chapters:[{id:'ch1',quests:{}}]};
    if(path==='/api/game/profile')return {balance:3};
    if(path==='/story/characters.json')return {characters:[]};
    if(path==='/story/ch1.json')return {
      chapterId:'ch1',characters:[],dialogues:[],locations:[{id:'gate-road'}],
      questTargets:{},
    };
    throw Error('Unknown path '+path);
  },
};
vm.runInNewContext(functionSource+'\nglobalThis.runLoadGame=loadGame;',ctx);

// The old server GET was started at revision 7.
let older=wait();progressQueue.push(older);
const oldGET=ctx.runLoadGame();
await tick();
// A local draft PUT finishes at revision 8 before the GET releases.
ctx.saved.set(chapterId,record(8,'latest-draft'));
ctx.savedWriteGeneration++;
older.resolve({progress:[record(7,'old')]});
await oldGET;
assert.equal(ctx.saved.get(chapterId).revision,8);
assert.equal(ctx.saved.get(chapterId).state.circuitLevels.decoder.graph,'latest-draft');
assert.equal(ctx.saved.get(chapterId).state.position.x,'latest-draft');
assert.equal(ctx.saved.get(chapterId).state.questReturn.locationId,'latest-draft');
assert.equal(ctx.gameProfile.balance,600,'older profile GET cannot replace data after a newer save');

// Same revision with a different body is not considered newer.
let same=wait();progressQueue.push(same);
const sameGET=ctx.runLoadGame();
same.resolve({progress:[record(8,'wrong-equal-revision')]});
await sameGET;
assert.equal(ctx.saved.get(chapterId).state.position.x,'latest-draft');

// A truly newer server revision should still be accepted (e.g. another tab).
let newer=wait();progressQueue.push(newer);
const newGET=ctx.runLoadGame();
newer.resolve({progress:[record(9,'server-newer')]});
await newGET;
assert.equal(ctx.saved.get(chapterId).revision,9);
assert.equal(ctx.saved.get(chapterId).state.position.x,'server-newer');

// Missing a chapter in an old GET must not erase a locally saved one.
let missing=wait();progressQueue.push(missing);
const missingGET=ctx.runLoadGame();
missing.resolve({progress:[]});
await missingGET;
assert.equal(ctx.saved.get(chapterId).revision,9);

// Two overlapping loadGame calls: only the later request may publish.
let first=wait(),second=wait();progressQueue.push(first,second);
const oldLoad=ctx.runLoadGame();
await tick();
const newLoad=ctx.runLoadGame();
await tick();
second.resolve({progress:[record(11,'second')]});
await newLoad;
first.resolve({progress:[record(10,'first-stale')]});
const outcomes=await Promise.allSettled([oldLoad]);
assert.equal(outcomes[0].status,'rejected');
assert.equal(outcomes[0].reason.code,'STALE_OPERATION');
assert.equal(ctx.saved.get(chapterId).revision,11);

// If the older HTTP read FAILS after a newer read started, it must be
// classified as obsolete (rather than logging out the player at boot).
let failedOld=wait(),goodNew=wait();
progressQueue.push(failedOld,goodNew);
const obsoleted=ctx.runLoadGame();
await tick();
const later=ctx.runLoadGame();
await tick();
goodNew.resolve({progress:[record(12,'current-success')]});
await later;
failedOld.reject(new Error('late obsolete HTTP 500'));
const obsoleteOutcome=await Promise.allSettled([obsoleted]);
assert.equal(obsoleteOutcome[0].reason.code,'STALE_OPERATION');
assert.equal(ctx.saved.get(chapterId).revision,12);

// A request issued under the prior login cannot apply after account switch.
let pending=wait();progressQueue.push(pending);
const switched=ctx.runLoadGame();
await tick();
sessionVersion++;
pending.resolve({progress:[record(12,'user-A-stale')]});
const last=await Promise.allSettled([switched]);
assert.equal(last[0].status,'rejected');
assert.equal(last[0].reason.code,'SESSION_CHANGED');
assert.equal(ctx.saved.get(chapterId).revision,12);

// Verify the pure helper doesn't accept malformed records or reduce revision.
const map=new Map([[chapterId,record(5,'keep')]]);
mergeRevisionedProgress(map,[null,{chapterId:'',revision:99},record(2,'bad'),record(5,'bad-equal')]);
assert.equal(map.get(chapterId).state.position.x,'keep');

// Real queue barrier: a pre-PUT GET must not complete level exit/reload while
// an already queued draft save remains in flight.
const barrierGate=wait();
const latestCache=new Map([[chapterId,record(7,'before-save')]]);
const barrierQueue=createProgressSaveQueue({
  getSession:ctx.getAuthSnapshot,isCurrentSession:ctx.isAuthSnapshotCurrent,
  getProgress:id=>latestCache.get(id),
  setProgress:(id,entry)=>latestCache.set(id,entry),
  sendProgress:async(id,body)=>{
    await barrierGate.promise;
    return {progress:{chapterId:id,revision:8,state:structuredClone(body.state)}};
  },
  copy:structuredClone,
});
ctx.progressQueue=barrierQueue;
ctx.saved=latestCache;
const originalApi=ctx.api;
ctx.api=async(method,path)=>{
  if(path==='/api/progress')return {progress:[record(7,'before-save')]};
  return originalApi(method,path);
};
const pendingWrite=barrierQueue.save(chapterId,state('queued-latest'),'draft_write');
let finishedRead=false;
const blockedRead=ctx.runLoadGame().then(()=>{finishedRead=true;});
await tick();
assert.equal(finishedRead,false,'The pre-PUT read must wait for already queued PUT');
barrierGate.resolve();
await Promise.all([pendingWrite,blockedRead]);
assert.equal(finishedRead,true);
assert.equal(ctx.saved.get(chapterId).revision,8);
assert.equal(ctx.saved.get(chapterId).state.questReturn.locationId,'queued-latest');

console.log('Progress read race PASS: old GET cannot roll back 8→7, preserve draft/position/return, equal revision, overlapping reads, changed account, and accept newer 9.');
