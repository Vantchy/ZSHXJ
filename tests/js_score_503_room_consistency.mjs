/** Real room + real player + sample JSON; DOM only is stubbed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {isWorkshopQuest, workshopProgressWithPass, normalizeWorkshopProgress, workshopStage} from '../public/workshop-quest.js';
import {createRoom} from '../public/room.js';
import {createProgressSaveQueue} from '../public/progress-save-queue.js';
import vm from 'node:vm';
import {normalizeQuestCollection, questPrerequisitesSatisfied, changeQuestStatus} from '../public/task-model.js';
import {normalizeFlowProgress, syncFlowOfficialPass} from '../public/quest-flow.js';
import {resolveQuestDestination} from '../public/quest-navigation.js';
const layout = {width:1440, buttonsLeft:1100, buttonsWidth:300, panelWidth:1040};

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.handlers = {};
    this.textContent = ''; this.className = ''; this.disabled = false;
    this.attributes = {}; this.hidden = false;
    this.style = {setProperty(){}};
    this.classList = {contains: name => this.className.split(' ').includes(name)};
  }
  append(...children) { for (const child of children) {child.parent = this; this.children.push(child);} }
  replaceChildren(...children) {this.children.forEach(child => {child.parent = null;}); this.children = []; this.append(...children);}
  remove() {if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null;}
  addEventListener(type, fn) {(this.handlers[type] ??= []).push(fn);}
  removeEventListener(type, fn) {this.handlers[type] = (this.handlers[type] || []).filter(item => item !== fn);}
  setAttribute(name, value) {this.attributes[name] = value;}
  focus() {document.activeElement = this;}
  closest(selector) {return selector === 'button' ? (this.tagName === 'BUTTON' ? this : this.parent?.closest(selector)) : null;}
  querySelector(selector) {
    const matches = node => selector.startsWith('.') ? selector.slice(1).split('.').every(name => node.className.split(' ').includes(name)) : node.tagName === selector.toUpperCase();
    for (const child of this.children) {if (matches(child)) return child; const found = child.querySelector(selector); if (found) return found;}
    return null;
  }
  querySelectorAll(tag) {return this.children.flatMap(child => [ ...(child.tagName === tag.toUpperCase() ? [child] : []), ...child.querySelectorAll(tag) ]);}
  getBoundingClientRect() {
    if (this.className.includes('room-control-pad')) return {left:layout.buttonsLeft,top:700,width:layout.buttonsWidth,height:60};
    if (this.className.includes('room-dialogue')) return {left:0,top:500,width:layout.panelWidth,height:260};
    return {left:0, top:0, width:layout.width, height:810};
  }
  async click() {
    if (this.disabled) return;
    let stopped = false;
    const event = {target:this, preventDefault(){}, stopPropagation(){stopped = true;}};
    let current = this;
    while (current) {
      for (const fn of [...current.handlers.click || []]) await fn(event);
      current = stopped ? null : current.parent;
    }
  }
}
const listeners = {};
const speakers = [];
let clock=1000; Date.now=()=>clock;
globalThis.document = {activeElement:null, createElement: tag => new Element(tag)};
globalThis.window = {
  get innerWidth(){return layout.width;},
  addEventListener(type, fn) {(listeners[type] ??= []).push(fn);},
  removeEventListener(type, fn) {listeners[type] = (listeners[type] || []).filter(item => item !== fn);},
  matchMedia:()=>({matches:true}),
  NPCDialogueDisplay: {setSpeaker: value => speakers.push(value), clearSpeaker: () => speakers.push(null)},
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};


const chapter={
 id:'ch1',order:1,implemented:true,canEnter:true,
 npc:'人物',npcLine:'',
 quests:{
   main:{id:'main',type:'main',title:'主线任务',description:'',steps:[],
      completion:{mode:'official-circuit',levelIds:[]}},
   side:[],
 },
 levels:[],locations:[{id:'gate-road',name:'房间'}],
};
const location={id:'gate-road',name:'房间'};
const wait=()=>{
  let resolve,reject;const promise=new Promise((ok,bad)=>{resolve=ok;reject=bad;});
  return {promise,resolve,reject};
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));



/**
 * Real app room + score reconciler + level request, real room task UI and save
 * queue. A previously earned official pass moves an ordered level step to done,
 * then the level GET fails 503 while its original room remains on screen.
 */
const warmup={id:'warmup',type:'side',title:'前置',chapterId:'ch1',
  locationId:'school',prerequisites:[],steps:[],
  completion:{mode:'test-only',levelIds:[]}};
