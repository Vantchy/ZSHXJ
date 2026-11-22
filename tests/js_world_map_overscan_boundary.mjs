/**
 * World map V10.3: original content is the ONLY navigable region, while the
 * expanded parchment is available to the camera during edge cloud wipes.
 * Node -- no browser dependencies. Uses the same geometry as the live camera.
 */
import assert from 'node:assert/strict';
import {mapCameraLayout, mapMarkerPercent, mapContentRect}
  from '../public/map-camera-geometry.js';
import {WORLD_MAP_SITES, WORLD_MAP_IMAGE_SIZE, WORLD_MAP_DRAG_BOUNDS,
  WORLD_MAP_INITIAL_FOCUS, worldMapTransformOrigin} from '../public/world-map-sites.js';
import {createPannableMap} from '../public/map-viewport.js';

const image=WORLD_MAP_IMAGE_SIZE, box=WORLD_MAP_DRAG_BOUNDS;
assert.deepEqual([image.width,image.height],[2816,1584]);
assert.deepEqual([box.x,box.y,box.width,box.height],[384,216,2048,1152]);
assert.ok(WORLD_MAP_SITES.length>=25,'All source places remain available');
assert.equal(WORLD_MAP_SITES[0].label,'十六·羌方');
assert.ok(WORLD_MAP_SITES.some(site=>site.id==='mengjin' && site.label==='一·孟津'));
assert.equal(new Set(WORLD_MAP_SITES.map(site=>site.id)).size,WORLD_MAP_SITES.length);
for(const site of WORLD_MAP_SITES){
  assert.ok(site.x>=0&&site.x<=1&&site.y>=0&&site.y<=1);
  const pos=mapMarkerPercent(site,image.width,image.height,box);
  assert.ok(Math.abs(pos.x/100*image.width-(box.x+site.x*box.width))<1e-6);
  assert.ok(Math.abs(pos.y/100*image.height-(box.y+site.y*box.height))<1e-6);
  assert.equal(worldMapTransformOrigin(site),`${pos.x}% ${pos.y}%`);
}
assert.throws(()=>mapContentRect(100,100,{x:80,y:10,width:30,height:40}),RangeError);

// Browser sizes include ultrawide, phone portrait, tablet portrait and common
// desktops. Test extreme camera corners and every authored place as the origin
// of both outgoing zoom and incoming reduced-scale cloud transitions.
const screens=[
  [1440,900],[1920,1080],[3440,1440],[1280,720],[390,844],[768,1024],
  [2560,1080],[320,568],
];
for (const [viewportWidth,viewportHeight] of screens){
  const g=mapCameraLayout({...image,viewportWidth,viewportHeight,contentBounds:box});
  assert.ok(g.coreWidth>viewportWidth);
  assert.ok(g.coreHeight>viewportHeight);
  for (const panX of [g.minX,g.maxX]){
    assert.ok(panX+g.coreLeft<=0.00001,`Pan reveals outer left art ${viewportWidth}`);
    assert.ok(panX+g.coreLeft+g.coreWidth>=viewportWidth-.00001,
      `Pan reveals outer right art ${viewportWidth}`);
  }
  for (const panY of [g.minY,g.maxY]){
    assert.ok(panY+g.coreTop<=0.00001,`Pan reveals outer top art ${viewportHeight}`);
    assert.ok(panY+g.coreTop+g.coreHeight>=viewportHeight-.00001,
      `Pan reveals outer bottom art ${viewportHeight}`);
  }
  for(const site of WORLD_MAP_SITES){
    const where=mapMarkerPercent(site,image.width,image.height,box);
    const originX=g.sceneWidth*where.x/100,originY=g.sceneHeight*where.y/100;
    for(const zoom of [.94,1,1.42]){
      // CSS scale originates from the chosen location's circle.
      for(const px of [g.minX,g.maxX])for(const py of [g.minY,g.maxY]){
        const left=px+(1-zoom)*originX;
        const right=left+zoom*g.sceneWidth;
        const top=py+(1-zoom)*originY;
        const bottom=top+zoom*g.sceneHeight;
        assert.ok(left<=.00001 && right>=viewportWidth-.00001,
          `${site.label} zoom ${zoom} horizontal gap on ${viewportWidth}x${viewportHeight}`);
        assert.ok(top<=.00001 && bottom>=viewportHeight-.00001,
          `${site.label} zoom ${zoom} vertical gap on ${viewportWidth}x${viewportHeight}`);
      }
    }
  }
}

// Test actual DOM wiring: marker coordinates use the source 2048 x 1152
// coordinate frame, even though the rendered PNG contains a 384px margin.
class MockElement {
  constructor(tag){
    this.tagName=tag.toUpperCase();this.style={};this.children=[];this.attributes={};
    this.dataset={};this.clientWidth=1440;this.clientHeight=900;this.listeners={};
    this.classList={add(){},remove(){}};this.draggable=false;
  }
  append(...nodes){this.children.push(...nodes);}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
  removeEventListener(k,fn){this.listeners[k]=(this.listeners[k]||[]).filter(f=>f!==fn);}
  focus(){}
  hasPointerCapture(){return false;}
  setPointerCapture(){}
  fire(k,event={}){for(const fn of this.listeners[k]||[])fn(event);}
}
const winListeners={};
globalThis.document={createElement:tag=>new MockElement(tag),activeElement:null,
  addEventListener(){},removeEventListener(){}};
globalThis.window={innerWidth:1440,innerHeight:900,
  addEventListener(k,fn){(winListeners[k]??=[]).push(fn);},
  removeEventListener(k,fn){winListeners[k]=(winListeners[k]||[]).filter(f=>f!==fn);}};
