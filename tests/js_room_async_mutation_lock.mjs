/** Real room + real player + sample JSON; DOM only is stubbed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {workshopProgressWithPass, normalizeWorkshopProgress, workshopStage} from '../public/workshop-quest.js';
import {createRoom} from '../public/room.js';
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

function runCase() {
  const host=new Element('div');
  const state={position:{x:630},flags:{},tasks:{},dialogues:['npc_first_interaction']};
  const saves=[],errors=[],barriers=[];
  const dispose=createRoom({host,chapter,location,state,
    onSave:async checkpoint=>{
      saves.push(checkpoint);
      if(checkpoint==='quest_main_accepted') {
        const pending=wait();barriers.push(pending);await pending.promise;
      }
      return {profile:{balance:0,inventory:{}}};
    },
    onError:error=>{errors.push(error.message);},
    onGetLevelResults:async()=>[],
    onStartLevel:async()=>{},
    onExit:async()=>{},
  });
  const buttons=()=>host.querySelectorAll('button');
  const find=label=>buttons().find(button=>button.textContent===label);
  async function click(label) {
    const b=find(label);
    assert.ok(b,`Missing ${label}`);
    await b.click();
  }
  function escape() {
    const event={code:'Escape',repeat:false,
      preventDefault(){},stopPropagation(){}};
    for(const handler of [...listeners.keydown||[]])handler(event);
  }
  const dialogue=()=>host.querySelector('.room-dialogue');
  return {host,state,saves,errors,barriers,dispose,find,click,escape,dialogue};
}

// Successful delayed save: Escape may close the UI but must not release the
// existing async mutation. A repeated click must not start another save.
let c=runCase();
await c.click('与 NPC 交互');
const action=c.find('接取任务').click();
await tick();
assert.deepEqual(c.saves,['quest_main_accepted']);
assert.equal(c.state.tasks.main.status,'accepted','Optimistic change while PUT pending');
c.escape();
assert.equal(c.dialogue().className,'room-dialogue');
await c.click('与 NPC 交互');
assert.equal(c.dialogue().className,'room-dialogue',
  'Must not reopen the old dialog while the earlier transaction is pending');
assert.equal(c.saves.length,1);
c.barriers[0].resolve();
await action;
await c.click('与 NPC 交互');
assert.ok(c.dialogue().className.includes('room-dialogue--open'));
assert.equal(c.find('接取任务'),undefined,'Already accepted quest must not reappear');
assert.equal(c.saves.length,1,'One action must produce only one save');
c.dispose();

// Failed delayed save: a close/reopen attempt cannot bypass the lock, and
// the original task status is restored before another attempt becomes legal.
c=runCase();
await c.click('与 NPC 交互');
const failing=c.find('接取任务').click();
await tick();
c.escape();
await c.click('与 NPC 交互');
assert.equal(c.dialogue().className,'room-dialogue');
c.barriers[0].reject(new Error('deliberate save failure'));
await failing;
assert.equal(c.state.tasks.main.status,'not-accepted');
assert.deepEqual(c.errors,['deliberate save failure']);
await c.click('与 NPC 交互');
assert.ok(c.find('接取任务'));
const retry=c.find('接取任务').click();
await tick();
assert.equal(c.saves.length,2);
c.barriers[1].resolve();
await retry;
assert.equal(c.state.tasks.main.status,'accepted');
c.dispose();

console.log('Dialogue mutation lock PASS: Escape cannot unlock an in-flight save, reopen remains blocked, success is single-write, failure rolls back and allows safe retry.');
