/** Real room + real player + sample JSON; DOM only is stubbed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {workshopProgressWithPass, normalizeWorkshopProgress, workshopStage} from '../public/workshop-quest.js';
import {createRoom} from '../public/room.js';
import {syncFlowOfficialPass} from '../public/quest-flow.js';
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


const earlier={id:'warmup',type:'side',title:'旧有任务',chapterId:'ch1',locationId:'school',
  steps:[],prerequisites:[],completion:{mode:'test-only',levelIds:[]}};
const quest={
  id:'diviner-study',type:'side',title:'贞人习题',chapterId:'ch1',locationId:'school',
  prerequisites:['warmup'],completion:{mode:'official-circuit',levelIds:['ch1_half_adder'],requireAllSteps:true},
  steps:[
    {id:'hear-diviner',title:'听说明',condition:{type:'dialogue-finished',dialogueId:'diviner-end'}},
    {id:'make-adder',title:'搭半加器',condition:{type:'level-completed',levelId:'ch1_half_adder'}},
    {id:'report-diviner',title:'向贞人回报',condition:{type:'dialogue-finished',dialogueId:'diviner-report'}},
  ],
};
const location={id:'school',name:'学舍',npc:'贞人'};
const chapter={id:'ch1',order:1,canEnter:true,implemented:true,
  npc:'贞人',npcLine:'请问有何事？',room:'学舍',locations:[location],
  quests:{main:null,side:[earlier,quest]},
  levels:[{id:'ch1_half_adder',title:'半加器'}],
  questTargets:{'diviner-study':{steps:{
    'hear-diviner':{type:'dialogue',id:'diviner-start',title:'与贞人交谈'},
    'make-adder':{type:'level',id:'ch1_half_adder',title:'完成半加器'},
    'report-diviner':{type:'dialogue',id:'diviner-report',title:'向贞人回报'},
  }}},
  dialogues:[
    {id:'diviner-start',lines:[{speaker:{name:'贞人'},text:'先听我讲讲。'}],
      options:[{text:'继续说明',target:{type:'dialogue',id:'diviner-end'}}]},
    {id:'diviner-end',lines:[{speaker:{name:'贞人'},text:'讲解结束了。'}]},
    {id:'diviner-report',lines:[{speaker:{name:'贞人'},text:'做得好。'}]},
  ],
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let host,state,dispose,errors=[],saves=[],levels=[],failCheckpoint='';
function create(initial){
  host=new Element('div');
  state=initial || {position:{x:630},flags:{},tasks:{side:{warmup:{status:'submitted'}}},
    dialogues:[]};
  saves=[];errors=[];levels=[];failCheckpoint='';
  dispose=createRoom({host,chapter,state,location,characters:{},
    onSave:async checkpoint=>{
      if(checkpoint===failCheckpoint){failCheckpoint='';throw Error('controlled save failure');}
      saves.push({checkpoint,state:structuredClone(state)});
      return {profile:{balance:0,inventory:{}}};
    },
    onGoToLevel:async(levelId,context)=>levels.push({levelId,context}),
    onStartLevel:async()=>{},onExit:async()=>{},onGetLevelResults:async()=>[],
    onError:error=>errors.push(error.message),
  });
}
const buttons=()=>host.querySelectorAll('button');
const find=label=>buttons().find(item=>item.textContent===label);
async function click(label){
  clock+=200;
  const button=find(label);
  assert.ok(button,`Missing ${label}; available: ${buttons().map(b=>b.textContent).join('|')}`);
  await button.click();
}
const progress=()=>state.tasks.side['diviner-study'];
const phase=()=>quest.steps.find(step=>progress().steps[step.id]?.status!=='done')?.id||'done';
async function taskBook(){
  if(host.querySelector('.room-task-panel').hidden) await host.querySelector('.room-taskbar-toggle').click();
  const panel=host.querySelector('.room-quest-go');
  assert.ok(panel);
}

create();
await taskBook();
await click('贞人习题');
assert.ok(find('接取并前往'));
await click('接取并前往');
assert.equal(progress().status,'accepted');
assert.equal(phase(),'hear-diviner');
assert.ok(find('继续说明'));
await click('继续说明');
assert.equal(phase(),'hear-diviner','Opening or choosing a branch does not finish it');
assert.ok(find('上一句'));
await click('上一句');
assert.equal(phase(),'hear-diviner','Backtracking cannot mark the step complete');
await click('继续');
assert.equal(phase(),'hear-diviner');
assert.ok(find('结束对话'));
failCheckpoint='quest_dialogue_diviner-study_hear-diviner_finished';
await click('结束对话');
await tick();
assert.equal(phase(),'hear-diviner','Failed dialogue save must roll back');
assert.ok(errors.includes('controlled save failure'));
await taskBook();
await click('贞人习题');
await click('前往');
assert.ok(find('继续说明'));
await click('继续说明');
await click('结束对话');
await tick();
assert.equal(phase(),'make-adder');
assert.equal(progress().steps['hear-diviner'].evidence.dialogueId,'diviner-end');
assert.equal(saves.filter(s=>s.checkpoint.includes('hear-diviner_finished')).length,1);
await taskBook();
await click('贞人习题');
await click('前往');
assert.equal(levels.length,1);
assert.equal(levels[0].levelId,'ch1_half_adder');
assert.equal(levels[0].context.stepId,'make-adder');
assert.equal(phase(),'make-adder');

// In the actual app, official score sync runs after returning from editor.
const passed=syncFlowOfficialPass(progress(),quest,[
  {levelId:'ch1_half_adder',completed:true,assessmentType:'circuit_server'}]);
state.tasks.side['diviner-study']=passed;
assert.equal(progress().status,'accepted','A formal score never skips report');
assert.equal(phase(),'report-diviner');
await taskBook();
await click('贞人习题');
await click('前往');
assert.ok(find('结束对话'));
await click('结束对话');
await tick();
assert.equal(progress().status,'completed');
assert.equal(phase(),'done');
assert.equal(saves.filter(s=>s.checkpoint.includes('report-diviner_finished')).length,1);
const before=structuredClone(progress());
await taskBook();
await click('贞人习题');
assert.ok(find('前往'));
assert.equal(find('前往').disabled,true,'Completed ordered quest has no new next target');
assert.deepEqual(progress(),before);
dispose();

// Unmet prerequisite: NPC cannot accept and task book does not allow entry.
create({position:{x:630},flags:{},dialogues:[],tasks:{side:{warmup:{status:'not-accepted'}}}});
await taskBook();
await click('贞人习题');
assert.ok(find('前往').disabled);
await host.querySelector('.room-taskbar-toggle').click(); // task bar toggles back
await click('与 NPC 交互');
assert.equal(Boolean(find('接取贞人习题')),false);
assert.equal(progress().status,'not-accepted');
dispose();

console.log('Generic quest room PASS: prerequisite lock, real dialogue onFinish, previous/review no progress, failed-save retry, formal level step and return-report completion.');