const quest={id:'diviner-study',type:'side',title:'贞人习题',chapterId:'ch1',
  locationId:'school',prerequisites:['warmup'],
  completion:{mode:'official-circuit',levelIds:['ch1_half_adder'],requireAllSteps:true},
  steps:[
    {id:'hear-diviner',condition:{type:'dialogue-finished',dialogueId:'diviner-end'}},
    {id:'make-adder',condition:{type:'level-completed',levelId:'ch1_half_adder'}},
    {id:'report-diviner',condition:{type:'dialogue-finished',dialogueId:'diviner-report'}},
  ]};
chapter.quests={main:null,side:[warmup,quest]};
chapter.locations=[{id:'school',name:'学舍',npc:'贞人'}];
chapter.levels=[{id:'ch1_half_adder',title:'半加器'}];
chapter.questTargets={'diviner-study':{steps:{
  'hear-diviner':{type:'dialogue',id:'diviner-start'},
  'make-adder':{type:'level',id:'ch1_half_adder'},
  'report-diviner':{type:'dialogue',id:'diviner-report'},
}}};
chapter.dialogues=[
 {id:'diviner-start',lines:[{speaker:{name:'贞人'},text:'你好'}]},
 {id:'diviner-end',lines:[{speaker:{name:'贞人'},text:'完成'}]},
 {id:'diviner-report',lines:[{speaker:{name:'贞人'},text:'回报'}]},
];
chapter.npc='贞人';chapter.npcLine='你好';chapter.spaceTitle='教学';
const storyLocation=chapter.locations[0];
const tasks=normalizeQuestCollection(null,chapter.quests);
tasks.side.warmup.status='submitted';
tasks.side[quest.id]=changeQuestStatus(tasks.side[quest.id],'accepted');
tasks.side[quest.id].steps['hear-diviner']={
 status:'done',evidence:{type:'dialogue-finished',dialogueId:'diviner-end'},
 updatedAt:'historic'
};
tasks.side[quest.id]=normalizeFlowProgress(tasks.side[quest.id],quest);
const baseState={
 schemaVersion:2,position:{x:630},locationId:'school',
 flags:{},dialogues:['npc_first_interaction'],
 circuitLevels:{ch1_half_adder:{graph:{components:[{id:'latest-draft'}]}}},
 questReturn:{locationId:'school',levelId:'ch1_half_adder'},
 tasks,
};
const saved=new Map([['ch1',{revision:3,chapterId:'ch1',state:structuredClone(baseState)}]]);
let revision=3;
const checkpoints=[],errors=[];
let scoreGETs=0,levelGETs=0,viewRoot=null,mountedState=null,exitCount=0;
const proof=[{levelId:'ch1_half_adder',completed:true,assessmentType:'circuit_server'}];
const queue=createProgressSaveQueue({
 getSession:()=>({token:'A',generation:1}),
 isCurrentSession:s=>s?.token==='A'&&s.generation===1,
 getProgress:id=>saved.get(id),
 setProgress:(id,value)=>saved.set(id,value),
 copy:structuredClone,
 sendProgress:async(id,payload,token)=>{
  assert.equal(token,'A');
  assert.equal(payload.expectedRevision,revision);
  const previous=saved.get(id)?.state;
  if(previous?.tasks?.side?.[quest.id]?.steps['make-adder']?.status==='done' &&
      payload.state.tasks.side[quest.id].steps['make-adder']?.status!=='done') {
    throw new Error('已完成的任务步骤不得退回未完成');
  }
  checkpoints.push(payload.checkpoint);
  revision++;
  return {progress:{revision,chapterId:id,state:structuredClone(payload.state)}};
 },
});
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function section(start,end){
 const a=app.indexOf(start),b=app.indexOf(end,a);
 assert.ok(a>=0&&b>a);
 return app.slice(a,b);
}
const roomSource=section('async function showRoom(', 'async function syncFirstCircuitQuestCompletion(');
const syncSource=section('async function syncFirstCircuitQuestCompletion(','async function showLevel(');
const levelSource=section('async function showLevel(', 'function renderTable(');
const ctx={
 viewGeneration:0,navigationGeneration:0,roomDispose:null,activePlugin:null,
 getAuthSnapshot:()=>({token:'A',generation:1}),
 isAuthSnapshotCurrent:s=>s?.token==='A' && s.generation===1,
 beginNavigation:()=>({request:++ctx.navigationGeneration,view:ctx.viewGeneration}),
 stillNavigating:(nav,s)=>nav.request===ctx.navigationGeneration&&
   nav.view===ctx.viewGeneration&&ctx.isAuthSnapshotCurrent(s),
 stillOnView:(gen,s)=>gen===ctx.viewGeneration&&ctx.isAuthSnapshotCurrent(s),
 requireChapter:()=>chapter,
 page:()=>{ctx.viewGeneration++;ctx.navigationGeneration++;viewRoot=new Element('div');return viewRoot;},
 createRoom:args=>{mountedState=args.state;return createRoom(args);},
 saved,copy:structuredClone,defaultState:()=>structuredClone(baseState),
 gameProfile:{balance:0,inventory:{}},characters:{},me:{role:'student'},
 progressQueue:queue,SessionChangedError:Error,StaleOperationError:Error,
 isWorkshopQuest,workshopProgressWithPass,syncFlowOfficialPass,
 questPrerequisitesSatisfied,resolveQuestDestination,changeQuestStatus,
 saveChapter:(id,state,checkpoint,session)=>queue.save(id,state,checkpoint,session),
 api:async(method,path,body,options)=>{
  if(path==='/api/circuit/results/mine'){
    scoreGETs++;
    if(scoreGETs===1)throw new Error('temporary grading outage');
    return {results:proof};
  }
  if(path.startsWith('/api/levels/')){
    levelGETs++;
    throw new Error('HTTP 503');
  }
  if(path==='/api/game/profile')return {balance:0,inventory:{}};
  throw Error('Unexpected '+path);
 },
 showHome:()=>{},showSettings:()=>{},showPlaceholder:()=>{},
 showLeaderboard:()=>{},showError:e=>errors.push(e.message),
 cloudDescend:async(fn)=>fn(),showChapterMap:()=>{exitCount++;},
 showMap:()=>{},
 loadGame:async()=>{},
 makeQuestReturnContext:(args)=>({version:1,...args}),
 readQuestReturnContext:()=>null,resolveReturnLocation:()=> 'school',
 console,document:globalThis.document,AbortController,
};
vm.runInNewContext(roomSource+syncSource+levelSource+
   '\nglobalThis.mount=showRoom;globalThis.sync=syncFirstCircuitQuestCompletion;globalThis.level=showLevel;',ctx);

