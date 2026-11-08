/** Editor DOM interaction smoke and deterministic orthogonal routing checks. */
import assert from 'node:assert/strict';
import {routeOrthogonal,compactPath,crossesRect,projectToPath,splitPathAt,shiftSegment,occupiedSegments,pathIsOrthogonal} from '../public/circuit-routing.js';
import {checkConnection} from '../public/circuit-interactions.js';
import {mount} from '../public/circuit-editor.js';

const rectangle={x:70,y:32,w:65,h:54};
const route=routeOrthogonal({x:0,y:62,side:'right'},{x:200,y:62,side:'left'},[rectangle]);
assert.equal(route.avoided,true,'Blocked direct route must find an obstacle-free route');
assert.ok(route.points.length>=4,'Detour should have visible corners');
for(let i=1;i<route.points.length;i++){
  const a=route.points[i-1],b=route.points[i];
  assert.ok(a.x===b.x||a.y===b.y,'Every segment must remain orthogonal');
  assert.equal(crossesRect(a,b,{x:rectangle.x-14,y:rectangle.y-14,w:rectangle.w+28,h:rectangle.h+28}),false);
}
assert.deepEqual(routeOrthogonal({x:0,y:62,side:'right'},{x:200,y:62,side:'left'},[rectangle]),route,
  'Identical topology and geometry must produce deterministic paths');
assert.equal(checkConnection({comp:'a',pin:'out'}, {comp:'b',pin:'out'},()=>({direction:'out',width:1})).valid,true);
assert.equal(checkConnection({comp:'a',pin:'out'}, {comp:'a',pin:'out'},()=>({direction:'out',width:1})).valid,false);

class TestElement {
  constructor(tag){
    this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;
    this.handlers={};this.attributes={};this.dataset={};this.hidden=false;
    this.disabled=false;this.textContent='';this.className='';this.style={};
    this.captures=new Set();
    this.classList={
      add:(...classes)=>{const current=new Set(this.className.split(' ').filter(Boolean));
        classes.forEach(c=>current.add(c));this.className=[...current].join(' ');},
      contains:(klass)=>this.className.split(' ').includes(klass),
      toggle:(klass,force)=>{
        const current=new Set(this.className.split(' ').filter(Boolean));
        if(force??!current.has(klass))current.add(klass);else current.delete(klass);
        this.className=[...current].join(' ');
      }
    };
  }
  append(...children){children.forEach(c=>{this.children.push(c);c.parentNode=this;});}
  replaceChildren(...children){for(const child of this.children)child.parentNode=null;
    this.children=[];this.append(...children);}
  setAttribute(name,value){
    this.attributes[name]=String(value);
    if(name==='class')this.className=String(value);
    if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=String(value);
  }
  getAttribute(name){return this.attributes[name]??null;}
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
  removeEventListener(type,fn){this.handlers[type]=(this.handlers[type]||[]).filter(f=>f!==fn);}
  matches(selector){
    if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
    if(selector.startsWith('[')&&selector.endsWith(']')){
      const attr=selector.slice(1,-1);return this.getAttribute(attr)!==null;
    }
    return this.tagName===selector.toUpperCase();
  }
  closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
  querySelectorAll(selector){const result=[];for(const child of this.children){
    if(child.matches(selector))result.push(child);
    result.push(...child.querySelectorAll(selector));
  }return result;}
  getBoundingClientRect(){return {left:0,top:0,right:1600,bottom:1000,width:1600,height:1000};}
  createSVGPoint(){return {x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}};}
  getScreenCTM(){return {a:1,d:1,inverse(){return this;}};}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
  async dispatch(name,props={}){
    const event={pointerId:1,button:0,clientX:500,clientY:300,
      shiftKey:false,altKey:false,target:this,
      preventDefault(){},stopPropagation(){},...props};
    for(const listener of [...(this.handlers[name]||[])])await listener(event);
  }
  async click(){await this.dispatch('click');}
}
const listeners={};
globalThis.document={
  createElement:tag=>new TestElement(tag),
  createElementNS:(_,tag)=>new TestElement(tag),
};
globalThis.window={
  confirm:()=>true,
  addEventListener:(name,fn)=>{(listeners[name]??=[]).push(fn);},
  removeEventListener:(name,fn)=>{listeners[name]=(listeners[name]||[]).filter(f=>f!==fn);},
};
const shape=(name,inputs,outputs)=>({name,family:'gate',pins:[
  ...inputs.map(x=>({name:x,direction:'in',width:1})),
  ...outputs.map(x=>({name:x,direction:'out',width:1}))
]});
const types={
  input:shape('输入',[],['out']),output:shape('输出',['in'],[]),
  xor:shape('异或门',['in1','in2'],['out']),and:shape('与门',['in1','in2'],['out']),
  junction:shape('接点',['a','b','c','d'],['out'])
};
const component=(id,type,x,y,name)=>({id,type,x,y,...(name?{name}:{})});
const edge=(c,p,d,q)=>({from:{comp:c,pin:p},to:{comp:d,pin:q}});
const initial={schemaVersion:1,components:[
  component('A','input',40,100,'A'),component('B','input',40,250,'B'),
  component('X','xor',390,120),component('G','and',390,300),
  component('SUM','output',850,120,'Sum'),component('CARRY','output',850,300,'Carry')
],wires:[
  edge('A','out','X','in1'),edge('B','out','X','in2'),
  edge('X','out','SUM','in'),edge('A','out','G','in1'),
  edge('B','out','G','in2'),edge('G','out','CARRY','in')
]};
const copy=o=>JSON.parse(JSON.stringify(o));
const state={circuitLevels:{demo:{levelVersion:1,graph:copy(initial)}}};
const level={id:'demo',title:'电路验证',layer:'gate',levelVersion:1,
  interface:{inputs:[{name:'A'},{name:'B'}],outputs:[{name:'Sum'},{name:'Carry'}]},
  allowedTypes:Object.keys(types),allowedPackages:[],initialGraph:copy(initial)};
