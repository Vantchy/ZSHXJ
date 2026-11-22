import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveMengjinDefaultLocation } from '../public/mengjin-stage-route.js';
assert.equal(resolveMengjinDefaultLocation({tasks:{side:{}}}), 'mengjin-jade-courtyard');
assert.equal(resolveMengjinDefaultLocation({tasks:{side:{'mengjin-jade-mainline':{status:'submitted'}}}}), 'mengjin-diviner-residence');
assert.equal(resolveMengjinDefaultLocation({tasks:{side:{
  'mengjin-jade-mainline':{status:'submitted'},
  'mengjin-diviner-mainline':{status:'submitted'},
}}}), 'mengjin-school-courtyard');
const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert(!src.includes('find(item => item.id === locationId) || chapter.locations?.[0]'),
 'Forbidden legacy fallback still exists');
assert.match(src,/if \(requestedLocationId && !chapter\.locations\?\.some\(/);
assert.match(src,/const location = requestedLocationId/);
assert.match(src,/resolveMengjinDefaultLocation\(chapterState\(chapterId\)\)/);
assert.match(src,/不会跳到旧测试房间/);
console.log('OK: 严格房间路由三阶段与旧样张回退防护');
