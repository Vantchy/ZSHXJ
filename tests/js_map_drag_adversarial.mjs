/**
 * Adversarial map viewport regression.
 * Run with: node tests/js_map_pan_smoke.mjs
 * Covers repeated drags, hard-edge reversal, interrupted pointer sequences,
 * delayed lostcapture, map hotspots, keyboard motion and listener cleanup.
 */
import assert from 'node:assert/strict';
import {createPannableMap} from '../public/map-viewport.js';

class Emitter {
  constructor(tag='window') {
    this.tagName=tag.toUpperCase();
    this.listeners=new Map();
    this.style={};
    this.children=[];
    this.attributes={};
    this.clientWidth=1440;
    this.clientHeight=846;
    this.flags=new Set();
    this.classList={
      add:name=>this.flags.add(name),
      remove:name=>this.flags.delete(name),
      contains:name=>this.flags.has(name),
    };
    this.captured=new Set();
    this.tabIndex=-1;
  }
  addEventListener(name,fn) {
    if(!this.listeners.has(name))this.listeners.set(name,[]);
    this.listeners.get(name).push(fn);
  }
  removeEventListener(name,fn) {
    this.listeners.set(name,(this.listeners.get(name)||[]).filter(x=>x!==fn));
  }
  listenerCount(name) {return (this.listeners.get(name)||[]).length;}
  fire(name,event={}) {
    event.type??=name;
    for(const fn of [...(this.listeners.get(name)||[])])fn(event);
    return event;
  }
  setAttribute(name,value){this.attributes[name]=String(value);}
  append(...children){this.children.push(...children);for(const c of children)c.parent=this;}
  focus(){globalThis.document.activeElement=this;}
  setPointerCapture(id){this.captured.add(id);}
  hasPointerCapture(id){return this.captured.has(id);}
  releasePointerCapture(id){
    this.captured.delete(id);
    // Native browsers can dispatch this after a *new* pointerdown.
    queueMicrotask(()=>this.fire('lostpointercapture',{pointerId:id}));
  }
  closest(selector){
    if(selector==='button')return this.tagName==='BUTTON'?this:null;
    return null;
  }
}
const win=new Emitter('window');
win.innerWidth=1440;
win.innerHeight=846;
const doc=new Emitter('document');
doc.hidden=false;
doc.activeElement=null;
doc.createElement=tag=>new Emitter(tag);
globalThis.window=win;
globalThis.document=doc;
let rafId=0;
const frames=new Map();
globalThis.requestAnimationFrame=cb=>{
  const id=++rafId;frames.set(id,cb);return id;
};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
function frame(time){
  const callbacks=[...frames.values()];
  frames.clear();
  for(const cb of callbacks)cb(time);
}
function ev(extra={}){
  return {type:'pointermove',pointerType:'mouse',button:0,isPrimary:true,
    pointerId:1,clientX:500,clientY:380,
    defaultPrevented:false,propagationStopped:false,
    preventDefault(){this.defaultPrevented=true;},
    stopPropagation(){this.propagationStopped=true;},
    stopImmediatePropagation(){this.propagationStopped=true;},...extra};
}
function point(){ 
  const transform=scene.style.transform;
  const match=/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\)/.exec(transform);
  assert.ok(match,`Expected valid camera transform, got ${transform}`);
  return {x:Number(match[1]),y:Number(match[2])};
}
function approx(a,b,message){assert.ok(Math.abs(a-b)<1e-6,`${message||''}: ${a} !== ${b}`);}
function assertBounds(){
  const {x,y}=point();
  const minX=Math.min(0,view.clientWidth-parseFloat(scene.style.width));
  const minY=Math.min(0,view.clientHeight-parseFloat(scene.style.height));
  assert.ok(x>=minX-1e-6 && x<=1e-6,`X ${x} not in [${minX}, 0]`);
  assert.ok(y>=minY-1e-6 && y<=1e-6,`Y ${y} not in [${minY}, 0]`);
}
function input(type,props={}){
  return ev({type,...props});
}
function start(id=1,{x=500,y=380,onMarker=false,button=0,pointerType='mouse'}={}){
  const e=input('pointerdown',{pointerId:id,clientX:x,clientY:y,
    button,pointerType,target:onMarker?marker:view});
  view.fire('pointerdown',e);
  return e;
}
function move(id,x,y,{onlyWindow=false}={}){
  const e=input('pointermove',{pointerId:id,clientX:x,clientY:y});
  if(!onlyWindow)view.fire('pointermove',e);
  win.fire('pointermove',e); // A bubbled event must not double-apply movement.
  return e;
}
function end(id=1,{outside=false,cancel=false}={}){
  const e=input(cancel?'pointercancel':'pointerup',{pointerId:id});
  if(!outside)view.fire(e.type,e);
  win.fire(e.type,e);
  return e;
}
function gesture(dx,dy,{id=1,onMarker=false,outside=false}={}){
  start(id,{onMarker});
  move(id,500+dx,380+dy);
  end(id,{outside});
  assert.equal(view.flags.has('is-panning'),false,'Pan class must reset after each gesture');
  assert.equal(win.listenerCount('pointermove'),0,'No global pointermove listener may leak');
  assert.equal(win.listenerCount('pointerup'),0,'No global pointerup listener may leak');
  assert.equal(view.captured.size,0,'Pointer capture must be released');
  assertBounds();
}
function emitClick({keyboard=false}={}){
  const e=ev({type:'click',detail:keyboard?0:1,clientX:500,clientY:380});
  view.fire('click',e);
  if(!e.propagationStopped)marker.fire('click',e);
  return e;
}
let entries=0;
const host=new Emitter('main');
const map=createPannableMap({
  host,imageUrl:'/assets/scenes/world-map-grand.png',
  width:2048,height:1152,focus:{x:.68,y:.54},
  markers:[{label:'进入地图',x:.806,y:.568,onActivate(){entries++;}}],
});
const view=host.children[0],scene=view.children[0],marker=scene.children[1];
assert.equal(marker.style.left,'calc(80.60000000000001% + 0px)');
assert.ok(parseFloat(scene.style.width)>view.clientWidth,
  'Map artwork must cover the viewport horizontally');
