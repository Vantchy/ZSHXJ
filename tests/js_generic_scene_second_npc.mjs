/** Real room + real player + sample JSON; DOM only is stubbed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRoom} from '../public/room.js';
const layout = {width:1440, buttonsLeft:1100, buttonsWidth:300, panelWidth:1040};

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.handlers = {};
    this.textContent = ''; this.className = ''; this.disabled = false;
    this.attributes = {}; this.hidden = false;
    this.style = {setProperty(){}};
    this.classList = {contains: name => this.className.split(' ').includes(name)};
  }
  append(...children) { for (const child of children) {child.parent = this; this.children.push(child);} }
  replaceChildren(...children) {this.children.forEach(child => {child.parent = null;}); this.children = []; this.append(...children);}
  remove() {if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null;}
  addEventListener(type, fn) {(this.handlers[type] ??= []).push(fn);}
  removeEventListener(type, fn) {this.handlers[type] = (this.handlers[type] || []).filter(item => item !== fn);}
  setAttribute(name, value) {this.attributes[name] = value;}
  focus() {document.activeElement = this;}
  closest(selector) {return selector === 'button' ? (this.tagName === 'BUTTON' ? this : this.parent?.closest(selector)) : null;}
  querySelector(selector) {
    const matches = node => selector.startsWith('.') ? selector.slice(1).split('.').every(name => node.className.split(' ').includes(name)) : node.tagName === selector.toUpperCase();
    for (const child of this.children) {if (matches(child)) return child; const found = child.querySelector(selector); if (found) return found;}
    return null;
  }
  querySelectorAll(tag) {return this.children.flatMap(child => [ ...(child.tagName === tag.toUpperCase() ? [child] : []), ...child.querySelectorAll(tag) ]);}
  getBoundingClientRect() {
    if (this.className.includes('room-control-pad')) return {left:layout.buttonsLeft,top:700,width:layout.buttonsWidth,height:60};
    if (this.className.includes('room-dialogue')) return {left:0,top:500,width:layout.panelWidth,height:260};
    return {left:0, top:0, width:layout.width, height:810};
  }
  async click() {
    if (this.disabled) return;
    let stopped = false;
    const event = {target:this, preventDefault(){}, stopPropagation(){stopped = true;}};
    let current = this;
    while (current) {
      for (const fn of [...current.handlers.click || []]) await fn(event);
      current = stopped ? null : current.parent;
    }
  }
}
const listeners = {};
const speakers = [];
let clock=1000; Date.now=()=>clock;
globalThis.document = {activeElement:null, createElement: tag => new Element(tag)};
globalThis.window = {
  get innerWidth(){return layout.width;},
  addEventListener(type, fn) {(listeners[type] ??= []).push(fn);},
  removeEventListener(type, fn) {listeners[type] = (listeners[type] || []).filter(item => item !== fn);},
  matchMedia:()=>({matches:true}),
  NPCDialogueDisplay: {setSpeaker: value => speakers.push(value), clearSpeaker: () => speakers.push(null)},
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};


/** The same real room handles a DIFFERENT NPC/quest/step/level with NO workshop IDs. */
import {normalizeQuestCollection} from '../public/task-model.js';
const quest={
  id:'weaver-numbers',type:'side',title:'织者的三步推演',
  chapterId:'ch1',locationId:'weaver-hut',prerequisites:[],rewards:[],tags:[],
  completion:{mode:'official-circuit',requireAllSteps:true,levelIds:['ch1_half_adder']},
  steps:[
    {id:'hear-weaver',title:'听织者讲解',
     condition:{type:'dialogue-finished',dialogueId:'weaver-end'}},
    {id:'build-pattern',title:'制作半加器',
     condition:{type:'level-completed',levelId:'ch1_half_adder'}},
    {id:'return-weaver',title:'向织者回报',
     condition:{type:'dialogue-finished',dialogueId:'weaver-report'}},
  ],
};
const policy={
  autoAccept:true,autoSubmit:true,allowReplay:true,
  supportingDialogues:{'build-pattern':'weaver-practice'},
  reviewEntryId:'weaver-start',
  hints:{'hear-weaver':'听取三步推演说明','build-pattern':'完成半加器练习',
         'return-weaver':'向织者回报','done':'织者的三步推演：已完成'},
  actions:{
    'hear-weaver':[
      {label:'立即开始推演',action:'complete-and-level'},
      {label:'稍后推演',action:'complete'}],
    'build-pattern':[
      {label:'继续推演',action:'level'},
      {label:'重新听讲',action:'review'},
      {label:'结束谈话',action:'close'}],
    'return-weaver':[{label:'汇报结果',action:'complete-and-submit'}],
    done:[{label:'重温织者讲解',action:'review'},
          {label:'重新挑战',action:'replay-level'},
          {label:'返回地图',action:'exit'},
          {label:'结束对话',action:'close'}],
    review:[{label:'回到当前步骤',action:'current'},
            {label:'结束对话',action:'close'}],
  },
};
const chapter={
  id:'ch1',title:'样例测试',order:1,spaceTitle:'织者的房间',
  room:'织者房间',npc:'织者',npcLine:'请听我讲述。',implemented:true,
  quests:{main:null,side:[quest]},
  locations:[{id:'weaver-hut',name:'织者房间',npc:'织者',
     dialogueId:'weaver-start',background:'/assets/scenes/workshop-background.png'}],
  levels:[{id:'ch1_half_adder',title:'半加器'}],
  questTargets:{'weaver-numbers':{
    steps:{
      'hear-weaver':{type:'dialogue',id:'weaver-start'},
      'build-pattern':{type:'level',id:'ch1_half_adder'},
      'return-weaver':{type:'dialogue',id:'weaver-report'},
    },
    review:{type:'dialogue',id:'weaver-finished'},
    scene:policy,
  }},
  dialogues:[
    {id:'weaver-start',lines:[{speaker:{name:'织者'},text:'先记住花纹的顺序。'}],
     options:[{text:'我已听明白',target:{type:'dialogue',id:'weaver-end'}}]},
    {id:'weaver-end',lines:[{speaker:{name:'织者'},text:'接下来开始推演。'}]},
    {id:'weaver-practice',lines:[{speaker:{name:'织者'},text:'试着搭出半加器。'}]},
    {id:'weaver-report',lines:[{speaker:{name:'织者'},text:'你已经完成推演。'}]},
    {id:'weaver-finished',lines:[{speaker:{name:'织者'},text:'以后也可回来重练。'}]},
  ],
};
const location=chapter.locations[0], characters={};
let host,state,dispose,results=[],entered=[],writes=[],errors=[],failCheckpoint='';
function open(savedState=null){
  host=new Element('div');
  state=savedState || {position:{x:630},flags:{},tasks:{},dialogues:[]};
  dispose=createRoom({host,chapter,location,state,characters,
    onSave:async checkpoint=>{
      if(checkpoint===failCheckpoint){failCheckpoint='';throw Error('controlled save failure');}
      writes.push({checkpoint,state:structuredClone(state)});
    },
    onGetLevelResults:async()=>results,
    onGoToLevel:async(id,nav)=>entered.push({id,nav}),
    onStartLevel:async()=>{},
    onExit:async()=>{},onError:error=>errors.push(error.message),
  });
}
const buttons=()=>host.querySelectorAll('button');
const find=label=>buttons().find(button=>button.textContent===label);
async function click(label){
  clock+=200;
  assert.ok(find(label),`Missing action "${label}"`);
  await find(label).click();
}
function activeStep(){
  return quest.steps.find(step=>state.tasks.side[quest.id].steps[step.id].status!=='done');
}
open();
failCheckpoint='quest_weaver-numbers_accept';
await click('与 NPC 交互');
assert.equal(state.tasks.side[quest.id].status,'not-accepted',
  'A rejected auto-accept must roll back the generic scene quest');
