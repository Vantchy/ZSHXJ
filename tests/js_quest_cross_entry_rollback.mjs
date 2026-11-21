/** Real room + real player + sample JSON; DOM only is stubbed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {workshopProgressWithPass, normalizeWorkshopProgress, workshopStage} from '../public/workshop-quest.js';
import {createRoom} from '../public/room.js';
import {createProgressSaveQueue} from '../public/progress-save-queue.js';
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


// Accelerate only the 850ms movement auto-save; other timers retain native
// behavior (toast cleanup, dialog player etc.).
const originalSetTimeout=globalThis.setTimeout;
const originalClearTimeout=globalThis.clearTimeout;
const autos=new Map();
let timerNo=1000000;
globalThis.setTimeout=(fn,delay,...args)=>{
  if (delay===850) {
    const id=++timerNo;
    autos.set(id,()=>fn(...args));
    return id;
  }
  return originalSetTimeout(fn,delay,...args);
};
globalThis.clearTimeout=id=>{
  if (autos.delete(id)) return;
  return originalClearTimeout(id);
};
function flushMovementSaves() {
  const items=[...autos.values()];
  autos.clear();
  for (const fn of items) fn();
}
const clone=structuredClone;
const mainQuest=chapter.quests.main;
mainQuest.completion.levelIds=['ch1_cmos_not'];
mainQuest.prerequisites=[];
chapter.levels=[{id:'ch1_cmos_not',title:'非门'}];
chapter.questTargets={main:{type:'level',id:'ch1_cmos_not',title:'进入非门'}};

function setup({failFirst=true}={}) {
  const host=new Element('div');
  const state={position:{x:630},flags:{},tasks:{},dialogues:['npc_first_interaction']};
  const saved=new Map([['ch1',{revision:7,state:clone(state)}]]);
  const sent=[],errors=[],levels=[],exits=[];
  const gate=wait();
  let revision=7;
  const queue=createProgressSaveQueue({
    getSession:()=>({token:'student',generation:1}),
    isCurrentSession:s=>s.token==='student'&&s.generation===1,
    getProgress:id=>saved.get(id),
    setProgress:(id,progress)=>saved.set(id,progress),
    copy:clone,
    sendProgress:async(id,payload,token)=>{
      assert.equal(token,'student');
      sent.push({checkpoint:payload.checkpoint,
                 state:clone(payload.state),revision:payload.expectedRevision});
      if(payload.checkpoint==='quest_main_accepted') {
        await gate.promise;
        if(failFirst) throw new Error('deliberate first PUT failure');
      }
      assert.equal(payload.expectedRevision,revision);
      revision++;
      return {progress:{chapterId:id,revision,state:clone(payload.state)}};
    },
  });
  const dispose=createRoom({host,chapter,location,state,
    onSave:checkpoint=>queue.save('ch1',state,checkpoint),
    onGetLevelResults:async()=>[],
    onStartLevel:async()=>levels.push('start'),
    onGoToLevel:async level=>levels.push(level),
    onExit:async()=>{exits.push(clone(state));},
    onWorldMap:async()=>{exits.push(clone(state));},
    onError:e=>errors.push(e.message),
  });
  const buttons=()=>host.querySelectorAll('button');
  const find=label=>buttons().find(button=>button.textContent===label);
  const byClass=klass=>buttons().find(b=>b.className.split(' ').includes(klass));
  const click=label=>{const b=find(label);assert.ok(b,'Missing '+label);return b.click();};
  const escape=()=>{
    const event={code:'Escape',repeat:false,preventDefault(){},stopPropagation(){}};
    for(const f of [...listeners.keydown||[]])f(event);
  };
  return {host,state,saved,sent,errors,levels,exits,gate,dispose,find,byClass,
          click,escape,queue};
}

// The exact adversarial sequence from the independent V4 audit:
// optimistic quest accept -> Escape -> move -> queued auto-save ->
// original PUT fails -> rollback -> auto-save PUT.
let c=setup({failFirst:true});
await c.click('与 NPC 交互');
const accepting=c.click('接取任务');
await tick();
assert.equal(c.sent.length,1);
assert.equal(c.sent[0].state.tasks.main.status,'accepted');
assert.equal(c.state.tasks.main.status,'accepted');

c.escape();
assert.equal(c.host.querySelector('.room-dialogue').className,'room-dialogue');
await c.click('向右');
assert.notEqual(c.state.position.x,630,'movement is actually permitted');
flushMovementSaves();
await tick();
assert.equal(c.sent.length,1,
  'A movement auto-save must NOT capture optimistic accepted before rollback');

// Task-book is another independent entry; it must not start level navigation
// or mutate task while the acceptance transaction is unresolved.
await c.byClass('room-taskbar-toggle').click();
const go=c.byClass('room-quest-go');
assert.ok(go);
assert.equal(go.disabled,true);
await go.click();
assert.equal(c.levels.length,0);
assert.equal(c.sent.length,1);
c.gate.resolve();
await accepting;
for(let i=0;i<8 && c.sent.length<2;i++)await tick();
assert.equal(c.sent.length,2,'Queued movement auto-save proceeds after rollback');
assert.equal(c.sent[1].checkpoint,'room_moved');
assert.equal(c.sent[1].state.tasks.main.status,'not-accepted',
  'The second PUT may not persist the rejected optimistic acceptance');
for(let i=0;i<6 && c.saved.get('ch1').revision<8;i++)await tick();
assert.equal(c.state.tasks.main.status,'not-accepted');
assert.equal(c.saved.get('ch1').state.tasks.main.status,'not-accepted');
assert.equal(c.saved.get('ch1').revision,8);
assert.ok(c.errors.includes('deliberate first PUT failure'));
c.dispose();

// Exits must also wait for rollback before observing/saving chapter state.
c=setup({failFirst:true});
await c.click('与 NPC 交互');
const failure=c.click('接取任务');
await tick();
c.escape();
const exiting=c.click('小地图');
await tick();
assert.equal(c.exits.length,0);
c.gate.resolve();
await Promise.all([failure,exiting]);
assert.equal(c.exits.length,1);
assert.equal(c.exits[0].tasks.main.status,'not-accepted',
  'Exiting must observe the rolled back state, never optimistic status');
c.dispose();

// A successfully committed acceptance remains accepted; movement auto-save
// runs afterwards and preserves the legitimate update.
c=setup({failFirst:false});
await c.click('与 NPC 交互');
const success=c.click('接取任务');
await tick();
c.escape();
await c.click('向右');
flushMovementSaves();
await tick();
assert.equal(c.sent.length,1);
c.gate.resolve();
await success;
for(let i=0;i<8 && c.sent.length<2;i++)await tick();
assert.equal(c.sent.length,2);
assert.equal(c.sent[1].state.tasks.main.status,'accepted');
assert.equal(c.saved.get('ch1').state.tasks.main.status,'accepted');
c.dispose();

console.log('Cross-entry task rollback PASS: failed optimistic accept + Escape + move cannot persist accepted; task book blocked; exit waits; successful accept saves normally.');