assert.ok(parseFloat(scene.style.height)>view.clientHeight,
  'Map artwork must cover the viewport vertically');
assertBounds();

// Normal click remains a click; marker starts can still pan after threshold.
start(1,{onMarker:true});
move(1,503,382);
end(1);
emitClick();
assert.equal(entries,1,'Marker tap must still activate its target');
const beforeMarkerDrag=point();
gesture(-90,-70,{onMarker:true});
assert.notDeepEqual(point(),beforeMarkerDrag,'Marker-originated drag must move the map');
const ghost=emitClick();
assert.equal(ghost.defaultPrevented,true,'Synthetic click after dragging must be cancelled');
assert.equal(entries,1,'Marker must not activate after a drag');
start(1,{onMarker:true});end(1);
emitClick({keyboard:true});
assert.equal(entries,2,'Keyboard activation must not be swallowed');

// Move repeatedly, using the same mouse pointerId (browsers commonly reuse 1).
for(let i=0;i<120;i++){
  const old=point();
  const direction=i%2===0?1:-1;
  gesture(110*direction,35*(i%3===0?-1:1));
  if(i%2===1)assertBounds();
  if(i%5===0)await new Promise(resolve=>setTimeout(resolve,1));
}
const after120=point();
assert.ok(Number.isFinite(after120.x)&&Number.isFinite(after120.y));

// Drive to the physical top-left camera limit, then reverse IN THE SAME DRAG.
// The old "stuck at edge" bug must not leave a pointer dead zone.
start();
move(1,8000,7000);
assertBounds();
approx(point().x,0,'Left map edge');
approx(point().y,0,'Top map edge');
move(1,7990,6988); // Reverse by only 10px / 12px.
approx(point().x,-10,'Immediate horizontal reversal after edge collision');
approx(point().y,-12,'Immediate vertical reversal after edge collision');
end();
gesture(-80,-55);
assert.ok(point().x<-10&&point().y<-12,'New drag must work after boundary collision');

// Drive to bottom-right edge and immediately reverse.
start();
move(1,-8000,-7000);
const hard=point();
assertBounds();
move(1,-7990,-6992);
approx(point().x,hard.x+10,'Reverse from bottom-right X');
approx(point().y,hard.y+8,'Reverse from bottom-right Y');
end();

