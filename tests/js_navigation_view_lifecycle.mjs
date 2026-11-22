import {enterRoomLocation,captureRoomLocationPosition} from '../public/room-location-position.js';
import {resolveQuestDestination} from '../public/quest-navigation.js';
import {questPrerequisitesSatisfied} from '../public/task-model.js';
/**
 * Stale page network callbacks must not seize navigation.
 * Run the actual showRoom/showLevel/showMyScores function bodies; replace
 * only the editor dynamic import with a deterministic mount test double.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {StaleOperationError} from '../public/progress-read-guard.js';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function between(start,end) {
  const i=source.indexOf(start),j=source.indexOf(end,i);
  assert.ok(i>=0 && j>i,`Missing ${start} or ${end}`);
  return source.slice(i,j);
}
const roomBody=between('async function showRoom(', 'async function syncFirstCircuitQuestCompletion(');
let levelBody=between('async function showLevel(', 'function renderTable(');
assert.equal(levelBody.includes('await import("./circuit-editor.js")'),true);
levelBody=levelBody.replace('await import("./circuit-editor.js")','await __editorModule()');
const scoresBody=between('async function showMyScores()', 'async function boot()');

const deferred=()=>{let resolve,reject;const promise=new Promise((ok,bad)=>{resolve=ok;reject=bad;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
const chapter={
  id:'ch1',implemented:true,canEnter:true,spaceTitle:'第一章',
  title:'甲',region:'夏',levels:[{id:'ch1_binary_decoder',title:'译码'}],
  locations:[{id:'gate-road',name:'玉匠铺'},{id:'school',name:'学舍'}],
  quests:{main:null,side:[]},
};
const roomMounts=[],views=[],editorMounts=[];
let username='A';
let roomSync=()=>Promise.resolve();
let getLevel=()=>Promise.resolve({level:{title:'译码'}});
let editorModule=async()=>({mount:async ctx=>{editorMounts.push(ctx);return ()=>{};}});
const state={position:{x:200},tasks:{side:{}},locationId:'gate-road'};
const ctx={
 enterRoomLocation,captureRoomLocationPosition,
  viewGeneration:0,
  navigationGeneration:0,
  beginNavigation:()=>({request:++ctx.navigationGeneration,view:ctx.viewGeneration}),
  stillNavigating:(nav,session)=>nav.request===ctx.navigationGeneration &&
    nav.view===ctx.viewGeneration && ctx.isAuthSnapshotCurrent(session),
  getAuthSnapshot:()=>({token:'A',generation:1}),
  isAuthSnapshotCurrent:s=>s.token==='A'&&s.generation===1,
  stillOnView:(id,s)=>id===ctx.viewGeneration&&ctx.isAuthSnapshotCurrent(s),
  StaleOperationError, SessionChangedError:StaleOperationError,
  resolveQuestDestination,questPrerequisitesSatisfied,
  requireChapter:id=>{assert.equal(id,'ch1');return chapter;},
  syncFirstCircuitQuestCompletion:(...args)=>roomSync(...args),
  page:(title,kind)=>{
    ctx.viewGeneration+=1;
    ctx.navigationGeneration+=1;
    const view={title,kind};
    views.push(view);
    return view;
  },
  createRoom:(args)=>{roomMounts.push(args);return ()=>{};},
  roomDispose:null,
  me:{role:'teacher'},characters:{},gameProfile:{balance:0,inventory:{}},
  showHome:()=>{},showSettings:()=>{},showPlaceholder:()=>{},
  showLeaderboard:()=>{},showError:()=>{},
  saved:new Map([['ch1',{revision:7,state:structuredClone(state)}]]),
  copy:structuredClone,defaultState:()=>structuredClone(state),
  progressQueue:{whenIdle:async()=>{}},
  saveChapter:async()=>{},
  loadGame:async()=>{},
  makeQuestReturnContext:()=>({}),
  readQuestReturnContext:()=>null,
  resolveReturnLocation:()=> 'gate-road',
  cleanupPlugin:()=>{ctx.activePlugin=null;},
  activePlugin:null,
  __editorModule:()=>editorModule(),
  api:async(method,path)=>{
    if(path.startsWith('/api/levels/'))return getLevel();
    if(path==='/api/circuit/results/mine')return getLevel();
    throw Error('Unexpected API request '+path);
  },
  console, AbortController, setTimeout,clearTimeout,
};
vm.runInNewContext(roomBody+'\nglobalThis.enterRoom=showRoom;',ctx);
vm.runInNewContext(levelBody+'\nglobalThis.enterLevel=showLevel;',ctx);
vm.runInNewContext(scoresBody+'\nglobalThis.enterScores=showMyScores;',ctx);

// Old room reconciliation must not re-open a room after the player goes Home.
let blocked=deferred();roomSync=()=>blocked.promise;
const roomPending=ctx.enterRoom('ch1','gate-road');
await tick();
ctx.page('新的主界面','home');
blocked.resolve();
await roomPending;
assert.equal(roomMounts.length,0,'Old showRoom must not mount after page replacement');

// Two overlapping enterRoom requests: only the most recent route can mount.
let first=deferred(),second=deferred();
const pending=[first,second];
roomSync=()=>pending.shift().promise;
const older=ctx.enterRoom('ch1','gate-road');
// Let the first request enter its score fetch before the next navigation starts.
await tick();
const newer=ctx.enterRoom('ch1','school');
await tick();
second.resolve();
await newer;
assert.equal(roomMounts.length,1);
assert.equal(roomMounts[0].location.id,'school');
first.resolve();
await older;
assert.equal(roomMounts.length,1);

// A room callback can wait behind a draft save. Once the player leaves that
// room, releasing the old save must NOT navigate to the old level.
const oldRoom=roomMounts.at(-1);
assert.ok(oldRoom?.onGoToLevel);
const earlierPageCount=views.length;
const pendingRouteSave=deferred();
let oldRouteSaves=0;
ctx.saveChapter=async()=>{oldRouteSaves++;return pendingRouteSave.promise;};
const navPending=oldRoom.onGoToLevel('ch1_binary_decoder',{});
await tick();
assert.equal(oldRouteSaves,1);
ctx.page('另一个页面','home');
pendingRouteSave.resolve();
await navPending;
assert.equal(views.length,earlierPageCount+1,
  'Old room callback must not open a level after a pending save');
await assert.rejects(oldRoom.onSave('late_room_save'),
  error=>error.code==='STALE_OPERATION');

// Level GET pending: a newer page prevents level screen/editor installation.
roomSync=()=>Promise.resolve();
const pageCount=views.length;
let delayedLevel=deferred();getLevel=()=>delayedLevel.promise;
const oldLevel=ctx.enterLevel('ch1','ch1_binary_decoder');
await tick();
ctx.page('玩家已离开','home');
delayedLevel.resolve({level:{title:'译码'}});
await oldLevel;
assert.equal(editorMounts.length,0);
assert.equal(views.length,pageCount+1,'Only the newer home view was rendered');

// A stale failing GET is also a no-op, not an error dialog on another page.
const levelFailure=deferred();
getLevel=()=>levelFailure.promise;
const obsoleteLevel=ctx.enterLevel('ch1','ch1_binary_decoder');
await tick();
ctx.page('其他页面','home');
levelFailure.reject(new Error('old network failure'));
await obsoleteLevel;
assert.equal(editorMounts.length,0);

// Score page pending: a later page must not be replaced by stale results.
const beforeScores=views.length;
let delayedScore=deferred();getLevel=()=>delayedScore.promise;
const oldScores=ctx.enterScores();
await tick();
ctx.page('设置','settings');
delayedScore.resolve({results:[]});
await oldScores;
assert.equal(views.length,beforeScores+1);

// Mount a valid editor, start its exit GET, then leave before the GET finishes.
getLevel=()=>Promise.resolve({level:{title:'译码'}});
await ctx.enterLevel('ch1','ch1_binary_decoder');
assert.equal(editorMounts.length,1);
const editor=editorMounts[0];
assert.ok(editor);
let loading=deferred();
ctx.loadGame=()=>loading.promise;
const roomCount=roomMounts.length;
const pendingExit=editor.exit();
await tick();
ctx.page('成就','achievements');
loading.resolve();
await pendingExit;
assert.equal(roomMounts.length,roomCount,'Old level exit must not open an old room');

// An unmounted editor may not initiate a save or an API mutation.
await assert.rejects(
  editor.saveProgress({circuitLevels:{}},'late_save'),
  error=>error.code==='STALE_OPERATION'
);
assert.throws(()=>editor.api('POST','/api/circuit/evaluate',{}),
  error=>error.code==='STALE_OPERATION');

// Adversarial P1 regression: a 503 before page() must NOT retire the visible
// room. Room saving, retrying the level and leaving the room remain usable.
roomSync=()=>Promise.resolve();
ctx.saveChapter=async()=>{};
getLevel=()=>Promise.resolve({level:{title:'译码'}});
await ctx.enterRoom('ch1','gate-road');
const recoveredRoom=roomMounts.at(-1);
const liveView=ctx.viewGeneration;
let roomSaveCount=0;
ctx.saveChapter=async()=>{roomSaveCount++;return {revision:8};};
getLevel=async()=>{throw new Error('HTTP 503: level temporarily unavailable');};
await assert.rejects(ctx.enterLevel('ch1','ch1_binary_decoder'), /HTTP 503/);
assert.equal(ctx.viewGeneration,liveView,'Failed GET cannot retire old room');
assert.equal(ctx.stillOnView(liveView,ctx.getAuthSnapshot()),true);
await recoveredRoom.onSave('after_failed_level');
assert.equal(roomSaveCount,1,'Room save still works after failed level GET');

// A repeated attempt through the *actual room callback* succeeds.
getLevel=()=>Promise.resolve({level:{title:'译码'}});
const mountsBeforeRetry=editorMounts.length;
await recoveredRoom.onGoToLevel('ch1_binary_decoder',{});
assert.equal(editorMounts.length,mountsBeforeRetry+1);
assert.notEqual(ctx.viewGeneration,liveView,'Successful mount retires old room');

// Separate failure path: the user may still leave to chapter map.
await ctx.enterRoom('ch1','gate-road');
const exitRoom=roomMounts.at(-1);
const viewBeforeFailure=ctx.viewGeneration;
getLevel=async()=>{throw new Error('HTTP 503');};
await assert.rejects(ctx.enterLevel('ch1','ch1_binary_decoder'), /HTTP 503/);
assert.equal(ctx.viewGeneration,viewBeforeFailure);
let exited=0;
ctx.cloudDescend=async callback=>callback();
ctx.showChapterMap=()=>{exited++;ctx.page('章节地图','chapter');};
await exitRoom.onExit();
assert.equal(exited,1,'Room can still exit after failed GET');

// Interleaved navigation: a newer failure must not revive an older request.
await ctx.enterRoom('ch1','gate-road');
const stableView=ctx.viewGeneration;
const firstLevel=deferred(),secondLevel=deferred();
let fetchNumber=0;
getLevel=()=> (fetchNumber++===0 ? firstLevel : secondLevel).promise;
const oldPending=ctx.enterLevel('ch1','ch1_binary_decoder');
await tick();
const newPending=ctx.enterLevel('ch1','ch1_binary_decoder');
await tick();
secondLevel.reject(new Error('HTTP 503 latest route'));
await assert.rejects(newPending, /503/);
firstLevel.resolve({level:{title:'译码'}});
await oldPending;
assert.equal(ctx.viewGeneration,stableView,'Superseded older GET must not mount');
assert.equal(ctx.stillOnView(stableView,ctx.getAuthSnapshot()),true);

// An editor exiting toward a room must remain usable until that room is
// actually mounted. V4 retired the editor too early and could strand it.
getLevel=()=>Promise.resolve({level:{title:'译码'}});
ctx.loadGame=async()=>{};
await ctx.enterLevel('ch1','ch1_binary_decoder');
const leavingEditor=editorMounts.at(-1);
const editorView=ctx.viewGeneration;
const roomEnteredBefore=roomMounts.length;
const gateForRoom=deferred();
let scoreRequestsOnExit=0;
roomSync=()=> (++scoreRequestsOnExit===1 ? Promise.resolve() : gateForRoom.promise);
let editorSaves=0;
ctx.saveChapter=async()=>{editorSaves++;return {revision:8};};
const levelExitPending=leavingEditor.exit();
await tick();
assert.equal(ctx.viewGeneration,editorView,
  'Editor must remain mounted while the returning room waits for score synchronization');
await leavingEditor.saveProgress({circuitLevels:{}},'editor_still_visible');
assert.equal(editorSaves,1,'Visible editor save remains usable during room entry');
gateForRoom.resolve();
await levelExitPending;
assert.equal(roomMounts.length,roomEnteredBefore+1);
assert.notEqual(ctx.viewGeneration,editorView);

// The production page() is the invalidation point for every synchronous page,
// not merely for the explicit async room/level routes.
const realPageBody=between('function page(title, skin', 'function copy(item)');
const pageContext={
  viewGeneration:0,navigationGeneration:0,
  root:{replaceChildren(){},className:''},
  cleanupPlugin:()=>{},roomDispose:null,mapDispose:null,
};
vm.runInNewContext(realPageBody+'\nglobalThis.realPage=page;',pageContext);
pageContext.realPage('成绩','scores');
pageContext.realPage('排行','leaderboard');
assert.equal(pageContext.viewGeneration,2);
assert.equal(pageContext.navigationGeneration,2);

console.log('Page lifecycle race PASS: old room/level/scores network replies cannot reopen pages, concurrent room routes keep latest, stale editor exit/save/API rejected.');
