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



/** Three NPCs in one room: two independent quest scenes + ambient dialogue. */
import {normalizeQuestCollection} from '../public/task-model.js';
import {createRoomActors, closestActor, actorForQuest} from '../public/room-actors.js';

function quest(id,prefix,levelId,title){
  return {id,type:'side',title,chapterId:'ch1',locationId:'shared-room',
    prerequisites:[],rewards:[],tags:[],
    completion:{mode:'official-circuit',requireAllSteps:true,levelIds:[levelId]},
    steps:[
      {id:`${prefix}-listen`,title:'听说明',condition:{type:'dialogue-finished',dialogueId:`${prefix}-end`}},
      {id:`${prefix}-build`,title:'正式电路',condition:{type:'level-completed',levelId}},
      {id:`${prefix}-report`,title:'回报',condition:{type:'dialogue-finished',dialogueId:`${prefix}-report`}}
    ]};
}
function policy(prefix){
  return {autoAccept:true,autoSubmit:true,allowReplay:true,
    supportingDialogues:{[`${prefix}-build`]:`${prefix}-practice`},
    reviewEntryId:`${prefix}-intro`,
    hints:{[`${prefix}-listen`]:'听任务说明',[`${prefix}-build`]:'练习电路',
      [`${prefix}-report`]:'回报结果',done:'已完成'},
    actions:{
      [`${prefix}-listen`]:[{label:`${prefix}立即练习`,action:'complete-and-level'},
                            {label:`${prefix}稍后`,action:'complete'}],
      [`${prefix}-build`]:[{label:`${prefix}继续练习`,action:'level'},
                           {label:'重温说明',action:'review'},
                           {label:'结束对话',action:'close'}],
      [`${prefix}-report`]:[{label:'完成本场',action:'complete-and-submit'}],
      done:[{label:'复述',action:'review'},{label:'重做练习',action:'replay-level'},
        {label:'离开',action:'close'}],
      review:[{label:'返回当前进度',action:'current'},
        {label:'结束对话',action:'close'}]
    }
  };
}
function target(prefix,levelId){
  return {steps:{
      [`${prefix}-listen`]:{type:'dialogue',id:`${prefix}-intro`},
      [`${prefix}-build`]:{type:'level',id:levelId},
      [`${prefix}-report`]:{type:'dialogue',id:`${prefix}-report`}},
    review:{type:'dialogue',id:`${prefix}-review`},scene:policy(prefix)};
}
function dialogues(prefix,name){
  return [
    {id:`${prefix}-intro`,lines:[{speaker:{name},text:`${name}开始介绍。`}],
      options:[{text:`${prefix}明白`,target:{type:'dialogue',id:`${prefix}-end`}}]},
    {id:`${prefix}-end`,lines:[{speaker:{name},text:`${name}说完了。`}]},
    {id:`${prefix}-practice`,lines:[{speaker:{name},text:`${name}请练习。`}]},
    {id:`${prefix}-report`,lines:[{speaker:{name},text:`${name}接受回报。`}]},
    {id:`${prefix}-review`,lines:[{speaker:{name},text:`${name}复述。`}]},
  ];
}
const questA=quest('artisan-task','artisan','ch1_cmos_not','甲匠的逻辑门');
const questB=quest('weaver-task','weaver','ch1_half_adder','乙织的半加器');
const location={id:'shared-room',name:'双人作坊',background:'/assets/scenes/workshop-background.png',
  characterPlacements:[
    {characterId:'artisan',x:270,dialogueId:'artisan-intro',questId:'artisan-task'},
    {characterId:'weaver',x:740,dialogueId:'weaver-intro',questId:'weaver-task'},
    {characterId:'apprentice',x:900,dialogueId:'apprentice-hello'},
  ]};
const characters={artisan:{id:'artisan',name:'甲匠'},
  weaver:{id:'weaver',name:'乙织'},apprentice:{id:'apprentice',name:'学徒'}};
