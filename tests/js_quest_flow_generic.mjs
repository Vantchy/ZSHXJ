/** Node ESM regression tests for the reusable ordered quest flow. */
import assert from 'node:assert/strict';
import {
  firstIncompleteFlowStep, flowIsDone, normalizeFlowProgress,
  currentFlowTarget, finishFlowDialogue, syncFlowOfficialPass,
} from '../public/quest-flow.js';
import {
  WORKSHOP_ID, WORKSHOP_INTRO, WORKSHOP_LEVEL, WORKSHOP_REPORT,
  isWorkshopQuest, workshopStage, normalizeWorkshopProgress,
  finishWorkshopDialogue, workshopProgressWithPass,
} from '../public/workshop-quest.js';
import {changeQuestStatus, normalizeQuestProgress} from '../public/task-model.js';

const workshop = {
  id:WORKSHOP_ID, completion:{mode:'official-circuit',requireAllSteps:true,levelIds:['ch1_binary_decoder']},
  steps: [
    {id:WORKSHOP_INTRO, condition:{type:'dialogue-finished',dialogueId:'mengjin-workshop-closing'}},
    {id:WORKSHOP_LEVEL, condition:{type:'level-completed',levelId:'ch1_binary_decoder'}},
    {id:WORKSHOP_REPORT, condition:{type:'dialogue-finished',dialogueId:'mengjin-workshop-report'}},
  ],
};
const proof=(levelId='ch1_binary_decoder',type='circuit_server',completed=true)=>
  [{levelId,assessmentType:type,completed}];
const accepted = (definition) => normalizeFlowProgress(
  changeQuestStatus(normalizeFlowProgress(null,definition),'accepted'),definition);
const stage = (progress) => workshopStage(progress);
let count=0;
function test(name,fn) {fn();count++;console.log('PASS', name);}

test('v0.9 export names/IDs and workshop matching preserved',()=>{
  assert.ok(isWorkshopQuest(workshop));
  assert.equal(WORKSHOP_ID,'binary-decoder');
  assert.equal(WORKSHOP_INTRO,'listen-workshop');
  assert.equal(WORKSHOP_LEVEL,'decode-four-combinations');
  assert.equal(WORKSHOP_REPORT,'report-workshop');
});

test('legacy save kept: completed official pass does not reset',()=>{
  const old={status:'submitted',steps:{
    'decode-four-combinations':{status:'done',updatedAt:'earlier',evidence:{assessmentType:'circuit_server'}}
  }};
  const next=normalizeWorkshopProgress(old,workshop);
  assert.equal(next.status,'submitted');
  assert.equal(next.steps[WORKSHOP_LEVEL].status,'done');
  assert.equal(next.steps[WORKSHOP_INTRO].status,'current');
  assert.equal(next.steps[WORKSHOP_REPORT].status,'pending');
  assert.equal(stage(next),'intro');
  assert.equal(old.steps[WORKSHOP_INTRO],undefined);
});

test('unfinished dialogue cannot be marked by wrong step or dialogueId',()=>{
  const progress=accepted(workshop);
  assert.equal(stage(progress),'intro');
  assert.deepEqual(finishFlowDialogue(progress,workshop,
    {stepId:WORKSHOP_REPORT,dialogueId:'mengjin-workshop-report'}),progress);
  assert.deepEqual(finishFlowDialogue(progress,workshop,
    {stepId:WORKSHOP_INTRO,dialogueId:'wrong'}),progress);
  assert.deepEqual(progress.steps[WORKSHOP_INTRO].status,'current');
});

test('dialogue completion requires acceptance and is idempotent',()=>{
  assert.throws(()=>finishWorkshopDialogue(normalizeWorkshopProgress(null,workshop),
    workshop,WORKSHOP_INTRO), /请先接取玉匠铺任务/);
  const progress=accepted(workshop);
  const next=finishWorkshopDialogue(progress,workshop,WORKSHOP_INTRO);
  assert.equal(stage(next),'exercise');
  assert.equal(progress.steps[WORKSHOP_INTRO].status,'current','caller remains untouched');
  assert.deepEqual(finishWorkshopDialogue(next,workshop,WORKSHOP_INTRO),next);
  assert.deepEqual(next.steps[WORKSHOP_INTRO].evidence,{
    type:'dialogue-finished',dialogueId:'mengjin-workshop-closing'});
});

test('only matching formal server assessment completes level',()=>{
  const intro=finishWorkshopDialogue(accepted(workshop),workshop,WORKSHOP_INTRO);
  for(const invalid of [proof('ch1_cmos_not'),proof('ch1_binary_decoder','local'),
       proof('ch1_binary_decoder','circuit_server',false),[]]){
    const next=workshopProgressWithPass(intro,workshop,invalid);
    assert.equal(stage(next),'exercise');
  }
  const passed=workshopProgressWithPass(intro,workshop,proof());
  assert.equal(stage(passed),'report');
  assert.deepEqual(passed.steps[WORKSHOP_LEVEL].evidence,{
    levelId:'ch1_binary_decoder',assessmentType:'circuit_server'});
  assert.deepEqual(workshopProgressWithPass(passed,workshop,proof()),passed);
});

