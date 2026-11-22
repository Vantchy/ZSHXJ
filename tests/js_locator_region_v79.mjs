import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  CHAPTER_ONE_REGIONS, EXTRA_CHAPTER_ONE_REGIONS, ALL_CHAPTER_ONE_REGIONS,
  getChapterOneRegion, candidateRegionMapPaths, resolveChapterOneRegionArtwork,
} from '../public/chapter-one-region-maps.js';
import {mountActiveStoryLocators} from '../public/story-location-marker.js';
import {resolveMengjinDefaultLocation} from '../public/mengjin-stage-route.js';

// The atlas is 27 cities. Preserve the 10 existing maps and their three story regions.
assert.equal(CHAPTER_ONE_REGIONS.length, 10);
assert.equal(EXTRA_CHAPTER_ONE_REGIONS.length, 17);
assert.equal(ALL_CHAPTER_ONE_REGIONS.length,27);
assert.equal(new Set(ALL_CHAPTER_ONE_REGIONS.map(r=>r.id)).size,27);
assert.equal(getChapterOneRegion('mengjin')?.hotspots?.length,2);
assert.equal(getChapterOneRegion('taosi')?.hotspots?.length,1);
assert.equal(getChapterOneRegion('guirui')?.hotspots?.length,1);
assert.equal(getChapterOneRegion('qiangfang')?.title,'羌方');
assert(getChapterOneRegion('mingtiao').imageCandidates.length > 0);
assert(getChapterOneRegion('liushan') === null);
assert(candidateRegionMapPaths(11,'mingtiao','鸣条').includes('/assets/scenes/chapter1-maps/11-mingtiao.webp'));

// Files already registered in project must open with no image probing.
let probes=0;
const mengjin=await resolveChapterOneRegionArtwork(getChapterOneRegion('mengjin'),()=>{probes++;return null;});
assert.equal(mengjin.id,'mengjin');
assert.equal(probes,0);
const mingtiao=await resolveChapterOneRegionArtwork(getChapterOneRegion('mingtiao'),async url=>{
  probes++;
  return url.endsWith('11-mingtiao.png') ? {url,width:2112,height:1188} : null;
});
assert.equal(mingtiao.imageUrl,'/assets/scenes/chapter1-maps/11-mingtiao.png');
assert.equal(mingtiao.width,2112);
assert(probes>=2);
assert.equal(await resolveChapterOneRegionArtwork(getChapterOneRegion('fenghao'),async()=>null),null);

// Every real progress stage, across separate student accounts, resolves to one
// current region and physical dot. Submitted is the only completion signal.
const stageCases=[
  [{},'mengjin-jade-courtyard'],
  [{'mengjin-jade-mainline':'submitted'},'mengjin-diviner-residence'],
  [{'mengjin-diviner-mainline':'submitted'},'mengjin-school-courtyard'],
  [{'mengjin-school-lower':'submitted'},'taosi-old-academy'],
  [{'taosi-three-pages':'submitted'},'yanwei-riverside-day'],
  [{'yanwei-day-four':'submitted'},'yanwei-riverside-night'],
  [{'yanwei-night-five-six':'submitted'},'taosi-old-academy-return'],
];
for(const [statuses,expected] of stageCases){
  const state={tasks:{side:Object.fromEntries(Object.entries(statuses).map(
    ([id,status])=>[id,{status}]))}};
  assert.equal(resolveMengjinDefaultLocation(state),expected);
}