const chapter={id:'ch1',order:1,implemented:true,spaceTitle:'多人物测试作坊',
  npc:'甲匠',npcLine:'可以说话。',locations:[location],
  quests:{main:null,side:[questA,questB]},
  levels:[{id:'ch1_cmos_not',title:'非门'},{id:'ch1_half_adder',title:'半加器'}],
  questTargets:{'artisan-task':target('artisan','ch1_cmos_not'),
                'weaver-task':target('weaver','ch1_half_adder')},
  dialogues:[...dialogues('artisan','甲匠'),...dialogues('weaver','乙织'),
    {id:'apprentice-hello',lines:[{speaker:{name:'学徒'},text:'我只提供帮助。'}]}]
};
// Legacy one-person room preserves original coordinates and quest ownership.
const legacyActors=createRoomActors(chapter,{
  id:'shared-room',npc:'甲匠',dialogueId:'artisan-intro'},characters);
assert.equal(legacyActors.length,1);
assert.equal(legacyActors[0].x,583);
assert.equal(legacyActors[0].name,'甲匠');
// More than one authored quest cannot be guessed from a legacy lone-NPC config.
assert.equal(legacyActors[0].questId,null);
// One authored quest plus an unbound extra actor preserves the named owner's
// existing task instead of incorrectly assigning it to a bystander.
const oneQuestRoom={...chapter,quests:{main:null,side:[questA]},
  questTargets:{'artisan-task':target('artisan','ch1_cmos_not')}};
const inferred=createRoomActors(oneQuestRoom,{
  id:'shared-room',npc:'甲匠',
  characterPlacements:[
    {characterId:'apprentice',x:300,dialogueId:'apprentice-hello'},
    {characterId:'artisan',x:700},
  ]},characters);
assert.equal(inferred.find(a=>a.id==='artisan').questId,'artisan-task');
assert.equal(inferred.find(a=>a.id==='apprentice').questId,null);
const actors=createRoomActors(chapter,location,characters);
assert.equal(actors.length,3);
assert.deepEqual(actors.map(a=>a.x),[270,740,900]);
assert.equal(actorForQuest(actors,'artisan-task')?.id,'artisan');
assert.equal(actorForQuest(actors,'weaver-task')?.id,'weaver');
assert.equal(closestActor(actors,790,145)?.id,'weaver');
assert.equal(closestActor(actors,105,100),null);
let host=new Element('div'),writes=[],errors=[],routes=[],failCheckpoint='';
const state={position:{x:270},flags:{},tasks:{},dialogues:[]};
const dispose=createRoom({host,chapter,location,characters,state,
  onSave:async checkpoint=>{
    if (checkpoint===failCheckpoint){failCheckpoint='';throw Error('controlled multi NPC save failure');}
    writes.push({checkpoint,state:structuredClone(state)});
  },
  onGetLevelResults:async()=>[],
  onStartLevel:async()=>{},
  onGoToLevel:async(id,nav)=>routes.push({id,...nav}),
  onExit:async()=>{},
  onError:error=>errors.push(error.message),
});
const buttons=()=>host.querySelectorAll('button');
const find=label=>buttons().find(b=>b.textContent===label);
const findNpc=id=>buttons().find(b=>b.attributes['data-npc-id']===id);
const click=async label=>{
  const b=find(label);assert.ok(b,`Missing ${label}`);clock+=250;await b.click();
};
const escape=()=>{
  for(const callback of listeners.keydown||[]) callback({code:'Escape',repeat:false,preventDefault(){}});
};
const npcButtons=buttons().filter(b=>b.className.includes('room-actor--npc'));
assert.equal(npcButtons.length,3,'Separate DOM buttons for each actor');
assert.ok(npcButtons.every(b=>b.attributes['aria-label']?.includes('交谈')));
assert.ok(host.querySelector('.room-world--multi'),'Multi-NPC world CSS active');
await findNpc('artisan').click();
assert.equal(state.tasks.side['artisan-task'].status,'accepted');
assert.equal(state.tasks.side['weaver-task'].status,'not-accepted');
await click('artisan明白');
await click('artisan稍后');
assert.equal(state.tasks.side['artisan-task'].steps['artisan-listen'].status,'done');
assert.equal(state.tasks.side['weaver-task'].steps['weaver-listen'].status,'current');
assert.equal(writes[0].checkpoint,'quest_artisan-task_accept');

// Walk into the other NPC's interaction range; keyboard E chooses NEAREST,
// not the first scene quest from the chapter or the last selected actor.
for(let i=0;i<10;i++)await click('向右');
assert.ok(state.position.x>=650);
failCheckpoint='quest_weaver-task_accept';
await click('与 NPC 交互');
assert.equal(state.tasks.side['weaver-task'].status,'not-accepted',
  'Failed B acceptance rolled back without changing A');
