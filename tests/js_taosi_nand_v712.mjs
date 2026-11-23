import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveMengjinStageLocation,resolveMengjinDefaultLocation} from '../public/mengjin-stage-route.js';
import {reviewScenesAtSpot,spotIdAtLocation} from '../public/story-spot-review.js';
import {visibleTaskEntries} from '../public/story-task-presentation.js';

const scene=JSON.parse(fs.readFileSync(new URL('../public/story/ch1.json',import.meta.url),'utf8'));
const questId='taosi-nand-first';
const targets=scene.questTargets[questId];
assert(targets?.scene?.autoSubmit);
assert.deepEqual(Object.keys(targets.steps),['taosi-nand-intro','taosi-nand-level','taosi-nand-report']);
assert.equal(targets.steps['taosi-nand-level'].id,'ch1_cmos_nand');
assert.equal(spotIdAtLocation('taosi-old-academy-night'),'taosi-old-academy-dot');
assert(scene.locations.some(l=>l.id==='taosi-old-academy-night'));
const map={id:'taosi-old-academy-dot',locationId:'taosi-old-academy'};
const chapter={locations:[
  {id:'taosi-old-academy'},
  {id:'taosi-old-academy-return'},
  {id:'taosi-old-academy-night'},
], quests:{side:[{
   id:questId,title:'丑时·旧学舍夜制与非',
   locationId:'taosi-old-academy-night',
   completion:{mode:'official-circuit',levelIds:['ch1_cmos_nand'],requireAllSteps:true},
   steps:[
      {id:'taosi-nand-intro',title:'灯下沉思与非',condition:{type:'dialogue-finished',dialogueId:'taosi-nand-intro'}},
      {id:'taosi-nand-level',title:'制作与非门',condition:{type:'level-completed',levelId:'ch1_cmos_nand'}},
      {id:'taosi-nand-report',title:'记下首门',condition:{type:'dialogue-finished',dialogueId:'taosi-nand-report'}},
   ]
 }]},questTargets:scene.questTargets,dialogues:scene.dialogues};
const statuses=(a,b,c)=>({tasks:{side:{
 'yanwei-night-five-six':{status:a},
 'taosi-chou-handoff':{status:b},
 [questId]:{status:c}
}}});
const y= statuses('submitted','not-accepted','not-accepted');
assert.equal(resolveMengjinStageLocation(chapter,y,map),'taosi-old-academy-return');
assert.equal(resolveMengjinDefaultLocation(y),'taosi-old-academy-return');
const z= statuses('submitted','submitted','not-accepted');
assert.equal(resolveMengjinStageLocation(chapter,z,map),'taosi-old-academy-night');
assert.equal(resolveMengjinDefaultLocation(z),'taosi-old-academy-night');
const complete=statuses('submitted','submitted','submitted');
assert.equal(resolveMengjinDefaultLocation(complete),'yangcheng-valley-deception');
const progress={status:'submitted',steps:Object.fromEntries(chapter.quests.side[0].steps.map(s=>[s.id,{status:'done'}]))};
complete.tasks.side[questId]=progress;
const reviews=reviewScenesAtSpot(chapter,complete,'taosi-old-academy-night');
assert.equal(reviews.length,1);
assert.equal(reviews[0].questId,questId);
assert(reviews[0].entries.some(e=>e.targetId==='taosi-nand-intro'));
assert(reviews[0].entries.some(e=>e.targetId==='taosi-nand-report'));
const shown=visibleTaskEntries(chapter,complete);
assert.equal(shown.length,1);
assert.equal(shown[0].category,'story');
const room=fs.readFileSync(new URL('../public/room.js',import.meta.url),'utf8');
assert.match(room,/openSpotReviewInTaskBook/);
assert.match(room,/const soloNarratorName = location\.soloPlayerName/);
assert(!room.includes('function openSceneReplayPanel('));
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert(!app.includes('mountMengjinCatalog('));
assert.match(app,/mountActiveStoryLocators\(/);
const atlas=fs.readFileSync(new URL('../public/chapter-one-region-maps.js',import.meta.url),'utf8');
assert.match(atlas,/taosi-old-academy-dot',x:/);
console.log('PASS V7.12: day handoff → NAND night, formal level, same-spot review and historic UI kept');
