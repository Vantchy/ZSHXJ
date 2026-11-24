// Existing model contract + safe level replay eligibility.
import assert from 'node:assert/strict';
import {reviewScenesAtSpot,reviewEntryRoute} from '../public/story-spot-review.js';
const quest={
 id:'yin-mux',title:'寅时·山道多路选择器',locationId:'yin-zhenxun-road',
 steps:[{id:'build-mux',title:'搭建二选一选择器',condition:{type:'level-completed',levelId:'ch1_mux'}}]
};
const chapter={
 quests:{side:[quest]},
 questTargets:{'yin-mux':{
  scene:{allowReplay:true},
  steps:{'build-mux':{type:'level',id:'ch1_mux'}}
 }},
 dialogues:[],
 levels:[{id:'ch1_mux'}]
};
const done={tasks:{side:{'yin-mux':{status:'submitted',steps:{'build-mux':{status:'done'}}}}}};
const scenes=reviewScenesAtSpot(chapter,done,'yin-zhenxun-road');
assert.equal(scenes.length,1);
assert.equal(scenes[0].entries[0].kind,'level');
assert.deepEqual(reviewEntryRoute(scenes[0],scenes[0].entries[0]),{
 locationId:'yin-zhenxun-road',questId:'yin-mux',
 catalogLevelId:'ch1_mux',catalogStepId:'build-mux'
});
assert.equal(reviewScenesAtSpot(chapter,{tasks:{side:{'yin-mux':{status:'accepted',
 steps:{'build-mux':{status:'done'}}}}}},'yin-zhenxun-road').length,0);
assert.equal(reviewScenesAtSpot(chapter,done,'yin-jingbo-meeting').length,0);
console.log('PASS ZSHXJ review route + replay gate model');
