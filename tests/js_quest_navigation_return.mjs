import assert from 'node:assert/strict';
import {resolveQuestDestination} from '../public/quest-navigation.js';
import {
 makeQuestReturnContext,readQuestReturnContext,resolveReturnLocation
} from '../public/quest-return-context.js';

const chapter = {
 id:'ch1',
 locations:[{id:'gate-road',name:'玉匠铺'},{id:'school',name:'学舍'}],
 levels:[{id:'ch1_binary_decoder',title:'两位二进制译码'},
         {id:'ch1_cmos_not',title:'非门'},
         {id:'ch1_half_adder',title:'半加器'}],
 dialogues:[{id:'mengjin-workshop-opening'},{id:'mengjin-workshop-report'},
            {id:'mengjin-workshop-finished'},{id:'yin-lesson'}],
 questTargets:{
  'binary-decoder':{steps:{
    'listen-workshop':{type:'dialogue',id:'mengjin-workshop-opening',title:'请教玉匠'},
    'decode-four-combinations':{type:'level',id:'ch1_binary_decoder',title:'做译码练习'},
    'report-workshop':{type:'dialogue',id:'mengjin-workshop-report',title:'回报玉匠'},
  }},
  main:{type:'level',id:'ch1_cmos_not',title:'非门关卡'},
  'yin-study':{steps:{
    'ask-yin':{type:'dialogue',id:'yin-lesson',title:'请教寅'},
    'build-adder':{type:'level',id:'ch1_half_adder',title:'搭建半加器'},
  }},
 },
 quests:{
  main:{id:'main',type:'main',completion:{mode:'official-circuit',levelIds:['ch1_cmos_not']},
        steps:[{id:'step-1'}],prerequisites:[],locationId:'gate-road'},
  side:[
   {id:'binary-decoder',type:'side',locationId:'gate-road',prerequisites:[],
    completion:{mode:'official-circuit',requireAllSteps:true,levelIds:['ch1_binary_decoder']},
    steps:[
      {id:'listen-workshop',condition:{type:'dialogue-finished',dialogueId:'mengjin-workshop-report'}},
      {id:'decode-four-combinations',condition:{type:'level-completed',levelId:'ch1_binary_decoder'}},
      {id:'report-workshop',condition:{type:'dialogue-finished',dialogueId:'mengjin-workshop-report'}},
    ]},
   {id:'yin-study',type:'side',locationId:'school',prerequisites:['binary-decoder'],
    completion:{mode:'official-circuit',requireAllSteps:true,levelIds:['ch1_half_adder']},
    steps:[
      {id:'ask-yin',condition:{type:'dialogue-finished',dialogueId:'yin-lesson'}},
      {id:'build-adder',condition:{type:'level-completed',levelId:'ch1_half_adder'}},
    ]},
  ],
 }
};
let count=0;
function test(name,fn) {fn();count++;console.log('PASS',name);}
const qs=chapter.quests.side;
const progress = statuses => ({
 status:'accepted',steps:Object.fromEntries(Object.entries(statuses).map(([id,status])=>[id,{status}]))
});
const state={tasks:{main:{status:'accepted'},side:{'binary-decoder':{status:'accepted'},
                                               'yin-study':{status:'accepted'}}}};
const resolve=(quest,p,locationId='gate-road',extra={})=>resolveQuestDestination({
 entry:{quest,progress:p},chapter,state,locationId,canGoToLevel:true,...extra
});

