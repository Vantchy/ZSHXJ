/* Item inspection and clay-mold idempotence; no browser/npm dependency. */
import assert from "node:assert/strict";
import { createItemInspector, findRoomObject } from "../public/room-interactions.js";
import { createRoom } from "../public/room.js";

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.handlers = {};
    this.textContent = "";
    this.disabled = false;
    this.parentNode = null;
  }
  append(...children) {
    for (const child of children) { child.parentNode = this; this.children.push(child); }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(item => item !== this);
    }
    this.parentNode = null;
  }
  addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); }
  removeEventListener(name, fn) {
    this.handlers[name] = (this.handlers[name] || []).filter(f => f !== fn);
  }
  setAttribute() {}
  focus() { document.activeElement = this; }
  getBoundingClientRect() { return {left:0,top:0,width:960,height:520}; }
  querySelectorAll(tag) {
    return this.children.flatMap(child => [
      ...(child.tagName === tag.toUpperCase() ? [child] : []),
      ...child.querySelectorAll(tag),
    ]);
  }
  async click() {
    for (const fn of (this.handlers.click || [])) await fn({preventDefault() {},stopPropagation() {}});
  }
}
const listeners = {};
globalThis.document = {activeElement:null,createElement:tag=>new Element(tag)};
globalThis.window = {
  addEventListener(type,cb) {(listeners[type] ??= []).push(cb);},
  removeEventListener(type,cb) {listeners[type]=(listeners[type]||[]).filter(x=>x!==cb);},
};
globalThis.requestAnimationFrame = ()=>1;
globalThis.cancelAnimationFrame = ()=>{};
const tick = ()=>new Promise(resolve=>setTimeout(resolve,0));
const findButton = (el,text)=>el.querySelectorAll("button").find(b=>b.textContent===text);

assert.equal(findRoomObject("gate-road")?.title, "陶范");
assert.equal(findRoomObject("inner-lane"),null);
const stage=new Element("main");
const inspector=createItemInspector(stage);
const specimen={id:"clay-mold",title:"陶范",description:"合缝需严密"};
const first=inspector.open(specimen);
assert.equal(inspector.open(specimen),first,"Same item should reuse its panel");
assert.equal(stage.querySelectorAll("aside").length,1);
inspector.open({id:"other",title:"旧铜钥",description:"测试物品"});
assert.equal(stage.querySelectorAll("aside").length,1,"Opening another item replaces panel");
inspector.close();
assert.equal(stage.querySelectorAll("aside").length,0);

const host=new Element("div");
const saves=[];
const state={position:{x:960},dialogues:[],flags:{},tasks:{main:{},side:{}}};
const dispose=createRoom({
  host, chapter:{id:"ch1",order:1,room:"工坊",npc:"工匠",
    quests:{main:{id:"main",title:"主线：工坊委托"},side:[]}},
  state, location:{id:"gate-road",name:"城门旁道路"},
  onSave:async checkpoint=>{saves.push(checkpoint);return {};},
  onStartLevel:async()=>{},onExit:async()=>{},onError:e=>{throw e;},
});
await findButton(host,"与 NPC 交互").click();
await tick();
assert.equal(state.flags.investigatedMold,true);
await findButton(host,"与 NPC 交互").click();
await tick();
assert.equal(saves.filter(x=>x==="investigate_mold").length,1,"No duplicate investigation saves");
assert.equal(host.querySelectorAll("aside").length,1,"One reusable inspector panel");
await findButton(host,"收起").click();
assert.equal(host.querySelectorAll("aside").length,0);
await findButton(host,"与 NPC 交互").click();
await tick();
assert.equal(host.querySelectorAll("aside").length,1,"Reopening does not re-save");
assert.equal(saves.filter(x=>x==="investigate_mold").length,1);
dispose();
assert.equal(host.querySelectorAll("aside").length,0);
// Failed investigations roll back the progress flag and may be retried.
const failHost=new Element("div");
const failState={position:{x:960},dialogues:[],flags:{},tasks:{}};
let failedOnce=false;
let errorCount=0;
let saveAttempts=0;
const stopFail=createRoom({
  host:failHost, chapter:{id:"ch1",room:"工坊",npc:"工匠",quests:{main:null,side:[]}},
  state:failState,location:{id:"gate-road"},
  onSave:async checkpoint=>{
    if(checkpoint==="investigate_mold"){
      saveAttempts++;
      if(!failedOnce) {failedOnce=true;throw new Error("simulate database outage");}
    }
    return {};
  },
  onStartLevel:async()=>{},onExit:async()=>{},
  onError:()=>{errorCount++;},
});
await findButton(failHost,"与 NPC 交互").click();
await tick();
assert.equal(failState.flags.investigatedMold,false,"Failed investigation must roll back local flag");
assert.equal(errorCount,1);
await findButton(failHost,"与 NPC 交互").click();
await tick();
assert.equal(failState.flags.investigatedMold,true,"Investigation can retry");
assert.equal(saveAttempts,2);
stopFail();
// An actual item opens details *inside* the bag modal, not behind an inert stage.
const bagHost=new Element('div');
const bagState={position:{x:300},dialogues:[],flags:{},tasks:{main:{},side:{}}};
const stopBag=createRoom({host:bagHost,chapter:{id:'ch1',room:'地图',npc:'人物',
  quests:{main:null,side:[]}},state:bagState,location:{id:'gate-road'},
  inventory:[{id:'qa-item',name:'物品一',note:'测试物品说明'}],
  onSave:async()=>({}),onStartLevel:async()=>{},onExit:async()=>{},onError:e=>{throw e;}});
const shortcut=bagHost.querySelectorAll('button').find(b=>
  String(b.className||'').includes('room-shortcut--bag'));
assert.ok(shortcut,'Bag shortcut missing');
await shortcut.click();await tick();
const itemButton=bagHost.querySelectorAll('button').find(b=>b.textContent==='物品一');
assert.ok(itemButton,'Bag must show actual inventory items');
await itemButton.click();
assert.ok(bagHost.querySelectorAll('p').some(x=>x.textContent.includes('测试物品说明')),
  'Item details must appear inside the bag itself');
assert.equal(bagHost.querySelectorAll('aside').length,0,'No inert-stage item detail overlay');
stopBag();
// Extra inventory items must be appended to the scrollable grid, not silently dropped.
const manyHost=new Element('div');
const manyState={position:{x:300},dialogues:[],flags:{},tasks:{main:{},side:{}}};
const items=Array.from({length:17},(_,i)=>({id:`test-${i}`,name:`物品${i+1}`,note:'测试'}));
const stopMany=createRoom({host:manyHost,chapter:{id:'ch1',room:'地图',npc:'人物',
  quests:{main:null,side:[]}},state:manyState,location:{id:'gate-road'},
  inventory:items,onSave:async()=>({}),onStartLevel:async()=>{},
  onExit:async()=>{},onError:e=>{throw e;}});
const gridButton=manyHost.querySelectorAll('button').find(b=>b.textContent==='物品17');
assert.ok(gridButton,'All 17 actual items must be in the bag grid');
stopMany();
console.log("Room object smoke: single inspector, idempotent save, reopen/close/dispose, retry on failure, in-bag item detail, overflow inventory PASS.");