await ctx.mount('ch1','school');
assert.ok(viewRoot&&mountedState,'Real room mounted after transient grade failure');
assert.equal(scoreGETs,1);
assert.equal(mountedState.tasks.side[quest.id].steps['make-adder'].status,'current');
const buttons=()=>viewRoot.querySelectorAll('button');
const find=label=>buttons().find(b=>b.textContent===label || b.attributes['aria-label']===label);
const tick2=()=>new Promise(resolve=>setImmediate(resolve));
const taskButton=buttons().find(b=>b.className==='room-quest-task' ||
   b.className?.includes('room-quest-task is-selected'));
assert.ok(taskButton,'Task book controls found');
// Toggle by class, not icon text (UI uses an image).
const toggle=buttons().find(b=>b.className==='room-taskbar-toggle');
assert.ok(toggle);
await toggle.click();
const chooseDiviner=buttons().find(b=>b.className?.includes('room-quest-task') &&
  b.textContent.includes('贞人习题'));
assert.ok(chooseDiviner,'Second synthetic quest available in task book');
await chooseDiviner.click();
const go=buttons().find(b=>b.className==='room-quest-go');
assert.ok(go,'Quest level navigation is displayed');
assert.equal(go.disabled,false);
await go.click(); // errors get reported by room perform, not thrown to caller
assert.equal(scoreGETs,2);
assert.equal(levelGETs,1);
assert.ok(errors.includes('HTTP 503'));
assert.equal(saved.get('ch1').state.tasks.side[quest.id].steps['make-adder'].status,'done');
assert.equal(mountedState.tasks.side[quest.id].steps['make-adder'].status,'done',
  'Visible room state must catch up with official committed score before GET 503');
assert.equal(mountedState.tasks.side[quest.id].steps['report-diviner'].status,'current');
assert.equal(mountedState.circuitLevels.ch1_half_adder.graph.components[0].id,'latest-draft');

// A subsequent movement and exit cannot send the old `current` step.
const right=find('向右');
assert.ok(right);
await right.click();
const movement=buttons().find(b=>b.className?.includes('room-quest-go'));
assert.ok(movement);
const originalSetTimeout=globalThis.setTimeout;
// Trigger 850ms movement autosave naturally without relying on a browser clock.
await new Promise(resolve=>originalSetTimeout(resolve,920));
await ctx.roomDispose?.refreshTaskView?.(); // no-op if already refreshed
await new Promise(resolve=>originalSetTimeout(resolve,5));
assert.ok(checkpoints.includes('room_moved'),'Movement auto-save sent');
const exit=find('小地图');
assert.ok(exit);
await exit.click();
assert.ok(checkpoints.includes('exit_room'));
assert.equal(exitCount,1);
assert.equal(saved.get('ch1').state.tasks.side[quest.id].steps['make-adder'].status,'done');
assert.equal(saved.get('ch1').state.position.x,mountedState.position.x);
assert.equal(saved.get('ch1').state.questReturn.locationId,'school');
console.log('Score/503 race PASS: official pass advances saved AND still-visible room, movement and exit cannot revert completed step; draft and return context survive.');
