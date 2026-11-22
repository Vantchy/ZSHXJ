/** Ten restored maps are reachable; Mengjin now has two approved hotspots. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {CHAPTER_ONE_REGIONS,getChapterOneRegion} from '../public/chapter-one-region-maps.js';
import {WORLD_MAP_SITES} from '../public/world-map-sites.js';

assert.equal(CHAPTER_ONE_REGIONS.length,10);
assert.equal(new Set(CHAPTER_ONE_REGIONS.map(r=>r.id)).size,10);
assert.deepEqual(CHAPTER_ONE_REGIONS.map(r=>r.title), ['孟津','陶寺','妫汭','阳城','甘','斟鄩','钟村','西吴壁','新宫','景亳']);
const siteIds=new Set(WORLD_MAP_SITES.map(site=>site.id));
for(const region of CHAPTER_ONE_REGIONS){
  assert.ok(siteIds.has(region.id),'World map does not have a destination for '+region.id);
  assert.ok(Object.isFrozen(region));
  assert.equal(getChapterOneRegion(region.id),region);
  assert.equal(region.width,2047);
  assert.equal(region.height,1152);
  const local=new URL('../public'+region.imageUrl,import.meta.url);
  const bytes=fs.readFileSync(local);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert.ok(bytes.byteLength>120000,'Missing HD image: '+region.id);
}
const mengjin=getChapterOneRegion('mengjin');
assert.equal(mengjin.hotspots.length,2);
assert.deepEqual(mengjin.hotspots.map(s=>s.id),['mengjin-inner-court','mengjin-river-gate']);
assert.ok(mengjin.hotspots.every(s=>s.x>0 && s.x<1 && s.y>0 && s.y<1));
for(const region of CHAPTER_ONE_REGIONS.filter(r=>r.id!=='mengjin')){
  assert.equal(region.hotspots.length,0,'Only Mengjin should gain dots this round: '+region.id);
}
assert.equal(getChapterOneRegion('qizhou'),null);
assert.equal(getChapterOneRegion('__proto__'),null);

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const begin=app.indexOf("function showChapterMap(chapterId, regionId = 'mengjin') {");
const end=app.indexOf('async function showRoom(',begin);
assert.ok(begin>=0 && end>begin);
const chapter={id:'ch1',title:'第一章',order:1,implemented:true,canEnter:true,locations:[{id:'gate-road',name:'旧样张'},{id:'mengjin-jade-courtyard',name:'孟津玉匠铺'}]};
const mounts=[],visited=[],worldReturns=[];
const ctx={
  getChapterOneRegion,
  viewGeneration:1,
  getAuthSnapshot:()=>({token:'test',generation:1}),
  stillOnView:()=>true,
  loadGame:async()=>{throw Error('Fresh chapter fixture should not reload');},
  showError:error=>{throw error;},
  requireChapter:(id)=>{assert.equal(id,'ch1');return chapter;},
  mountMapScene:(opts)=>mounts.push(opts),
  showRoom:(chapterId,locationId)=>visited.push([chapterId,locationId]),
  showMap:()=>worldReturns.push('world'),
  cloudDescend:(go,opts)=>{assert.ok(opts.enter,'Cloud transition missing');return go();},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  page(){throw new Error('A registered map must not open an empty placeholder');},
  el(){ throw new Error('should not open empty placeholder elements'); },
  button(){ throw new Error('should not open empty placeholder buttons'); },
  root:{},
};
vm.runInNewContext(app.slice(begin,end)+'\nglobalThis.enterRegion=showChapterMap;',ctx);
for (const region of CHAPTER_ONE_REGIONS){
  ctx.enterRegion('ch1',region.id);
  const opts=mounts.at(-1);
  assert.equal(opts.type,'chapter');
  assert.equal(opts.source,region.imageUrl);
  assert.equal(opts.width,region.width);
  assert.equal(opts.height,region.height);
  assert.equal(opts.regionName,region.title);
  assert.ok(Array.isArray(opts.markers));
  if (region.id === 'mengjin') {
    assert.equal(opts.markers.length,2);
    assert.ok(opts.markers.every(m=>m.visual==='circle-dot'));
    assert.ok(opts.markers.every(m=>m.className==='scene-gate--chapter-entry'));
  } else {
    assert.equal(opts.markers.length,0,'No speculative dots for '+region.id);
  }
  assert.ok(typeof opts.back==='function');
  const before=worldReturns.length;
  opts.back();
  assert.equal(worldReturns.length,before+1);
  assert.equal(opts.temporarySample,null);
}
assert.equal(mounts.length,10);
assert.equal(visited.length,0,'Showing maps must not issue room navigation');
mounts[0].markers[0].onActivate();
assert.equal(visited.length,0,'The inner-court school is not yet implemented');
mounts[0].markers[1].onActivate();
assert.deepEqual(visited,[['ch1','mengjin-jade-courtyard']]);
ctx.enterRegion('ch1');
assert.equal(mounts.at(-1).source,CHAPTER_ONE_REGIONS[0].imageUrl,'Existing room return to the chapter map defaults to Mengjin');
console.log('Ten-region route PASS: HD artwork registered, only Mengjin river gate routes to authored jade courtyard; inner court reserved.');
