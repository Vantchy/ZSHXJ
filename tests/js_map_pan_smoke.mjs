/* Map camera smoke: dragging, arrows, image-space hotspot anchoring, cleanup. */
import assert from 'node:assert/strict';
import {createPannableMap} from '../public/map-viewport.js';
class Element {
  constructor(tag) {
    this.tagName=tag.toUpperCase(); this.style={}; this.children=[];
    this.listeners={}; this.attributes={}; this.className='';
    this.clientWidth=1440; this.clientHeight=900;
    this.classList={add(){},remove(){}};
  }
  setAttribute(k,v) {this.attributes[k]=v;}
  append(...children) {this.children.push(...children);}
  addEventListener(k,f) {(this.listeners[k]??=[]).push(f);}
  removeEventListener(k,f) {this.listeners[k]=(this.listeners[k]||[]).filter(x=>x!==f);}
  focus() {document.activeElement=this;}
  setPointerCapture() {} hasPointerCapture() {return false;}
  fire(k,v) {for(const f of this.listeners[k]||[]) f(v);}
}
const winHandlers={};
globalThis.document={createElement:t=>new Element(t),activeElement:null};
const animationCallbacks = new Map();
let nextFrameId = 1;
globalThis.requestAnimationFrame = (fn) => {
  const id = nextFrameId++;
  animationCallbacks.set(id, fn);
  return id;
};
globalThis.cancelAnimationFrame = (id) => animationCallbacks.delete(id);
function renderFrame(timestamp) {
  const tasks = [...animationCallbacks.values()];
  animationCallbacks.clear();
  for (const callback of tasks) callback(timestamp);
}
globalThis.window={innerWidth:1440,innerHeight:900,
  addEventListener(k,fn){(winHandlers[k]??=[]).push(fn);},
  removeEventListener(k,fn){winHandlers[k]=(winHandlers[k]||[]).filter(x=>x!==fn);},
};
const root=new Element('main');
let pressed=0;
const camera=createPannableMap({host:root,imageUrl:'/assets/scenes/world-map-grand.png',
  width:2048,height:1152,focus:{x:.68,y:.54},markers:[{
    label:'进入地图',className:'scene-gate--world-entry',x:.806,y:.568,
    onActivate(){pressed++;},
  }]});
const view=root.children[0],scene=view.children[0],gate=scene.children[1];
assert.equal(gate.style.left,'calc(80.60000000000001% + 0px)');
assert.equal(gate.style.top,'calc(56.8% + 0px)');
const initial=scene.style.transform;
view.fire('pointerdown',{pointerType:'mouse',button:0,pointerId:1,clientX:500,clientY:400,
  target:{closest(){return null;}}});
view.fire('pointermove',{pointerId:1,clientX:560,clientY:435});
view.fire('pointerup',{pointerId:1});
assert.notEqual(scene.style.transform,initial,'Drag must pan map and hotspots together');
const afterDrag=scene.style.transform;
let blocked=false;
for (const fn of winHandlers.keydown || []) {
  fn({code:'ArrowRight',preventDefault(){blocked=true;}});
}
assert.equal(blocked,true);
assert.equal(scene.style.transform, afterDrag,
  'A single keydown must not jump the map by a fixed number of pixels');
renderFrame(1000);   // establish animation timestamp
renderFrame(1016);
const firstAnimationFrame=scene.style.transform;
assert.notEqual(firstAnimationFrame,afterDrag,'Holding a key must start continuous movement');
renderFrame(1032);
assert.notEqual(scene.style.transform,firstAnimationFrame,'Holding the key pans every frame');
for (const fn of winHandlers.keyup || []) {
  fn({code:'ArrowRight'});
}
const afterRelease=scene.style.transform;
renderFrame(1048);
assert.equal(scene.style.transform,afterRelease,'Releasing the key must stop movement');
assert.equal(animationCallbacks.size,0,'No RAF should remain after release');
for (const fn of winHandlers.keydown || []) {
  fn({code:'ArrowLeft',preventDefault(){}});
}
assert.ok(animationCallbacks.size>0);
for (const fn of winHandlers.blur || []) fn();
assert.equal(animationCallbacks.size,0,'Window blur clears held keys and frame queue');
await gate.listeners.click[0]();
assert.equal(pressed,1);
camera.dispose();
assert.equal((winHandlers.keydown||[]).length,0,'Map navigation must clean up keyboard handlers');
assert.equal((winHandlers.resize||[]).length,0,'Map navigation must clean up resize handlers');
assert.equal((winHandlers.keyup||[]).length,0,'Map navigation must clean up key-release handlers');
assert.equal((winHandlers.blur||[]).length,0,'Map navigation must clean up blur handlers');
console.log('Map viewport smoke: drag + arrows + fixed image hotspot + cleanup PASS.');