await click('与 NPC 交互');
assert.equal(state.tasks.side[quest.id].status,'accepted');
assert.equal(writes[0].checkpoint,'quest_weaver-numbers_accept');
await click('我已听明白');
assert.ok(find('稍后推演'));
await click('稍后推演');
assert.equal(activeStep().id,'build-pattern');
assert.equal(writes.at(-1).checkpoint,'quest_dialogue_weaver-numbers_hear-weaver_finished');
await click('与 NPC 交互');
assert.ok(find('继续推演'));
await click('继续推演');
assert.deepEqual(entered[0].id,'ch1_half_adder');
assert.equal(entered[0].nav.questId,'weaver-numbers');
assert.equal(entered[0].nav.stepId,'build-pattern');
const snapshot=structuredClone(state);
dispose();
open(snapshot);
results=[{levelId:'ch1_half_adder',completed:true,assessmentType:'circuit_server'}];
await click(''); // existing task HUD opens task book
assert.ok(find('前往'));
await click('前往');
assert.equal(activeStep().id,'return-weaver');
assert.ok(find('汇报结果'));
assert.equal(writes.at(-1).checkpoint,'quest_weaver-numbers_officialPass');
// A failed second write must preserve completed progress and let retry submit.
failCheckpoint='quest_weaver-numbers_submit';
await click('汇报结果');
assert.equal(state.tasks.side[quest.id].status,'completed');
assert.ok(find('汇报结果'));
await click('汇报结果');
assert.equal(state.tasks.side[quest.id].status,'submitted');
assert.equal(activeStep(),undefined);
assert.ok(errors.includes('controlled save failure'));
const complete=structuredClone(state.tasks);
dispose();open(structuredClone(state));
await click('与 NPC 交互');
await click('重温织者讲解');
await click('我已听明白');
assert.ok(find('回到当前步骤'));
assert.deepEqual(state.tasks,complete,'Review never rewrites quest evidence');
await click('回到当前步骤');
await click('重新挑战');
assert.equal(entered.length,2);
assert.equal(entered[1].nav.replay,true);
assert.deepEqual(state.tasks,complete,'Replay never resets a completed quest');
dispose();
assert.equal(listeners.keydown.length,0);
console.log('Independent scene PASS: other quest/step/dialogue/level IDs use identical NPC, score, rollback, report, review and replay controller.');
