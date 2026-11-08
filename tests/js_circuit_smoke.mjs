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

// Click to SELECT a wire first. The inspector action must NOT change the graph
// before the user chooses a position on that wire.
const before=await snapshot();
const lineBefore=routeOf(before,0);
const insert=clickPoint(lineBefore);
await hitWire(0,insert);
await button('在导线上添加分支').click();
let output=await snapshot();
assert.equal(output.components.filter(c=>c.type==='junction').length,0,
  'Entering branch mode must NOT generate a junction by itself');
assert.deepEqual(routeOf(output,0),lineBefore,'Arming junction mode leaves original geometry untouched');
await svg().dispatch('pointermove',{target:line(0),clientX:insert.x,clientY:insert.y});
assert.ok(elements('.ce-tap-preview').length,'Hover must preview location before committing');
await hitWire(0,insert);
output=await snapshot();
const junction=output.components.find(c=>c.type==='junction');
assert.ok(junction,'Second click at specified position creates a junction');
assert.equal(output.wires.length,initial.wires.length+1);
assert.equal(junction.x+14,insert.x);
assert.equal(junction.y+14,insert.y);
const first=routeOf(output,0),second=routeOf(output,1);
assert.deepEqual(compactPath([...first,...second.slice(1)]),lineBefore,
  'Splitting a wire must preserve every segment of the original route');
assert.ok(output.wires.some(w=>w.from.comp==='A'&&w.to.comp===junction.id));
assert.ok(output.wires.some(w=>w.from.comp===junction.id&&w.to.comp==='X'));

// Existing sink connection stays intact when another conductor is attached.
assert.ok(pin('SUM','in'));
await svg().dispatch('pointerdown',{target:pin('SUM','in')});
output=await snapshot();
assert.equal(output.wires.filter(w=>w.to.comp==='SUM'&&w.to.pin==='in').length,2,
  'A lamp terminal must retain both incoming wires rather than silently replacing one');
assert.ok(output.wires.some(w=>w.from.comp==='X'&&w.to.comp==='SUM'));

// Rotating a gate preserves connected electrical endpoints and manual paths.
await svg().dispatch('pointerdown',{target:named('data-component','X')});
await svg().dispatch('pointerup',{target:svg()});
await button('顺时针旋转 90°（R）').click();
output=await snapshot();
assert.equal(output.components.find(c=>c.id==='X').rotation,90);
assert.equal(output.wires.length,initial.wires.length+2);

// Explicit Shift-click on a wire is an intentional one-step shortcut.
const tap2=clickPoint(routeOf(output,2));
await hitWire(2,tap2,{shiftKey:true});
output=await snapshot();
assert.equal(output.components.filter(c=>c.type==='junction').length,2);
assert.equal(output.wires.length,initial.wires.length+3);

// Dragging a straight segment adds a tidy dogleg without moving either pin.
const original=[{x:10,y:40},{x:280,y:40}];
const shifted=shiftSegment(original,0,36);
assert.deepEqual(shifted[0],original[0]);
assert.deepEqual(shifted[shifted.length-1],original[1]);
assert.deepEqual(shifted,[{x:10,y:40},{x:10,y:76},{x:280,y:76},{x:280,y:40}]);
assert.deepEqual(splitPathAt(original,{x:120,y:40}).before,[{x:10,y:40},{x:120,y:40}]);
assert.deepEqual(projectToPath({x:121,y:45},original).point,{x:121,y:40});

// Unrelated nets should not lie on top of each other when a separate lane exists.
const aRoute=routeOrthogonal({x:0,y:0,side:'right'}, {x:300,y:90,side:'left'},[]);
const bRoute=routeOrthogonal({x:0,y:90,side:'right'}, {x:300,y:0,side:'left'},[],
  {occupied:occupiedSegments(aRoute.points,'A'),net:'B'});
function sharedLength(a,b){let shared=0;
  for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++){
    const p=a[i-1],q=a[i],s=b[j-1],t=b[j];
    const h=p.y===q.y,v=s.y===t.y;
    if(h===v && (h?p.y===s.y:p.x===s.x)){
      shared+=Math.max(0,Math.min(h?Math.max(p.x,q.x):Math.max(p.y,q.y),h?Math.max(s.x,t.x):Math.max(s.y,t.y))-
        Math.max(h?Math.min(p.x,q.x):Math.min(p.y,q.y),h?Math.min(s.x,t.x):Math.min(s.y,t.y)));
    }
  }return shared;
}
assert.equal(sharedLength(aRoute.points,bRoute.points),0,'Unrelated routes must not overlap');


