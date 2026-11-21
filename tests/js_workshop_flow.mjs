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

const story=JSON.parse(fs.readFileSync(new URL('../public/story/ch1.json',import.meta.url)));
const chapter=JSON.parse(execFileSync('python',['-c',"import json;from chapters import BY_ID;print(json.dumps(BY_ID['ch1']))"],{encoding:'utf8'}));
chapter.questTargets=story.questTargets; chapter.dialogues=story.dialogues;
const quest=chapter.quests.side.find(q=>q.id==='binary-decoder');
const characters=Object.fromEntries(story.characters.map(c=>[c.id,c]));
const location=story.locations[0];
let host,state,dispose,results=[],calls=[],saves=[],failCheckpoint='',errors=[];
function open(savedState) {
  host=new Element('div'); state=savedState || {position:{x:630},flags:{},tasks:{},dialogues:[]};
  dispose=createRoom({host,chapter,state,location,characters,
    onSave:async checkpoint=>{if(checkpoint===failCheckpoint){failCheckpoint='';throw Error('Save failed');}saves.push({checkpoint,state:structuredClone(state)});},
    onGoToLevel:async id=>{calls.push(id);}, onStartLevel:async()=>{}, onExit:async()=>{},
    onGetLevelResults:async()=>results, onError:error=>{errors.push(error.message);}});
}
const buttons=()=>host.querySelectorAll('button');
const find=label=>buttons().find(b=>b.textContent===label);
async function click(label){clock+=200;assert.ok(find(label),'Missing '+label);await find(label).click();}
async function until(label){for(let i=0;i<50&&!find(label);i++){if(find('继续'))await click('继续');else if(find('那你说说，怎么记？'))await click('那你说说，怎么记？');else if(find('我明白了，继续'))await click('我明白了，继续');else throw Error('Stuck before '+label);}assert.ok(find(label));}
const phase=()=>workshopStage(state.tasks.side[quest.id]);
open();
await click('与 NPC 交互'); assert.equal(state.tasks.side[quest.id].status,'accepted');
await until('抱歉，有点不懂，能再说一遍吗');
const before=structuredClone(state.tasks);await click('抱歉，有点不懂，能再说一遍吗');
await until('我明白了，继续');assert.deepEqual(state.tasks,before,'Repeat must not advance tasks');
await click('离开交谈'); assert.equal(phase(),'intro');
await click('与 NPC 交互'); assert.ok(host.querySelectorAll('p').some(p=>p.textContent.startsWith('孟津')),'Incomplete intro restarts from its paragraph');
await until('开始译码练习');
failCheckpoint='workshop_intro_finished'; await click('稍后练习');
assert.equal(phase(),'intro');assert.ok(find('开始译码练习'),'Failed save keeps retry action');
await click('稍后练习');assert.equal(phase(),'exercise');assert.equal(calls.length,0);
await click('与 NPC 交互');await until('继续译码练习');
await click('重听说明');await until('返回当前进度');
assert.equal(phase(),'exercise');await click('返回当前进度');await until('继续译码练习');
await click('继续译码练习');assert.deepEqual(calls,['ch1_binary_decoder']);
assert.equal(state.tasks.main.status,'not-accepted');
const draft={test:'preserved'};state.circuitLevels={ch1_binary_decoder:draft};
let snapshot=structuredClone(state);dispose();open(snapshot);assert.equal(phase(),'exercise');
await click(''); // first empty button is task toggle in the real HUD
assert.ok(buttons().find(b=>b.className==='room-quest-go'));
// A local partial test and another level's official pass cannot advance this task.
results=[{levelId:'ch1_binary_decoder',completed:true,assessmentType:'local'}, {levelId:'ch1_cmos_not',completed:true,assessmentType:'circuit_server'}];
const partial=workshopProgressWithPass(state.tasks.side[quest.id],quest,results);assert.equal(workshopStage(partial),'exercise');
results=[{levelId:'ch1_binary_decoder',completed:true,assessmentType:'circuit_server'}];
await click('前往');assert.equal(phase(),'report');assert.equal(calls.length,1,'Existing pass must skip redundant entry');
await until('完成本场');
await click('上一句');assert.equal(phase(),'report');await until('完成本场');
failCheckpoint='workshop_scene_finished';await click('完成本场');
assert.equal(state.tasks.side[quest.id].status,'completed');assert.ok(find('完成本场'));
await click('完成本场');assert.equal(state.tasks.side[quest.id].status,'submitted');assert.equal(phase(),'done');
assert.deepEqual(state.circuitLevels.ch1_binary_decoder,draft);assert.equal(state.tasks.main.status,'not-accepted');
assert.ok(host.querySelectorAll('span').some(p=>p.textContent.startsWith('✓ 已完成')));
const done=structuredClone(state);dispose();open(done);
await click('与 NPC 交互');await until('重温对白');const beforeReplay=structuredClone(state.tasks);
await click('重温对白');await until('返回当前进度');assert.deepEqual(state.tasks,beforeReplay);
await click('返回当前进度');await until('重做练习');await click('重做练习');assert.equal(calls.length,2);assert.deepEqual(state.tasks,beforeReplay);dispose();
// Legacy v0.8 lifecycle is kept; its already-done circuit never goes backwards.
const legacy={position:{x:630},tasks:{side:{'binary-decoder':{status:'submitted',steps:{'decode-four-combinations':{status:'done'}}}}},flags:{},dialogues:[]};
open(legacy);assert.equal(phase(),'intro');await click('与 NPC 交互');await until('开始译码练习');await click('开始译码练习');assert.equal(phase(),'report');assert.equal(calls.length,2);await until('完成本场');await click('完成本场');assert.equal(phase(),'done');dispose();
assert.equal(listeners.keydown.length,0);assert.deepEqual(errors,['Save failed','Save failed']);
console.log('Workshop PASS: intro/repeat/review, save retries, pause/resume, grade evidence, report/submit, replay, v0.8 saves and draft preservation.');