const host=new TestElement('div');
let saved=null;
const editor=await mount({container:host,chapter:{title:'测试章节'},level,state,
  signal:new AbortController().signal,
  api:async(method,path,payload)=>{
    if(path==='/api/circuit/components')return {types,packages:[]};
    if(path==='/api/circuit/results/mine')return {results:[]};
    if(path.endsWith('/simulate'))return {pins:{},outputs:{Sum:0,Carry:0},state:{},warnings:[]};
    throw new Error(`Unmocked ${method} ${path} ${JSON.stringify(payload)}`);
  },
  saveProgress:async(progress)=>{saved=copy(progress.circuitLevels.demo.graph);},
  exit:async()=>{}
});
function elements(selector){return host.querySelectorAll(selector);}
function button(text){const result=elements('button').find(x=>x.textContent===text);
  assert.ok(result,`Expected button ${text}`);return result;}
function named(attr,value){const item=elements(`[${attr}]`).find(x=>x.getAttribute(attr)===value);
  assert.ok(item,`Expected ${attr}=${value}`);return item;}
async function snapshot(){await button('保存进度').click();assert.ok(saved);return copy(saved);}
function svg(){return elements('.ce-canvas')[0];}
function line(index){return named('data-wire',String(index));}
function pin(id,name){return elements('[data-pin-comp]').find(x=>
  x.getAttribute('data-pin-comp')===id&&x.getAttribute('data-pin')===name);}

const keyOf=w=>[`${w.from.comp}:${w.from.pin}`,`${w.to.comp}:${w.to.pin}`].sort().join('|');
function routeOf(graph,index){return graph.editorLayout.paths[keyOf(graph.wires[index])];}
function clickPoint(points){
  const segments=points.slice(1).map((b,i)=>({a:points[i],b,index:i,
    length:Math.abs(b.x-points[i].x)+Math.abs(b.y-points[i].y)}));
  const segment=segments.sort((a,b)=>b.length-a.length)[0];
  return {x:(segment.a.x+segment.b.x)/2,y:(segment.a.y+segment.b.y)/2};
}
async function hitWire(index,point,extra={}){
  await svg().dispatch('pointerdown',{target:line(index),clientX:point.x,clientY:point.y,...extra});
  await svg().dispatch('pointerup',{target:svg(),clientX:point.x,clientY:point.y,...extra});
}