test('no quest selected returns harmless reason',()=>{
 assert.equal(resolveQuestDestination({chapter,state}).reason,'暂无任务');
});
test('workshop starts with its actual dialogue',()=>{
 const x=resolve(qs[0],progress({'listen-workshop':'current'}));
 assert.equal(x.target.id,'mengjin-workshop-opening');
 assert.equal(x.stepId,'listen-workshop');
});
test('workshop level after dialogue uses its own ID and step',()=>{
 const x=resolve(qs[0],progress({'listen-workshop':'done','decode-four-combinations':'current'}));
 assert.equal(x.target.id,'ch1_binary_decoder');
 assert.equal(x.stepId,'decode-four-combinations');
 assert.equal(x.level.id,'ch1_binary_decoder');
});
test('workshop report after formal level uses report dialogue',()=>{
 const x=resolve(qs[0],progress({'listen-workshop':'done','decode-four-combinations':'done',
                                 'report-workshop':'current'}));
 assert.equal(x.target.id,'mengjin-workshop-report');
});
test('completed workshop opens review, no replayed step reward',()=>{
 const p=progress({'listen-workshop':'done','decode-four-combinations':'done','report-workshop':'done'});
 const x=resolve(qs[0],p,'gate-road',{
   reviewTarget:{type:'dialogue',id:'mengjin-workshop-finished',title:'重温本场'},
 });
 assert.equal(x.target.id,'mengjin-workshop-finished');
 assert.equal(x.stepId,null);
 assert.equal(p.steps['report-workshop'].status,'done');
});
test('main task still uses the configured NOT level, never first by default',()=>{
 const x=resolve(chapter.quests.main,progress({'step-1':'pending'}));
 assert.equal(x.target.id,'ch1_cmos_not');
});
test('another ordered task resolves its own target after prerequisites',()=>{
 state.tasks.side['binary-decoder'].status='submitted';
 const y=qs[1];
 const x=resolve(y,progress({'ask-yin':'done','build-adder':'current'}),'school');
 assert.equal(x.target.id,'ch1_half_adder');
 assert.equal(x.stepId,'build-adder');
});
test('prerequisites block a second task before workshop completion',()=>{
 state.tasks.side['binary-decoder'].status='accepted';
 assert.match(resolve(qs[1],progress({'ask-yin':'current'}),'school').reason,/前置任务/);
 state.tasks.side['binary-decoder'].status='submitted';
});
test('dialogue in the wrong room cannot navigate or change quest progress',()=>{
 assert.match(resolve(qs[1],progress({'ask-yin':'current'}),'gate-road').reason,/任务对应地点/);
});
test('malformed and undeveloped targets remain disabled',()=>{
 const c=structuredClone(chapter);
 c.questTargets['yin-study'].steps['build-adder']={type:'unknown',id:'abc'};
 const x=resolveQuestDestination({chapter:c,state,locationId:'school',canGoToLevel:true,
   entry:{quest:c.quests.side[1],progress:progress({'ask-yin':'done','build-adder':'current'})}});
 assert.match(x.reason,/尚未开放/);
});
test('target mismatch to a different level cannot bypass completion rules',()=>{
 const c=structuredClone(chapter);
 c.questTargets['binary-decoder'].steps['decode-four-combinations']={
   type:'level',id:'ch1_cmos_not',title:'wrong'};
 const x=resolveQuestDestination({chapter:c,state,locationId:'gate-road',canGoToLevel:true,
   entry:{quest:c.quests.side[0],progress:progress({'listen-workshop':'done','decode-four-combinations':'current'})}});
 assert.ok(x.reason);
});
test('return context remembers location and target step',()=>{
 const x=makeQuestReturnContext({chapterId:'ch1',locationId:'school',
   levelId:'ch1_half_adder',questId:'yin-study',stepId:'build-adder',playerX:423});
 const y=readQuestReturnContext(x,{chapterId:'ch1',levelId:'ch1_half_adder',locations:chapter.locations});
 assert.deepEqual(y,x);
 assert.equal(resolveReturnLocation({questReturn:x,locationId:'gate-road'},chapter,'ch1_half_adder'),'school');
});
test('different level cannot consume stale return context',()=>{
 const x=makeQuestReturnContext({chapterId:'ch1',locationId:'school',levelId:'ch1_half_adder'});
 assert.equal(resolveReturnLocation({questReturn:x,locationId:'gate-road'},chapter,'ch1_cmos_not'),'gate-road');
});
test('removed location falls back to a known current location',()=>{
 const x=makeQuestReturnContext({chapterId:'ch1',locationId:'school',levelId:'ch1_half_adder'});
 assert.equal(resolveReturnLocation({questReturn:x,locationId:'missing'},{
   ...chapter,locations:[{id:'gate-road'}]},'ch1_half_adder'),'gate-road');
});
test('invalid return data rejected without changing save',()=>{
 assert.throws(()=>makeQuestReturnContext({chapterId:'../abc',locationId:'gate-road',levelId:'ch1_cmos_not'}));
 assert.equal(readQuestReturnContext({version:1,chapterId:'ch1',locationId:'fake',
  levelId:'ch1_cmos_not'},{chapterId:'ch1',levelId:'ch1_cmos_not',locations:chapter.locations}),null);
});
console.log(`OK: ${count} task-navigation and return-context checks passed.`);