assert.equal(state.tasks.side['artisan-task'].status,'accepted');
await click('与 NPC 交互');
assert.equal(state.tasks.side['weaver-task'].status,'accepted');
assert.ok(errors.includes('controlled multi NPC save failure'));
await click('weaver明白');
await click('weaver稍后');
assert.equal(state.tasks.side['weaver-task'].steps['weaver-listen'].status,'done');
assert.equal(state.tasks.side['artisan-task'].steps['artisan-listen'].status,'done');

// Task-book route must use the selected task's owner, not any other NPC;
// each level is independent and carries the matching quest/step identity.
const toggle=buttons().find(b=>b.className==='room-taskbar-toggle');
assert.ok(toggle);
await toggle.click();
let entries=buttons().filter(b=>b.className.includes('room-quest-task'));
await entries.find(b=>b.textContent==='乙织的半加器').click();
await buttons().find(b=>b.className==='room-quest-go').click();
assert.equal(routes.at(-1).id,'ch1_half_adder');
assert.equal(routes.at(-1).questId,'weaver-task');
assert.equal(routes.at(-1).stepId,'weaver-build');
await toggle.click();
entries=buttons().filter(b=>b.className.includes('room-quest-task'));
await entries.find(b=>b.textContent==='甲匠的逻辑门').click();
await buttons().find(b=>b.className==='room-quest-go').click();
assert.equal(routes.at(-1).id,'ch1_cmos_not');
assert.equal(routes.at(-1).questId,'artisan-task');
assert.equal(routes.at(-1).stepId,'artisan-build');

// The ambient apprentice has separate dialogue but cannot accept either
// scene quest. Moving there and interacting must not touch grade/task state.
state.position.x=900;
const before=structuredClone(state.tasks);
await findNpc('apprentice').click();
assert.ok(speakers.some(s=>s?.name==='学徒'));
assert.deepEqual(state.tasks,before);
escape();
assert.deepEqual(state.tasks,before);

// Far click only establishes a walk target; it cannot trigger an out-of-range
// NPC's scene or auto-accept a quest, even when another NPC is in range.
state.position.x=900;
const oldCount=writes.length;
await findNpc('artisan').click();
assert.equal(writes.length,oldCount);
assert.deepEqual(state.tasks,before);

dispose();
assert.equal(listeners.keydown.length,0);
// Adversarial async interleaving: B's optimistic acceptance must keep NPC
// selection pinned to B until its PUT finishes or fully rolls back.
let releasePending;
const saveGate=new Promise(resolve=>{releasePending=resolve;});
const secondState={position:{x:740},flags:{},tasks:{},dialogues:[]};
const secondHost=new Element('div');
let attempts=0;
const disposeSecond=createRoom({host:secondHost,chapter,location,characters,state:secondState,
  returnContext:{questId:'weaver-task'},
  onSave:async checkpoint=>{
    if(checkpoint==='quest_weaver-task_accept'){
      attempts++;
      await saveGate;
      throw Error('forced delayed rejection');
    }
  },
  onGetLevelResults:async()=>[],onStartLevel:async()=>{},onGoToLevel:async()=>{},
  onExit:async()=>{},onError:()=>{},
});
const secondNpc=id=>secondHost.querySelectorAll('button')
  .find(button=>button.attributes['data-npc-id']===id);
assert.equal(secondNpc('weaver').attributes['aria-current'],'true',
  "Returning from B's circuit selects the correct NPC immediately");
const pendingAccept=secondNpc('weaver').click();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(attempts,1);
assert.equal(secondState.tasks.side['weaver-task'].status,'accepted');
await secondNpc('artisan').click();
assert.equal(secondHost.querySelectorAll('button')
  .find(button=>button.attributes['data-npc-id']==='weaver')
  .attributes['aria-current'],'true','Pending save keeps B as active actor');
assert.equal(secondState.tasks.side['artisan-task'].status,'not-accepted');
releasePending();
await pendingAccept;
assert.equal(secondState.tasks.side['weaver-task'].status,'not-accepted');
assert.equal(secondState.tasks.side['artisan-task'].status,'not-accepted');
disposeSecond();
assert.equal(listeners.keydown.length,0);

console.log('Multi NPC room PASS: 3 independent actor buttons/coordinates, E nearest, 2 quest owners and levels, failed save rollback, taskbook and ambient dialogue isolation.');