test('report completes quest only after real level evidence',()=>{
  const intro=finishWorkshopDialogue(accepted(workshop),workshop,WORKSHOP_INTRO);
  assert.equal(stage(finishWorkshopDialogue(intro,workshop,WORKSHOP_REPORT)),'exercise');
  const passed=workshopProgressWithPass(intro,workshop,proof());
  const report=finishWorkshopDialogue(passed,workshop,WORKSHOP_REPORT);
  assert.equal(stage(report),'done');
  assert.equal(report.status,'completed');
  assert.deepEqual(finishWorkshopDialogue(report,workshop,WORKSHOP_REPORT),report);
});

test('finished/review actions do not regress or rewrite submitted saves',()=>{
  const complete=finishWorkshopDialogue(workshopProgressWithPass(
    finishWorkshopDialogue(accepted(workshop),workshop,WORKSHOP_INTRO),
    workshop,proof()), workshop, WORKSHOP_REPORT);
  const submitted=changeQuestStatus(complete,'submitted');
  assert.deepEqual(workshopProgressWithPass(submitted,workshop,proof()),submitted);
  assert.deepEqual(finishWorkshopDialogue(submitted,workshop,WORKSHOP_REPORT),submitted);
  assert.equal(stage(submitted),'done');
});

test('generic flow handles a SECOND non-workshop quest with different IDs',()=>{
  const quest={
    id:'yin-half-adder-study',completion:{mode:'official-circuit',requireAllSteps:true,levelIds:['ch1_half_adder']},
    steps:[
      {id:'ask-yin',condition:{type:'dialogue-finished',dialogueId:'yin-lesson-1'}},
      {id:'build-adder',condition:{type:'level-completed',levelId:'ch1_half_adder'}},
      {id:'tell-yin',condition:{type:'dialogue-finished',dialogueId:'yin-response'}},
    ],
  };
  const targets={steps:{
    'ask-yin':{type:'dialogue',id:'yin-lesson-1',title:'听说明'},
    'build-adder':{type:'level',id:'ch1_half_adder',title:'搭建半加器'},
    'tell-yin':{type:'dialogue',id:'yin-response',title:'回报'},
  }};
  let progress=accepted(quest);
  assert.equal(currentFlowTarget(progress,quest,targets).id,'yin-lesson-1');
  progress=finishFlowDialogue(progress,quest,{stepId:'ask-yin',dialogueId:'yin-lesson-1'});
  assert.equal(currentFlowTarget(progress,quest,targets).id,'ch1_half_adder');
  progress=syncFlowOfficialPass(progress,quest,proof('ch1_half_adder'));
  assert.equal(currentFlowTarget(progress,quest,targets).id,'yin-response');
  progress=finishFlowDialogue(progress,quest,{stepId:'tell-yin',dialogueId:'yin-response'});
  assert.ok(flowIsDone(progress,quest));
  assert.equal(progress.status,'completed');
  assert.equal(firstIncompleteFlowStep(progress,quest),null);
  assert.equal(currentFlowTarget(progress,quest,targets),null);
});

test('one quest with multiple independent level steps only advances current one',()=>{
  const quest={id:'two-levels',completion:{requireAllSteps:true,mode:'official-circuit',
    levelIds:['ch1_cmos_not','ch1_half_adder']},steps:[
    {id:'one',condition:{type:'level-completed',levelId:'ch1_cmos_not'}},
    {id:'two',condition:{type:'level-completed',levelId:'ch1_half_adder'}},
  ]};
  let progress=accepted(quest);
  const score=[...proof('ch1_cmos_not'),...proof('ch1_half_adder')];
  progress=syncFlowOfficialPass(progress,quest,score);
  assert.equal(progress.steps.one.status,'done');
  assert.equal(progress.steps.two.status,'current');
  assert.equal(progress.status,'accepted');
  progress=syncFlowOfficialPass(progress,quest,score);
  assert.equal(progress.steps.two.status,'done');
  assert.equal(progress.status,'accepted'); // score synchronization is not quest submission
});

test('target resolver does not guess unknown target or skip unfinished steps',()=>{
  const progress=accepted(workshop);
  assert.equal(currentFlowTarget(progress,workshop,{steps:{
    [WORKSHOP_INTRO]:{type:'unsupported',id:'something'}}}),null);
  assert.equal(currentFlowTarget(progress,workshop,{steps:{
    [WORKSHOP_LEVEL]:{type:'level',id:'ch1_binary_decoder'}}}),null);
  assert.equal(flowIsDone(progress,workshop),false);
});

test('repeated early grade sync never bypasses required opening dialogue',()=>{
  let progress=accepted(workshop);
  for(let i=0;i<5;i++) {
    progress=syncFlowOfficialPass(progress,workshop,proof());
    assert.equal(stage(progress),'intro');
  }
});

console.log(`OK: ${count} reusable-flow + v0.9 compatibility tests passed.`);
