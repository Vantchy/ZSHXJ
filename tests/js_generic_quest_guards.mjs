import {enterRoomLocation,captureRoomLocationPosition} from '../public/room-location-position.js';
import {sceneConfig} from '../public/quest-scene.js';
/** Server-associated target checks and generic ordered-level score sync. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {questPrerequisitesSatisfied,changeQuestStatus,normalizeQuestCollection} from '../public/task-model.js';
import {syncFlowOfficialPass,normalizeFlowProgress} from '../public/quest-flow.js';
import {resolveQuestDestination} from '../public/quest-navigation.js';
import {prepareQuestDialogueFinish} from '../public/quest-dialogue-event.js';
import {isWorkshopQuest,workshopProgressWithPass} from '../public/workshop-quest.js';

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const extract=(start,end)=>{
  const a=app.indexOf(start),b=app.indexOf(end,a);
  assert.ok(a>=0&&b>a,`${start} should be in real app.js`);
  return app.slice(a,b);
};
const definition={
 id:'diviner-study',type:'side',locationId:'gate-road',prerequisites:['warmup'],
 completion:{mode:'official-circuit',requireAllSteps:true,levelIds:['ch1_half_adder']},
 steps:[
  {id:'hear-diviner',condition:{type:'dialogue-finished',dialogueId:'diviner-finish'}},
  {id:'make-adder',condition:{type:'level-completed',levelId:'ch1_half_adder'}},
  {id:'report-diviner',condition:{type:'dialogue-finished',dialogueId:'diviner-report'}},
 ],
};
const warmup={id:'warmup',type:'side',locationId:'gate-road',prerequisites:[],
 completion:{mode:'test-only',levelIds:[]},steps:[]};
const chapter={id:'ch1',implemented:true,canEnter:true,title:'测试',spaceTitle:'测试',
 locations:[{id:'gate-road',name:'作坊'}],
 levels:[{id:'ch1_half_adder',title:'半加器'},{id:'ch1_cmos_not',title:'非门'}],
 quests:{main:null,side:[warmup,definition]},
 questTargets:{'diviner-study':{steps:{
   'hear-diviner':{type:'dialogue',id:'diviner-opening'},
   'make-adder':{type:'level',id:'ch1_half_adder'},
   'report-diviner':{type:'dialogue',id:'diviner-report'},
 }}},
 dialogues:[
  {id:'diviner-opening',options:[{target:{type:'dialogue',id:'diviner-finish'}}]},
  {id:'diviner-finish'}, {id:'diviner-report'},
 ],
};
const tasks=normalizeQuestCollection(null,chapter.quests);
tasks.side.warmup.status='submitted';
tasks.side['diviner-study']=changeQuestStatus(tasks.side['diviner-study'],'accepted');
tasks.side['diviner-study'].steps['hear-diviner']={status:'done',
 evidence:{type:'dialogue-finished',dialogueId:'diviner-finish'}};
tasks.side['diviner-study']=normalizeFlowProgress(tasks.side['diviner-study'],definition);
const saved=new Map([['ch1',{revision:3,state:{tasks,position:{x:444},
 questReturn:{locationId:'gate-road'},circuitLevels:{dummy:{draft:'preserved'}}}}]]);
const initial=saved.get('ch1').state;
const proof=[{levelId:'ch1_half_adder',assessmentType:'circuit_server',completed:true}];
const wrong=[{levelId:'ch1_cmos_not',assessmentType:'circuit_server',completed:true}];
const ctx={
 enterRoomLocation,captureRoomLocationPosition,
 saved,requireChapter:id=>chapter,
 getAuthSnapshot:()=>({token:'one-login',generation:1}),
 isAuthSnapshotCurrent:()=>true,SessionChangedError:Error,
 isWorkshopQuest,workshopProgressWithPass,changeQuestStatus,
 questPrerequisitesSatisfied,sceneConfig,syncFlowOfficialPass,
 progressQueue:{mutateLatest:async (id,checkpoint,mutation)=>{
   const prior=saved.get(id);
   const copy=structuredClone(prior.state);
   if(mutation(copy))saved.set(id,{revision:prior.revision+1,state:copy});
 }},
 api:async()=>{throw Error('Test gives explicit rows');},
};
vm.runInNewContext(extract('async function syncFirstCircuitQuestCompletion(',
  'async function showLevel(')+'\nglobalThis.sync=syncFirstCircuitQuestCompletion;',ctx);
await ctx.sync('ch1',wrong);
assert.equal(saved.get('ch1').revision,3,'Wrong official score cannot advance another level');
await ctx.sync('ch1',proof);
assert.equal(saved.get('ch1').revision,4);
const progressed=saved.get('ch1').state;
assert.equal(progressed.tasks.side['diviner-study'].status,'accepted');
assert.equal(progressed.tasks.side['diviner-study'].steps['make-adder'].status,'done');
assert.equal(progressed.tasks.side['diviner-study'].steps['report-diviner'].status,'current');
assert.equal(progressed.circuitLevels.dummy.draft,'preserved');
assert.equal(progressed.position.x,444);
await ctx.sync('ch1',proof);
assert.equal(saved.get('ch1').revision,4,'Repeated grade polling must be idempotent');

// A final dialogue event, not the score, completes the ordered quest.
const event=prepareQuestDialogueFinish({chapter,state:progressed,locationId:'gate-road',
 context:{kind:'quest-target',questId:'diviner-study',stepId:'report-diviner',entryId:'diviner-report'},
 finalParagraphId:'diviner-report'});
assert.ok(event);
assert.equal(event.updated.status,'completed');
assert.equal(prepareQuestDialogueFinish({chapter,state:progressed,locationId:'gate-road',
 context:{kind:'review',questId:'diviner-study',stepId:'report-diviner',entryId:'diviner-report'},
 finalParagraphId:'diviner-report'}),null);

// The real showRoom callback validates a level ID again, even if the caller
// supplied a task/step/location tuple. No unvalidated task-specific entry.
let viewGeneration=1;
let navigationGeneration=0;
const roomMounts=[],entered=[],writes=[];
// Reopen a room with the level step active (before score reconciliation).
saved.set('ch1',{revision:5,state:structuredClone(initial)});
const roomCtx={
  enterRoomLocation,captureRoomLocationPosition,
  saved,viewGeneration:1,navigationGeneration:0,
  getAuthSnapshot:()=>({token:'one-login',generation:1}),
  isAuthSnapshotCurrent:()=>true,
  stillOnView:(id)=>id===roomCtx.viewGeneration,
  beginNavigation:()=>({request:++roomCtx.navigationGeneration,view:roomCtx.viewGeneration}),
  stillNavigating:(nav)=>nav.request===roomCtx.navigationGeneration &&
    nav.view===roomCtx.viewGeneration,
  requireChapter:()=>chapter,copy:structuredClone,defaultState:()=>structuredClone(initial),
  progressQueue:{whenIdle:async()=>{}},
  syncFirstCircuitQuestCompletion:async()=>{},
  page:()=>{roomCtx.viewGeneration++;roomCtx.navigationGeneration++;return {};},
  createRoom:(options)=>{roomMounts.push(options);return ()=>{};},
  showHome:()=>{},showSettings:()=>{},showPlaceholder:()=>{},showLeaderboard:()=>{},showError:()=>{},
  gameProfile:{balance:0,inventory:{}},characters:{},roomDispose:null,
  makeQuestReturnContext:options=>options,
  saveChapter:async(id,state,checkpoint)=>{
    writes.push({checkpoint,state:structuredClone(state)});
    return {revision:5+writes.length};
  },
  showLevel:async(id,level)=>{entered.push(level);},
  isWorkshopQuest,sceneConfig,questPrerequisitesSatisfied,resolveQuestDestination,
  console,
};
vm.runInNewContext(extract('async function showRoom(',
  'async function syncFirstCircuitQuestCompletion(')+'\nglobalThis.showRoomEntry=showRoom;',roomCtx);
await roomCtx.showRoomEntry('ch1','gate-road');
const room=roomMounts[0];
assert.ok(room);
const destination={questId:'diviner-study',stepId:'make-adder',locationId:'gate-road'};
const rejection=/不匹配/;
await assert.rejects(room.onGoToLevel('ch1_cmos_not',destination),rejection);
await assert.rejects(room.onGoToLevel('ch1_half_adder',{...destination,stepId:'report-diviner'}),rejection);
await assert.rejects(room.onGoToLevel('ch1_half_adder',{...destination,locationId:'wrong'}),rejection);
await assert.rejects(room.onGoToLevel('ch1_half_adder',{...destination,questId:'unknown'}),rejection);
assert.equal(writes.length,0,'Invalid quest-navigation metadata must never reach PUT');
room.state.tasks.side.warmup.status='accepted';
await assert.rejects(room.onGoToLevel('ch1_half_adder',destination),rejection);
room.state.tasks.side.warmup.status='submitted';
await room.onGoToLevel('ch1_half_adder',destination);
assert.equal(entered.length,1);
assert.equal(entered[0],'ch1_half_adder');
assert.equal(writes[0].state.questReturn.questId,'diviner-study');
assert.equal(writes[0].state.questReturn.stepId,'make-adder');

// Explicit workshop replay remains available after the complete original
// quest. It cannot be confused with a new completion or a different level.
const workshopChapter=JSON.parse(execFileSync('python',['-S','-c',
  "import json;from chapters import BY_ID;print(json.dumps(BY_ID['ch1']))"],
  {encoding:'utf8'}));
const authoredStory=JSON.parse(fs.readFileSync(
  new URL('../public/story/ch1.json',import.meta.url),'utf8'));
workshopChapter.canEnter=true;
workshopChapter.questTargets=authoredStory.questTargets;
workshopChapter.dialogues=authoredStory.dialogues;
const finished=normalizeQuestCollection(null,workshopChapter.quests);
const workshop=workshopChapter.quests.side.find(isWorkshopQuest);
finished.side[workshop.id].status='submitted';
for(const step of workshop.steps)finished.side[workshop.id].steps[step.id].status='done';
saved.set('ch1',{revision:20,state:{tasks:finished,position:{x:630}}});
roomCtx.requireChapter=()=>workshopChapter;
await roomCtx.showRoomEntry('ch1','gate-road');
const replayRoom=roomMounts.at(-1);
const replay={questId:workshop.id,stepId:'decode-four-combinations',
  locationId:'gate-road',replay:true};
const replayCount=entered.length;
await assert.rejects(replayRoom.onGoToLevel('ch1_binary_decoder',
  {...replay,replay:false}),/不匹配/);
await replayRoom.onGoToLevel('ch1_binary_decoder',replay);
assert.equal(entered.length,replayCount+1);
assert.equal(entered.at(-1),'ch1_binary_decoder');

console.log('Generic quest guards PASS: prerequisite-aware official score sync only advances current step, finale dialogue completes, task/step/location checked again before editor entry.');