// The production DOM API includes contains/remove/querySelector/focus.
// Extend this dependency-free fixture so context-menu interactions are real.
TestElement.prototype.contains=function(node){
  for(let item=node;item;item=item.parentNode)if(item===this)return true;
  return false;
};
TestElement.prototype.remove=function(){
  const parent=this.parentNode;
  if(parent)parent.children=parent.children.filter(child=>child!==this);
  this.parentNode=null;
};
TestElement.prototype.querySelector=function(selector){
  return this.querySelectorAll(selector)[0]||null;
};
TestElement.prototype.focus=function(){document.activeElement=this;};
document.activeElement=null;

function contextItems(){
  return host.querySelectorAll('[data-context-action]');
}
function menu(){
  return host.querySelectorAll('.ce-context-menu')[0]||null;
}
function action(name){
  const item=contextItems().find(x=>x.dataset.contextAction===name);
  assert.ok(item,`Missing action ${name}`);
  return item;
}
function menuLabels(){
  return contextItems().map(x=>x.querySelectorAll('.ce-context-label')[0]?.textContent);
}
async function context(target,x,y){
  await svg().dispatch('contextmenu',{target,clientX:x,clientY:y,button:2});
}
async function keyboard(key,target){
  for(const fn of listeners.keydown||[])fn({key,target:target||svg(),
    ctrlKey:false,metaKey:false,altKey:false,preventDefault(){},stopPropagation(){}});
}
function relativeLayout(graph,wireIndex){
  const key=keyOf(graph.wires[wireIndex]);
  return graph.editorLayout.paths[key];
}

// Right-click a component, select it immediately, and expose only its operations.
const initialSnapshot=await snapshot();
await context(named('data-component','X'),450,156);
assert.ok(menu(),'Right-clicking a component opens a context menu');
assert.deepEqual(menuLabels(),['顺时针旋转 90°','删除元件']);
assert.equal(menu().getAttribute('role'),'menu');
assert.equal(document.activeElement?.dataset?.contextAction,'rotate');
await menu().dispatch('keydown',{key:'ArrowDown',target:action('rotate')});
assert.equal(document.activeElement?.dataset?.contextAction,'delete',
  'ArrowDown must navigate to the next menu action');
await menu().dispatch('keydown',{key:'ArrowUp',target:action('delete')});
assert.equal(document.activeElement?.dataset?.contextAction,'rotate');
assert.equal(host.querySelectorAll('.ce-context-menu').length,1);
assert.equal((await snapshot()).components.find(c=>c.id==='X').rotation??0,0,
  'Opening the menu must not mutate topology');

// Rotation reuses the canonical editor history and preserves pin/net identity.
await action('rotate').click();
assert.equal(menu(),null,'Activating a menu operation closes the menu');
let after=await snapshot();
assert.equal(after.components.find(c=>c.id==='X').rotation,90);
assert.deepEqual(after.wires,initialSnapshot.wires,'Rotation never changes wire endpoints');
assert.equal(after.components.length,initialSnapshot.components.length);
await button('↶ 撤销').click();
after=await snapshot();
assert.equal(after.components.find(c=>c.id==='X').rotation??0,0);
await button('↷ 重做').click();
assert.equal((await snapshot()).components.find(c=>c.id==='X').rotation,90);
await button('↶ 撤销').click();

// A right-click on a pin should be treated as its component, not as a wire.
await context(pin('X','in1'),395,134);
assert.deepEqual(menuLabels(),['顺时针旋转 90°','删除元件']);
const oldGraph=await snapshot();

// Escape hides the popup but does not accidentally delete or cancel selection.
await keyboard('Escape',action('rotate'));
assert.equal(menu(),null);
assert.deepEqual(await snapshot(),oldGraph);

// Click-away and resize both close the popup; near viewport edges it is clamped.
await context(named('data-component','X'),1594,997);
assert.ok(menu());
assert.ok(parseFloat(menu().style.left)<=1600-196-5);
assert.ok(parseFloat(menu().style.top)<=1000-98-5);
await host.dispatch('pointerdown',{target:svg(),clientX:30,clientY:30});
assert.equal(menu(),null);
await context(named('data-component','X'),450,156);
for(const callback of listeners.resize||[])callback();
assert.equal(menu(),null);

// The right-click world coordinate must be retained after the user later
// clicks the HTML menu. Creating a junction must not move the original wire.
const beforeJunction=await snapshot();
const originalPath=relativeLayout(beforeJunction,0);
const insertion=clickPoint(originalPath);
await context(line(0),insertion.x,insertion.y);
assert.deepEqual(menuLabels(),['添加连接点','删除导线']);
assert.deepEqual(await snapshot(),beforeJunction,
  'Opening a wire menu must not create a junction prematurely');