// Adversarial edge ping-pong: repeatedly saturate both axes, then reverse
// by ONE pixel before releasing. No edge may permanently trap this pointer.
for(let i=0;i<200;i++){
  const positive=i%2===0;
  const far=positive?9000:-9000;
  const near=positive?8999:-8999;
  start();
  move(1,far,far);
  const edge=point();
  assertBounds();
  move(1,near,near);
  const returned=point();
  if(positive){
    approx(edge.x,0,'Left-edge clamp during stress');
    approx(edge.y,0,'Top-edge clamp during stress');
    assert.ok(returned.x<edge.x && returned.y<edge.y,
      `One-pixel edge reversal failed on stress cycle ${i}`);
  }else{
    assert.ok(returned.x>edge.x && returned.y>edge.y,
      `One-pixel far-edge reversal failed on stress cycle ${i}`);
  }
  end();
  assert.equal(view.captured.size,0);
  assert.equal(win.listenerCount('pointermove'),0);
  if(i%37===0)await new Promise(resolve=>setTimeout(resolve,1));
}
// Mouseup outside viewport must clean up (window fallback).
const beforeOutside=point();
gesture(65,45,{outside:true});
gesture(-65,-45);
assertBounds();
assert.equal(win.listenerCount('pointermove'),0);

// Simulate lost capture without pointerup; next drag must work.
start();
move(1,545,410);
view.captured.delete(1);
view.fire('lostpointercapture',input('lostpointercapture',{pointerId:1}));
assert.equal(view.flags.has('is-panning'),false);
const beforeRecovery=point();
gesture(-35,-25);
assert.notDeepEqual(point(),beforeRecovery,'Lost capture must not disable next gesture');

// The lost-capture signal from a previous drag may arrive after the NEXT
// pointerdown with the SAME pointerId. It must not cancel that new session.
start();move(1,525,400);end();
start();
await Promise.resolve(); // Dispatch pending lostpointercapture from previous end.
const beforeDelayed=point();
move(1,470,340);
assert.notDeepEqual(point(),beforeDelayed,'Delayed old loss must not kill a new drag');
end();

// Window blur and hidden tab must each cancel cleanly.
start();move(1,560,405);
win.fire('blur');
assert.equal(view.flags.has('is-panning'),false);
const beforeBlurRecovery=point();
gesture(-45,-32);
assert.notDeepEqual(point(),beforeBlurRecovery);
start();move(1,540,405);
doc.hidden=true;doc.fire('visibilitychange');doc.hidden=false;
assert.equal(view.flags.has('is-panning'),false);
gesture(-28,20);

// Pointercancel, non-primary touch and right-click must not corrupt state.
start();move(1,530,410);end(1,{cancel:true});
const beforeIgnored=point();
start(2,{button:2});move(2,590,460);end(2);
assert.deepEqual(point(),beforeIgnored,'Right button is not a map gesture');
view.fire('pointerdown',input('pointerdown',{pointerId:9,isPrimary:false,target:view}));
move(9,620,440);end(9);
assert.deepEqual(point(),beforeIgnored,'Secondary pointers must be ignored');
gesture(40,30);
assertBounds();

// Even if a session never gets pointerup, the NEXT pointerdown must recover.
start(1);move(1,535,401);
const beforeRestart=point();
start(2);move(2,470,350);end(2);
assert.notDeepEqual(point(),beforeRestart,'New pointerdown must replace an abandoned drag');

// Keyboard panning and cleanup must remain intact.
let keyBlocked=false;
win.fire('keydown',{code:'ArrowRight',preventDefault(){keyBlocked=true;}});
assert.ok(keyBlocked);
const beforeKey=point();
frame(1000);frame(1016);
assert.notDeepEqual(point(),beforeKey);
win.fire('keyup',{code:'ArrowRight'});
assert.equal(frames.size,0,'No animation should continue after keyup');
win.fire('keydown',{code:'ArrowLeft',preventDefault(){}});
win.fire('blur');
assert.equal(frames.size,0,'Window blur cancels keyboard movement');

map.dispose();
for(const name of ['keydown','keyup','blur','resize','pointerup','pointermove','pointercancel'])
  assert.equal(win.listenerCount(name),0,`Leaked window listener: ${name}`);
assert.equal(doc.listenerCount('visibilitychange'),0);
for(const name of ['pointerdown','pointermove','pointerup','pointercancel',
                   'lostpointercapture','click'])
  assert.equal(view.listenerCount(name),0,`Leaked viewport listener: ${name}`);
console.log('Map adversarial regression PASS: 120 repeat drags, 200 edge ping-pong reversals,');
console.log('outside releases, marker clicks, stale capture, blur, visibility,');
console.log('abandoned sessions, keyboard and complete event cleanup.');