// The marker SVG-like ornament belongs to the *actual map button dot*.
class Element {
  constructor(name,id='') {
    this.name=name;this.children=[];this.dataset={markerId:id};
    this.style={};this.className='';this.attributes={};
    this.classList={add:key=>{this.className+=' '+key;}};
  }
  append(child){this.children.push(child);}
  setAttribute(name,value){this.attributes[name]=value;}
  getAttribute(name){return this.attributes[name];}
  querySelector(selector){
    if(selector==='.scene-gate__dot')return this.children.find(x=>x.className==='scene-gate__dot');
    if(selector==='.story-location-ornament')return this.children.find(x=>x.className==='story-location-ornament');
    return null;
  }
}
const first=new Element('button','mengjin-inner-court');
first.style.left='33.4%';first.style.top='40.3%';
const firstDot=new Element('span');firstDot.className='scene-gate__dot';first.append(firstDot);
const second=new Element('button','mengjin-river-gate');
second.style.left='59.3%';second.style.top='56.6%';
const secondDot=new Element('span');secondDot.className='scene-gate__dot';second.append(secondDot);
const host={querySelectorAll:selector=>{
  assert.equal(selector,'.map-camera-scene .scene-gate');return [first,second];
}};
globalThis.document={createElement:tag=>new Element(tag)};
let count=mountActiveStoryLocators(host,[
  {id:'mengjin-inner-court',currentLocator:false,x:.334},
  {id:'mengjin-river-gate',currentLocator:true,x:.593},
]);
assert.equal(count,1);
assert.equal(firstDot.children.length,0);
assert.equal(secondDot.children.length,1);
assert.equal(secondDot.children[0].name,'img');
assert.equal(secondDot.children[0].style.position,'absolute');
assert.equal(secondDot.children[0].style.left,'50%');
assert.equal(secondDot.children[0].src,'/assets/ui/locator-turquoise-mask-v79.png');
assert.equal(second.style.left,'59.3%','must not modify the map camera coordinate');
assert.equal(mountActiveStoryLocators(host,[{id:'mengjin-river-gate',currentLocator:true}]),0,
 'idempotent: no duplicate ornament');

// User click on any world map city is no longer dropped silently.
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=app.indexOf('function showMap() {');
const end=app.indexOf('function chapterState(',start);
assert(start>=0&&end>start);
const rendered=[];const opened=[];const missing=[];const errors=[];
const sites=ALL_CHAPTER_ONE_REGIONS.map(x=>({id:x.id,label:x.title,x:.5,y:.5}));
const ctx={
  WORLD_MAP_SITES:sites,
  getChapterOneRegion,
  resolveChapterOneRegionArtwork:async r=>r.id==='fenghao'?null:r,
  activeChapterOneRegionId:()=> 'taosi',
  mountMapScene:arg=>rendered.push(arg),
  cloudDescend:fn=>fn(),
  showChapterMap:(chapter,id,art)=>opened.push({chapter,id,art}),
  showUnavailableChapterOneMap:r=>missing.push(r.id),
  showError:e=>errors.push(e),
  worldMapTransformOrigin:()=> '50% 50%',
  WORLD_MAP_IMAGE_SIZE:{width:2816,height:1584},
  WORLD_MAP_DRAG_BOUNDS:{x:384,y:216,width:2048,height:1152},
  WORLD_MAP_INITIAL_FOCUS:{x:.62,y:.56},
  showHome(){},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
};
vm.runInNewContext(app.slice(start,end)+'\nthis.renderWorld=showMap',ctx);
ctx.renderWorld();
assert.equal(rendered.length,1);
assert.equal(rendered[0].markers.length,27);
assert.equal(rendered[0].markers.filter(m=>m.currentLocator).length,1);
assert.equal(rendered[0].markers.find(m=>m.currentLocator).id,'taosi');
await rendered[0].markers.find(m=>m.id==='guirui').onActivate();
assert.equal(opened[0].id,'guirui');
await rendered[0].markers.find(m=>m.id==='mingtiao').onActivate();
assert.equal(opened[1].id,'mingtiao');
await rendered[0].markers.find(m=>m.id==='fenghao').onActivate();
assert.deepEqual(missing,['fenghao']);
assert.deepEqual(errors,[]);
console.log('PASS V7.9: 27 city routes, fallback artwork discovery, real-button locator and no silent click');
