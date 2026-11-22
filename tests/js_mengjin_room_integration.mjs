/** Real room + real player + sample JSON; DOM only is stubbed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
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



/** Render the actual authored scene through the real room controller. */
const story=JSON.parse(fs.readFileSync(new URL('../public/story/ch1.json',import.meta.url),'utf8'));
const location={id:'mengjin-jade-courtyard',name:'孟津·玉匠铺',npc:'玉匠垂',
  background:'/assets/scenes/mengjin-jade-workshop.png',roomType:'story-preview',
  ...story.locations.find(l=>l.id==='mengjin-jade-courtyard')};
const characters=Object.fromEntries(story.characters.map(c=>[c.id,c]));
const chapter=JSON.parse(execFileSync('python',['-S','-c',
  'import json;from chapters import BY_ID;print(json.dumps(BY_ID[\'ch1\']))'],
  {encoding:'utf8'}));
chapter.questTargets=story.questTargets;
chapter.dialogues=story.dialogues;
const host=new Element('div');
const state={schemaVersion:2,position:{x:914},locationId:location.id,
  locationPositions:{[location.id]:{x:914}},flags:{},tasks:{},dialogues:[]};
const writes=[],errors=[],levels=[];
const dispose=createRoom({host,state,chapter,location,characters,
  onSave:async checkpoint=>writes.push(checkpoint),
  onStartLevel:async()=>levels.push('legacy'),
  onGoToLevel:async()=>levels.push('formal'),
  onExit:async()=>{},onError:e=>errors.push(e.message),
});
const buttons=()=>host.querySelectorAll('button');
const find=label=>buttons().find(b=>b.textContent===label);
const click=async label=>{clock+=300;const button=find(label);assert.ok(button,'Missing '+label);await button.click();};
const player=host.querySelector('.room-actor--player');
const npc=buttons().find(b=>b.attributes['data-npc-id']==='artisan-chui');
assert.ok(player);
assert.ok(npc);
assert.equal(host.querySelectorAll('button').filter(b=>b.className.includes('room-actor--npc')).length,1);
assert.ok(host.querySelector('.room-world-picture'));
assert.equal(host.querySelector('.room-world-picture').src,location.background);
assert.equal(state.position.x,914,'first entry from the right');
assert.ok(host.querySelector('.room-story-preview-note'));
assert.equal(host.querySelector('.room-taskbar').hidden,true,'old test task HUD is hidden');
assert.equal(writes.length,0);
// Walk left toward the craftsman. Each move uses the shared room movement.
for(let i=0;i<13;i++)await click('向左');
assert.ok(state.position.x<390 && state.position.x>260);
await npc.click();
assert.equal(speakers.at(-1).name,'旁白');
await click('继续');
assert.equal(speakers.at(-1).id,'hai');
assert.equal(speakers.at(-1).expression,'thinking');
await click('继续');
assert.equal(speakers.at(-1).id,'artisan-chui');
assert.equal(speakers.at(-1).expression,'serious');
await click('继续');
assert.equal(speakers.at(-1).expression,'surprised');
await click('继续');
assert.equal(speakers.at(-1).expression,'smile');
await click('查看「九村五贡物」题板（待制作）');
assert.equal(speakers.at(-1).name,'玩法提示');
await click('继续');
assert.equal(speakers.at(-1).name,'系统提示');
await click('继续预览后半段对白（不记录通关）');
assert.equal(speakers.at(-1).expression,'thinking');
await click('继续');
assert.equal(speakers.at(-1).id,'artisan-chui');
assert.equal(speakers.at(-1).expression,'serious');
await click('继续');
assert.equal(speakers.at(-1).name,'亥');
assert.ok(find('结束对话'));
await click('结束对话');
assert.deepEqual(levels,[],'preview must never open a formal circuit');
assert.deepEqual(errors,[]);
assert.ok(Object.values(state.tasks.side).every(q=>q.status==='not-accepted'));
assert.equal(state.tasks.main.status,'not-accepted','no quest completion claimed');
dispose();
assert.equal(listeners.keydown.length,0);
console.log('Real room preview PASS: 2 cylinder actors, right-to-left walk, authored lines/emotions, no level or task completion.');
