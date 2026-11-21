/** Real room + real player + sample JSON; DOM only is stubbed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
globalThis.document = {activeElement:null, createElement: tag => new Element(tag)};
globalThis.window = {
  get innerWidth(){return layout.width;},
  addEventListener(type, fn) {(listeners[type] ??= []).push(fn);},
  removeEventListener(type, fn) {listeners[type] = (listeners[type] || []).filter(item => item !== fn);},
  NPCDialogueDisplay: {setSpeaker: value => speakers.push(value), clearSpeaker: () => speakers.push(null)},
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};


const data=JSON.parse(fs.readFileSync(new URL('../public/story/ch1.json',import.meta.url)));
const spec=JSON.parse(fs.readFileSync(new URL('../levels/ch1_binary_decoder_v1.json',import.meta.url)));
const host=new Element('div');const calls=[],saved=[];
const state={position:{x:200},flags:{},tasks:{},dialogues:[]};
const main={id:'main',type:'main',title:'主线任务',steps:[],completion:{mode:'official-circuit',levelIds:['ch1_cmos_not']}};
const binary={id:'binary-decoder',type:'side',title:'二进制练习：两位译码',steps:[{id:'decode-four-combinations',title:'通过四种组合'}],prerequisites:[],completion:{mode:'official-circuit',levelIds:[spec.id]}};
const dispose=createRoom({host,state,location:{id:'gate-road'},
 chapter:{id:'ch1',order:1,npc:'玉匠垂',npcLine:'',questTargets:data.questTargets,levels:[{id:'ch1_cmos_not',title:'非门'},{id:spec.id,title:spec.title}],quests:{main,side:[binary]}},
 onSave:async()=>{saved.push(structuredClone(state));},onStartLevel:async()=>{throw Error('Wrong default route');},
 onGoToLevel:async id=>{calls.push(id);},onExit:async()=>{},onError:error=>{throw error;}});
const buttons=()=>host.querySelectorAll('button');
await buttons().find(b=>b.className==='room-taskbar-toggle').click();
await buttons().find(b=>b.className.includes('room-quest-task')&&b.textContent===binary.title).click();
const go=buttons().find(b=>b.className==='room-quest-go');
assert.equal(go.disabled,false);assert.equal(go.textContent,'接取并前往');
await go.click();assert.deepEqual(calls,[spec.id]);
assert.equal(state.tasks.main.status,'not-accepted','Binary entry must not claim the old main task');
assert.equal(state.tasks.side[binary.id].status,'accepted');
assert.equal(saved[0].tasks.side[binary.id].steps['decode-four-combinations'].status,'current');
dispose();assert.equal(listeners.keydown.length,0);
console.log('Binary task route PASS: actual chapter target opens the new formal level, independent side-task acceptance, original main untouched, and listener cleanup.');