globalThis.requestAnimationFrame=()=>1;
globalThis.cancelAnimationFrame=()=>{};
const host=new MockElement('main');
const map=createPannableMap({host,imageUrl:'/assets/scenes/world-map-grand.png',
  width:image.width,height:image.height,contentBounds:box,
  focus:WORLD_MAP_INITIAL_FOCUS,markers:WORLD_MAP_SITES.map(s=>({...s,
    visual:'circle-label',onActivate(){}}))});
const viewport=host.children[0],scene=viewport.children[0];
const actual=scene.children.find(e=>e.dataset?.markerId==='mengjin');
assert.ok(actual,'Mengjin button remains present');
const where=mapMarkerPercent(WORLD_MAP_SITES.find(s=>s.id==='mengjin'),
 image.width,image.height,box);
assert.equal(actual.style.left,`calc(${where.x}% + 0px)`);
assert.equal(actual.style.top,`calc(${where.y}% + 0px)`);
const g=mapCameraLayout({...image,viewportWidth:1440,viewportHeight:900,
  contentBounds:box});
function cameraXY(){
  const m=/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\)/.exec(scene.style.transform);
  assert.ok(m,`Unexpected camera transform ${scene.style.transform}`);
  return {x:Number(m[1]),y:Number(m[2])};
}
function assertLiveClamp(){
  const {x,y}=cameraXY();
  assert.ok(x>=g.minX-.00001&&x<=g.maxX+.00001);
  assert.ok(y>=g.minY-.00001&&y<=g.maxY+.00001);
}
function drag(dx,dy){
  const target={closest(){return null;}};
  viewport.fire('pointerdown',{pointerId:1,pointerType:'mouse',button:0,
    clientX:400,clientY:300,target,preventDefault(){}});
  viewport.fire('pointermove',{pointerId:1,clientX:400+dx,clientY:300+dy,
    preventDefault(){}});
  viewport.fire('pointerup',{pointerId:1});
}
for(const [dx,dy] of [[10000,10000],[-10000,-10000],[-10000,10000],[10000,-10000]]){
  drag(dx,dy);assertLiveClamp();
}
// Resize preserves normalized focus in the SOURCE image rather than the
// buffer; camera remains clamped to the source edges.
viewport.clientWidth=390;viewport.clientHeight=844;
for(const fn of winListeners.resize||[])fn();
const mobile=mapCameraLayout({...image,viewportWidth:390,viewportHeight:844,contentBounds:box});
const pos=cameraXY();
assert.ok(pos.x>=mobile.minX-.00001&&pos.x<=mobile.maxX+.00001);
assert.ok(pos.y>=mobile.minY-.00001&&pos.y<=mobile.maxY+.00001);
map.dispose();
console.log(`World-map core bounds PASS: ${WORLD_MAP_SITES.length} markers × ${screens.length} viewports × all 4 corners × 3 transition scales; live drag and resize.`);

// Only the ten authored regions open real small-map images; other sites remain unconnected.
// Test the real showMap function (not a rewritten equivalent).
import vm from 'node:vm';
import fs from 'node:fs';
import {getChapterOneRegion} from '../public/chapter-one-region-maps.js';
const appSource=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const showBegin=appSource.indexOf('function showMap() {');
const showEnd=appSource.indexOf('function chapterState(',showBegin);
assert.ok(showBegin>=0&&showEnd>showBegin);
let worldOpts=null,requestedChapter=null,transitionOpts=null;
const message={textContent:''};
const mockRoot={};
const appCtx={
  WORLD_MAP_SITES,WORLD_MAP_IMAGE_SIZE,WORLD_MAP_DRAG_BOUNDS,
  WORLD_MAP_INITIAL_FOCUS,worldMapTransformOrigin,getChapterOneRegion,
  showHome(){},root:mockRoot,
  document:{querySelectorAll(){return [];},querySelector(sel){
    return sel==='.map-scene-note__text'?message:null;
  }},
  mountMapScene(opts){worldOpts=opts;},
  el(tag,text,parent){return {tag,text,parent,className:'',textContent:text||''};},
  cloudDescend(swap,opts){transitionOpts=opts;swap();},
  showChapterMap(id,region){requestedChapter={id,region};},
};
vm.runInNewContext(appSource.slice(showBegin,showEnd)+
  '\nglobalThis.openWorldMap=showMap;',appCtx);
appCtx.openWorldMap();
assert.equal(worldOpts.width,2816);
assert.equal(worldOpts.height,1584);
assert.equal(worldOpts.contentBounds.width,2048);
assert.equal(worldOpts.contentBounds.height,1152);
assert.equal(worldOpts.markers.length,WORLD_MAP_SITES.length);
worldOpts.markers.find(s=>s.id==='qufu').onActivate();
assert.equal(requestedChapter,null,'Unbuilt destinations stay on the map');
worldOpts.markers.find(s=>s.id==='taosi').onActivate();
assert.equal(requestedChapter.id,'ch1');
assert.equal(requestedChapter.region,'taosi');
assert.equal(transitionOpts.exit.origin,worldMapTransformOrigin(
  WORLD_MAP_SITES.find(s=>s.id==='taosi')));
worldOpts.markers.find(s=>s.id==='mengjin').onActivate();
assert.equal(requestedChapter.region,'mengjin','Mengjin still opens its own small map');
assert.equal(transitionOpts.exit.origin,worldMapTransformOrigin(
  WORLD_MAP_SITES.find(s=>s.id==='mengjin')));
console.log('World-map live route PASS: 10 image-backed regions available; others stay on the world map.');
