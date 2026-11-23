/** City labels show only geography, never misleading progression numbers. */
import assert from 'node:assert/strict';
import {WORLD_MAP_SITES,WORLD_MAP_IMAGE_SIZE,WORLD_MAP_DRAG_BOUNDS,
  worldMapTransformOrigin} from '../public/world-map-sites.js';
const names=['羌方','岐周','丰镐','甘','骊山','妫汭','太原','钟村','彘','晋','陶寺',
 '西吴壁','寺北','鸣条','新宫','临淄','曲阜','殷','朝歌','牧野','亳','景亳',
 '偃师商城','阳城','洛邑','孟津','斟鄩'];
assert.equal(WORLD_MAP_SITES.length,27);
assert.equal(new Set(WORLD_MAP_SITES.map(x=>x.id)).size,27);
assert.deepEqual(WORLD_MAP_SITES.map(x=>x.label),names);
for(const item of WORLD_MAP_SITES){
  assert(!/^[零〇一二三四五六七八九十百千0-9]+[·.、\s-]/u.test(item.label));
  assert(item.x>0&&item.x<1&&item.y>0&&item.y<1);
  assert.match(worldMapTransformOrigin(item),/% \d/);
}
assert.deepEqual(WORLD_MAP_IMAGE_SIZE,{width:2816,height:1584});
assert.deepEqual(WORLD_MAP_DRAG_BOUNDS,{x:384,y:216,width:2048,height:1152});
console.log('PASS：27 座城池仅显示地名，ID/原图定位换算仍然有效');