// Exit the draft automatically started by the previous Shift-click tap.
await svg().dispatch('contextmenu',{target:svg()});
// Screen-space picking should work even if the SVG browser hit target is only
// the blank canvas (the point is close to, but not exactly on, the terminal).
const beforeSnap=await snapshot();
await svg().dispatch('pointerdown',{
  target:svg(),clientX:176,clientY:138
}); // input A's 'out' terminal is at (168, 138)
assert.equal(elements('.ce-stage')[0].dataset.mode,'wire',
  'A slightly inaccurate click must still start wiring from the nearest pin');
await svg().dispatch('contextmenu',{target:svg()});
assert.deepEqual(await snapshot(),beforeSnap,
  'Starting and cancelling a snapped draft never mutates the electrical netlist');

// A junction tap made slightly off the painted wire must land exactly ON the
// underlying orthogonal segment, without shifting its original path.
const priorTap=await snapshot();
const candidates=[];
priorTap.wires.forEach((wire,index)=>{
  const points=routeOf(priorTap,index);
  for(let segment=0;segment<points.length-1;segment++){
    const a=points[segment],b=points[segment+1];
    const length=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
    if(length>90)candidates.push({index,length,a,b});
  }
});
assert.ok(candidates.length,'Fixture must contain a long wire segment');
candidates.sort((a,b)=>b.length-a.length);
const chosen=candidates[0];
const tapPoint={x:(chosen.a.x+chosen.b.x)/2,y:(chosen.a.y+chosen.b.y)/2};
const nearPoint=chosen.a.y===chosen.b.y
  ?{x:tapPoint.x,y:tapPoint.y+7}:{x:tapPoint.x+7,y:tapPoint.y};
await hitWire(chosen.index,tapPoint);
await button('在导线上添加分支').click();
await svg().dispatch('pointermove',{target:svg(),clientX:nearPoint.x,clientY:nearPoint.y});
const previews=elements('.ce-tap-preview');
assert.equal(previews.length,1,'Hover 7 screen px from wire must preview a branch point');
assert.equal(Number(previews[0].getAttribute('cx')),tapPoint.x);
assert.equal(Number(previews[0].getAttribute('cy')),tapPoint.y);
await svg().dispatch('pointerdown',{target:svg(),clientX:nearPoint.x,clientY:nearPoint.y});
const afterTap=await snapshot();
const oldIds=new Set(priorTap.components.map(c=>c.id));
const newJunction=afterTap.components.find(c=>c.type==='junction'&&!oldIds.has(c.id));
assert.ok(newJunction,'Clicking 7 px off a wire must still create the junction');
assert.equal(newJunction.x+14,tapPoint.x,'Junction must be ON the original wire');
assert.equal(newJunction.y+14,tapPoint.y,'Junction must be ON the original wire');


// The previous branch operation starts a new junction draft; exit that mode.
await svg().dispatch('contextmenu',{target:svg()});
// A point well outside the modest terminal tolerance must not start wiring.
await svg().dispatch('pointerdown',{
  target:svg(),clientX:188,clientY:158
});
assert.notEqual(elements('.ce-stage')[0].dataset.mode,'wire',
  'Do not hijack ordinary canvas actions by snapping too far away');
await svg().dispatch('pointerup',{target:svg(),clientX:188,clientY:158});

// Moving an already wired component hides only its own wires until pointerup.
await svg().dispatch('contextmenu',{target:svg()}); // clear junction draft
const beforeMove=await snapshot();
const connected=beforeMove.wires.filter(w=>w.from.comp==='A'||w.to.comp==='A').length;
assert.ok(connected>0);
assert.equal(elements('.ce-wire-hit-area').length,beforeMove.wires.length);
await svg().dispatch('pointerdown',{
  target:named('data-component','A'),clientX:95,clientY:112
});
await svg().dispatch('pointermove',{
  target:svg(),clientX:167,clientY:148
});
assert.equal(elements('.ce-wire-hit-area').length,beforeMove.wires.length-connected,
  'Dragging must hide connected lines without rerouting on every mouse move');
await svg().dispatch('pointerup',{target:svg(),clientX:167,clientY:148});
const afterMove=await snapshot();
assert.equal(elements('.ce-wire-hit-area').length,afterMove.wires.length,
  'Committed drag must reveal newly generated orthogonal wires');
assert.deepEqual(afterMove.wires,beforeMove.wires,
  'Dragging a component must preserve the electrical graph');
assert.equal(afterMove.components.find(c=>c.id==='A').x,
  Math.round((beforeMove.components.find(c=>c.id==='A').x+72)/12)*12);
for(let i=0;i<afterMove.wires.length;i++)
  assert.ok(pathIsOrthogonal(routeOf(afterMove,i)),`Wire ${i} must remain orthogonal`);

editor.dispose();
assert.equal((listeners.keydown||[]).length,0,'Editor global listeners must be released');
console.log('Circuit UI smoke passed: precise branches, screen-space snapping, drag-time wire hiding, orthogonal rerouting and cleanup.');