await action('junction').click();
after=await snapshot();
const added=after.components.find(c=>c.type==='junction');
assert.ok(added,'Menu operation inserted an actual electrical junction');
assert.equal(added.x+14,insertion.x,'Junction X must equal the original right-click position');
assert.equal(added.y+14,insertion.y,'Junction Y must equal the original right-click position');
assert.equal(after.components.length,beforeJunction.components.length+1);
assert.equal(after.wires.length,beforeJunction.wires.length+1);
const two=after.wires.filter(w=>w.from.comp===added.id||w.to.comp===added.id);
assert.equal(two.length,2);
const joined=compactPath([
  ...relativeLayout(after,0),
  ...relativeLayout(after,1).slice(1)
]);
assert.deepEqual(joined,originalPath,
  'Adding a branch must preserve the existing visible wire geometry');

// The existing branch operation starts a new wiring draft from the junction.
// Right-click during a draft must cancel rather than open an object menu.
await context(named('data-component','X'),450,156);
assert.equal(menu(),null,'Right-click while wiring must keep cancel semantics');
assert.notEqual(elements('.ce-stage')[0].dataset.mode,'wire');
await button('↶ 撤销').click();
assert.deepEqual((await snapshot()).wires,beforeJunction.wires);
assert.equal((await snapshot()).components.length,beforeJunction.components.length);

// Wire deletion through the menu uses the same editor undo/redo bookkeeping.
const beforeDeleteWire=await snapshot();
const wirePoint=clickPoint(relativeLayout(beforeDeleteWire,0));
await context(line(0),wirePoint.x,wirePoint.y);
await action('delete').click();
after=await snapshot();
assert.equal(after.wires.length,beforeDeleteWire.wires.length-1);
await button('↶ 撤销').click();
assert.deepEqual((await snapshot()).wires,beforeDeleteWire.wires);

// Component deletion also removes connected wires; Undo restores everything.
const beforeDeleteComponent=await snapshot();
await context(named('data-component','X'),450,156);
await action('delete').click();
after=await snapshot();
assert.ok(!after.components.some(c=>c.id==='X'));
assert.equal(after.wires.length,
  beforeDeleteComponent.wires.filter(w=>w.from.comp!=='X'&&w.to.comp!=='X').length);
await button('↶ 撤销').click();
assert.deepEqual((await snapshot()).wires,beforeDeleteComponent.wires);

// Required output/input port confirmations still go through canonical delete.
window.confirm=()=>false;
const beforeRequired=await snapshot();
await context(named('data-component','A'),106,100);
await action('delete').click();
assert.deepEqual(await snapshot(),beforeRequired,'Cancelled confirmation preserves input');
window.confirm=()=>true;

// Right-click blank space must never show object operations.
await context(svg(),1200,830);
assert.equal(menu(),null);

// Existing right-click-to-cancel behavior also applies to palette placement.
const paletteItem=elements('.ce-palette-item').find(x=>x.dataset.type==='and');
assert.ok(paletteItem);
await paletteItem.click();
assert.equal(elements('.ce-stage')[0].dataset.mode,'place');
await context(named('data-component','G'),430,320);
assert.equal(menu(),null,'Placement cancellation must not open a context menu');
assert.notEqual(elements('.ce-stage')[0].dataset.mode,'place');

// During an unfinished wire, right-click on a component cancels the draft.
await svg().dispatch('pointerdown',{target:pin('SUM','in'),clientX:850,clientY:120});
await context(named('data-component','G'),430,320);
assert.equal(menu(),null);
assert.notEqual(elements('.ce-stage')[0].dataset.mode,'wire');

// No dangling global listeners, menus, or stale pointers when leaving the page.
await context(named('data-component','G'),430,320);
assert.ok(menu());
editor.dispose();
assert.equal(menu(),null);
assert.equal((listeners.keydown||[]).length,0);
assert.equal((listeners.resize||[]).length,0);
assert.equal((host.handlers.pointerdown||[]).length,0);
console.log('Context menu smoke PASS: component/pin, rotation, deletion,');
console.log('wire insertion at exact click point, undo, cancel, placement,');
console.log('edge positioning, Escape, dismiss and cleanup.');
