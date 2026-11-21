/** Real room + real player + sample JSON; DOM only is stubbed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {workshopProgressWithPass, normalizeWorkshopProgress, workshopStage} from '../public/workshop-quest.js';
import {createRoom} from '../public/room.js';
import {createProgressSaveQueue} from '../public/progress-save-queue.js';
import vm from 'node:vm';
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
 * Actual showRoom callback + actual createRoom + actual progress queue:
 * rank PUT -> slow profile GET -> optimistic accept PUT -> profile released
 * -> accept fails. No second rank PUT may snapshot an uncommitted quest.
 */
const main=chapter.quests.main;
main.prerequisites=[];
main.completion.levelIds=['ch1_cmos_not'];
chapter.levels=[{id:'ch1_cmos_not',title:'非门'}];
chapter.spaceTitle='夏商周';
chapter.questTargets={main:{type:'level',id:'ch1_cmos_not',title:'挑战非门'}};
const initial={
  position:{x:630},flags:{},tasks:{main:{status:'not-accepted',steps:{}},side:{}},
  dialogues:['npc_first_interaction'],locationId:'gate-road',
};
const saved=new Map([['ch1',{revision:7,chapterId:'ch1',state:structuredClone(initial)}]]);
const profileGate=wait();
const acceptGate=wait();
const sent=[],errors=[];
let profileGets=0,leaderboardOpened=0,revision=7;
const queue=createProgressSaveQueue({
  getSession:()=>({token:'student-token',generation:1}),
  isCurrentSession:s=>s?.token==='student-token' && s.generation===1,
  getProgress:id=>saved.get(id),
  setProgress:(id,record)=>saved.set(id,record),
  copy:structuredClone,
  sendProgress:async(id,body,token)=>{
    assert.equal(token,'student-token');
    sent.push({checkpoint:body.checkpoint,state:structuredClone(body.state),
               expectedRevision:body.expectedRevision});
    if(body.checkpoint==='quest_main_accepted') {
      await acceptGate.promise;
      throw new Error('accepted PUT failed');
    }
    assert.equal(body.expectedRevision,revision);
    revision++;
    return {progress:{chapterId:id,revision,state:structuredClone(body.state)}};
  },
});
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=app.indexOf('async function showRoom(');
const end=app.indexOf('async function syncFirstCircuitQuestCompletion(',start);
assert.ok(start>=0 && end>start);
let host=null, roomState=null;
const ctx={
  viewGeneration:0,navigationGeneration:0,
  getAuthSnapshot:()=>({token:'student-token',generation:1}),
  isAuthSnapshotCurrent:s=>s?.token==='student-token'&&s.generation===1,
  beginNavigation:()=>({request:++ctx.navigationGeneration,view:ctx.viewGeneration}),
  stillNavigating:(nav,s)=>nav.request===ctx.navigationGeneration &&
    nav.view===ctx.viewGeneration && ctx.isAuthSnapshotCurrent(s),
  stillOnView:(gen,s)=>gen===ctx.viewGeneration && ctx.isAuthSnapshotCurrent(s),
  requireChapter:id=>{assert.equal(id,'ch1');return chapter;},
  saved,gameProfile:{balance:0,inventory:{}},characters:{},me:{role:'student'},
  progressQueue:queue,SessionChangedError:Error,StaleOperationError:Error,
  page:()=>{ctx.viewGeneration++;ctx.navigationGeneration++;host=new Element('div');return host;},
  createRoom:opts=>{
    roomState=opts.state;
    return createRoom(opts);
  },
  copy:structuredClone,defaultState:()=>structuredClone(initial),
  roomDispose:null,loadGame:async()=>{},cloudDescend:async(cb)=>cb(),
  onSave:()=>{},
  showHome:()=>{},showSettings:()=>{},showPlaceholder:()=>{},
  showLeaderboard:()=>{leaderboardOpened++;},
  showError:error=>{errors.push(error.message);},
  syncFirstCircuitQuestCompletion:async()=>{},
  saveChapter:(id,state,checkpoint,owner)=>queue.save(id,state,checkpoint,owner),
  api:async(method,path,body,options)=>{
    if(path!='/api/game/profile') throw Error('Unexpected API '+path);
    profileGets++;
    if(profileGets===1)await profileGate.promise;
    return {balance:0,inventory:{}};
  },
  makeQuestReturnContext:()=>({}),
  readQuestReturnContext:()=>null,
  resolveReturnLocation:()=> 'gate-road',
  questPrerequisitesSatisfied:()=>true,
  resolveQuestDestination:()=>({reason:'not used'}),
  isWorkshopQuest:()=>false,
  console,document:globalThis.document,
};
vm.runInNewContext(app.slice(start,end)+'\nglobalThis.mount=showRoom;',ctx);
await ctx.mount('ch1','gate-road');
assert.ok(host && roomState);

const buttons=()=>host.querySelectorAll('button');
const find=label=>buttons().find(b=>b.textContent===label || b.attributes['aria-label']===label);
const tick2=()=>new Promise(resolve=>setImmediate(resolve));
const click=label=>{
  const b=find(label);assert.ok(b,'Missing button '+JSON.stringify(label));
  return b.click();
};
const ranking=click('排行');
for(let i=0;i<8 && profileGets<1;i++)await tick2();
assert.equal(profileGets,1);
assert.deepEqual(sent.map(s=>s.checkpoint),['room_open_ranking']);
assert.equal(sent[0].state.tasks.main.status,'not-accepted');

// NPC acceptance while old ranking's profile GET is pending.
await click('与 NPC 交互');
const accepting=click('接取任务');
for(let i=0;i<8 && sent.length<2;i++)await tick2();
assert.equal(sent[1].checkpoint,'quest_main_accepted');
assert.equal(sent[1].state.tasks.main.status,'accepted');
assert.equal(roomState.tasks.main.status,'accepted');

profileGate.resolve();
await tick2();
assert.equal(leaderboardOpened,0,'Ranking waits for task transaction rollback');
assert.equal(sent.length,2,'No second rank save may pre-snapshot accepted state');
acceptGate.resolve();
await Promise.allSettled([accepting,ranking]);
assert.equal(roomState.tasks.main.status,'not-accepted');
assert.equal(saved.get('ch1').state.tasks.main.status,'not-accepted');
assert.equal(saved.get('ch1').revision,8);
assert.equal(sent.length,2);
assert.ok(!sent.some(x=>x.checkpoint==='open_leaderboard'));
assert.equal(leaderboardOpened,1);
console.log('Ranking race PASS: late profile GET cannot enqueue a second full-state PUT; failed optimistic accept never persists.');
