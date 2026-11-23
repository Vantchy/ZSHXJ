/** Current map regression: 10 installed artworks + 17 optional map entries. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CHAPTER_ONE_REGIONS,EXTRA_CHAPTER_ONE_REGIONS,ALL_CHAPTER_ONE_REGIONS,
  getChapterOneRegion,candidateRegionMapPaths,resolveChapterOneRegionArtwork}
  from '../public/chapter-one-region-maps.js';
import {WORLD_MAP_SITES} from '../public/world-map-sites.js';

assert.equal(CHAPTER_ONE_REGIONS.length,10);
assert.equal(EXTRA_CHAPTER_ONE_REGIONS.length,17);
assert.equal(ALL_CHAPTER_ONE_REGIONS.length,27);
assert.equal(WORLD_MAP_SITES.length,27);
assert.equal(new Set(ALL_CHAPTER_ONE_REGIONS.map(r=>r.id)).size,27);
const sites=new Set(WORLD_MAP_SITES.map(s=>s.id));
for(const region of ALL_CHAPTER_ONE_REGIONS){
  assert(sites.has(region.id),'没有大地图入口: '+region.id);
  assert.equal(getChapterOneRegion(region.id),region);
  assert(Object.isFrozen(region));
  assert(region.width>0 && region.height>0);
  assert(region.imageUrl.startsWith('/assets/'));
}
assert.deepEqual(CHAPTER_ONE_REGIONS.map(r=>r.id),
 ['mengjin','taosi','guirui','yangcheng','gan','zhenxun','zhongcun','xiwubi','xingong','jingbo']);
assert.equal(getChapterOneRegion('mengjin').hotspots.length,2);
assert.equal(getChapterOneRegion('taosi').hotspots.length,1);
assert.equal(getChapterOneRegion('guirui').hotspots.length,1);
assert.equal(getChapterOneRegion('yangcheng').hotspots.length,3);
assert.equal(getChapterOneRegion('gan').hotspots.length,0,'甘尚无正式剧情光点');
assert.equal(getChapterOneRegion('qizhou').title,'岐周');
assert.equal(getChapterOneRegion('__proto__'),null);
for(const region of CHAPTER_ONE_REGIONS){
  // Ten known map images are part of the project, not speculative assets.
  const local=new URL('../public'+region.imageUrl,import.meta.url);
  const bytes=fs.readFileSync(local);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert(bytes.byteLength>120000,'高清地图缺失: '+region.id);
}
const original=await resolveChapterOneRegionArtwork(getChapterOneRegion('gan'));
assert.equal(original.id,'gan');
const optional=getChapterOneRegion('mingtiao');
assert(optional.imageCandidates.length>0);
assert(candidateRegionMapPaths(11,'mingtiao','鸣条').includes('/assets/scenes/chapter1-maps/11-mingtiao.webp'));
const probe=await resolveChapterOneRegionArtwork(optional,async path=>path.endsWith('11-mingtiao.png')
 ? {url:path,width:2100,height:1180} : null);
assert.equal(probe.width,2100);
console.log('PASS：27 城池、10 张已登记高清图、可选素材检查、阳城三光点、甘空图');
