import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {YIN_STAGES,activeYinStage,yinLocationAtSpot,resolveMengjinDefaultLocation} from '../public/mengjin-stage-route.js';
import {getChapterOneRegion} from '../public/chapter-one-region-maps.js';
import {reviewScenesAtSpot,spotIdAtLocation} from '../public/story-spot-review.js';
import {boardStationForLocation} from '../public/mengjin-board.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const story=JSON.parse(fs.readFileSync(path.join(root,'../public/story/ch1.json'),'utf8'));
const ids=new Set(YIN_STAGES.map(s=>s.quest));
assert.equal(ids.size,13);
assert.equal(YIN_STAGES.length,13);
let state={tasks:{side:{'yangcheng-army-xnor':{status:'submitted'}}}};
assert.equal(activeYinStage(state).quest,'yin-majority');
assert.equal(resolveMengjinDefaultLocation(state),'yin-zhongcun-tent');
for (const [regionId,n] of [['zhongcun',1],['zhenxun',2],['jingbo',3]]) {
  const region=getChapterOneRegion(regionId);
  assert.equal(region.hotspots.length,n);
  assert(region.hotspots.every(p=>p.id.startsWith('yin-')));
}
assert.equal(boardStationForLocation('yin-jingbo-peach-cla'),446);
for(const stage of YIN_STAGES){
  assert.equal(spotIdAtLocation(stage.locationId),stage.spotId);
  assert.equal(yinLocationAtSpot(state,stage.spotId),stage.locationId);
  state.tasks.side[stage.quest]={status:'submitted',steps:{}};
}
assert.equal(activeYinStage(state).quest,'yin-final-death');
assert.equal(resolveMengjinDefaultLocation(state),'yin-zhenxun-hq-death');
const app=fs.readFileSync(path.join(root,'../public/app.js'),'utf8');
assert.match(app,/locationId\.startsWith\('yin-jingbo-'\)/);
assert.match(app,/regionId === 'zhongcun'/);
const room=fs.readFileSync(path.join(root,'../public/room.js'),'utf8');
assert.match(room,/location\.id\.startsWith\('yin-'\)/);
console.log('PASS YIN V9 locations, map progress and board wiring');
