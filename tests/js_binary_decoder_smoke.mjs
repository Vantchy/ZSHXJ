import {sceneConfig} from '../public/quest-scene.js';
import {questPrerequisitesSatisfied} from '../public/task-model.js';
import {syncFlowOfficialPass} from '../public/quest-flow.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mount} from '../public/circuit-editor.js';
import {changeQuestStatus} from '../public/task-model.js';
import {isWorkshopQuest, workshopProgressWithPass} from '../public/workshop-quest.js';
class TestElement {
  constructor(tag){
    this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;
    this.handlers={};this.attributes={};this.dataset={};this.hidden=false;
    this.disabled=false;this.textContent='';this.className='';this.style={};
    this.captures=new Set();
    this.classList={
      add:(...classes)=>{const current=new Set(this.className.split(' ').filter(Boolean));
        classes.forEach(c=>current.add(c));this.className=[...current].join(' ');},
      contains:(klass)=>this.className.split(' ').includes(klass),
      toggle:(klass,force)=>{
        const current=new Set(this.className.split(' ').filter(Boolean));
        if(force??!current.has(klass))current.add(klass);else current.delete(klass);
        this.className=[...current].join(' ');
      }
    };
  }
  append(...children){children.forEach(c=>{this.children.push(c);c.parentNode=this;});}
  replaceChildren(...children){for(const child of this.children)child.parentNode=null;
    this.children=[];this.append(...children);}
  setAttribute(name,value){
    this.attributes[name]=String(value);
    if(name==='class')this.className=String(value);
    if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=String(value);
  }
  getAttribute(name){return this.attributes[name]??null;}
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
  removeEventListener(type,fn){this.handlers[type]=(this.handlers[type]||[]).filter(f=>f!==fn);}
  matches(selector){
    if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
    if(selector.startsWith('[')&&selector.endsWith(']')){
      const attr=selector.slice(1,-1);return this.getAttribute(attr)!==null;
    }
    return this.tagName===selector.toUpperCase();
  }
  closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
  querySelectorAll(selector){const result=[];for(const child of this.children){
    if(child.matches(selector))result.push(child);
    result.push(...child.querySelectorAll(selector));
  }return result;}
  getBoundingClientRect(){return {left:0,top:0,right:1600,bottom:1000,width:1600,height:1000};}
  createSVGPoint(){return {x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}};}
  getScreenCTM(){return {a:1,d:1,inverse(){return this;}};}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
  async dispatch(name,props={}){
    const event={pointerId:1,button:0,clientX:500,clientY:300,
      shiftKey:false,altKey:false,target:this,
      preventDefault(){},stopPropagation(){},...props};
    for(const listener of [...(this.handlers[name]||[])])await listener(event);
  }
  async click(){await this.dispatch('click');}
}
const listeners={};
globalThis.document={
  createElement:tag=>new TestElement(tag),
  createElementNS:(_,tag)=>new TestElement(tag),
};
globalThis.window={
  confirm:()=>true,
  addEventListener:(name,fn)=>{(listeners[name]??=[]).push(fn);},
  removeEventListener:(name,fn)=>{listeners[name]=(listeners[name]||[]).filter(f=>f!==fn);},
};

const spec=JSON.parse(fs.readFileSync(new URL('../levels/ch1_binary_decoder_v1.json',import.meta.url)));
const shape=(name,inputs,outputs)=>({name,family:'gate',pins:[...inputs.map(name=>({name,direction:'in',width:1})),...outputs.map(name=>({name,direction:'out',width:1}))]});
const types={input:shape('输入',[],['out']),output:shape('输出',['in'],[]),not:shape('非门',['in'],['out']),and:shape('与门',['in1','in2'],['out']),junction:shape('接点',['a','b','c','d'],['out'])};
const host=new TestElement('div');let saved;
const editor=await mount({container:host,chapter:{id:'ch1',title:'第一章'},level:{...spec,levelVersion:1,circuitSchemaVersion:1},state:{schemaVersion:2},
 api:async(method,path)=>{if(path==='/api/circuit/components')return {types,packages:[]};if(path==='/api/circuit/results/mine')return {results:[]};throw Error('Unexpected request '+path);},
 saveProgress:async state=>{saved=structuredClone(state);},exit:async()=>{},signal:new AbortController().signal});
assert.equal(host.getAttribute('data-level-description'),spec.description);
assert.equal(host.querySelectorAll('.ce-objective')[0].textContent,spec.description);
assert.equal(host.querySelectorAll('.ce-input-component').length,2);
assert.equal(host.querySelectorAll('.ce-components')[0].querySelectorAll('.ce-lamp').length,4);
await host.querySelectorAll('button').find(b=>b.textContent==='保存进度').click();
assert.equal(saved.circuitLevels.ch1_binary_decoder.graph.components.length,6);
assert.equal(saved.circuitLevels.ch1_binary_decoder.levelVersion,1);
editor.dispose();assert.equal((listeners.keydown||[]).length,0);

// Execute the actual task-completion synchronizer with independent official
// task definitions: a binary pass cannot finish the older four-level main task.
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const begin=app.indexOf('async function syncFirstCircuitQuestCompletion(');
const end=app.indexOf('async function showLevel(',begin);
const main={id:'main',completion:{mode:'official-circuit',levelIds:['ch1_cmos_not','ch1_cmos_nand','ch1_half_adder','ch1_sr_latch']},steps:[]};
const binary={id:'binary-decoder',completion:{mode:'official-circuit',levelIds:['ch1_binary_decoder']},steps:[{id:'decode-four-combinations',condition:{type:'level-completed',levelId:'ch1_binary_decoder'}}]};
const chapter={id:'ch1',quests:{main,side:[binary]}};
const progress={tasks:{main:{status:'accepted',steps:{}},side:{'binary-decoder':{status:'accepted',steps:{'decode-four-combinations':{status:'current'}}}}},flags:{keep:true}};
const records=[{completed:true,assessmentType:'circuit_server',levelId:'ch1_binary_decoder'}];let writes=0;
let context;
context=vm.createContext({saved:new Map([['ch1',{state:structuredClone(progress)}]]),requireChapter:()=>chapter,changeQuestStatus,isWorkshopQuest,workshopProgressWithPass,questPrerequisitesSatisfied,sceneConfig,syncFlowOfficialPass,
 getAuthSnapshot:()=>({token:'test-session',generation:1}),isAuthSnapshotCurrent:()=>true,
 SessionChangedError:Error,copy:structuredClone,api:async()=>({results:records}),
 progressQueue:{mutateLatest:async(id,checkpoint,mutate)=>{
   const next=structuredClone(context.saved.get(id).state);
   if(mutate(next)){writes++;context.saved.set(id,{state:next});}
 }}});
vm.runInContext(app.slice(begin,end)+'\nglobalThis.sync=syncFirstCircuitQuestCompletion;',context);
await context.sync('ch1');
let state=context.saved.get('ch1').state;
assert.equal(state.tasks.main.status,'accepted');
assert.equal(state.tasks.side['binary-decoder'].status,'completed');
assert.equal(state.tasks.side['binary-decoder'].steps['decode-four-combinations'].status,'done');
assert.equal(state.flags.keep,true);
await context.sync('ch1');assert.equal(writes,1,'No repeated completion writes');
records.push({completed:true,assessmentType:'circuit_server',levelId:'ch1_cmos_not'});
await context.sync('ch1');assert.equal(context.saved.get('ch1').state.tasks.main.status,'completed');
const unfinished=structuredClone(progress);context.saved.set('ch1',{state:unfinished});writes=0;
records.splice(0,records.length,{completed:false,assessmentType:'circuit_server',levelId:'ch1_binary_decoder'},{completed:true,assessmentType:'chapter_demo',levelId:'ch1_binary_decoder'});
await context.sync('ch1');assert.equal(writes,0,'Partial/demo results are not completion proof');

// The existing title/modal interface must expose the lesson's real rules.
class IntroElement {
 constructor(tag){this.tagName=tag;this.handlers={};this.children=[];this.attributes={};this.textContent='';}
 append(...items){this.children.push(...items);}
 setAttribute(name,value){this.attributes[name]=value;}
 getAttribute(name){return this.attributes[name]||null;}
 addEventListener(name,fn){this.handlers[name]=fn;}
 showModal(){this.open=true;}
 close(){this.open=false;this.handlers.close?.();}
 remove(){dialog=null;}
 focus(){}
 matches(){return true;}
}
let dialog=null;let introHandler;
const root=new IntroElement('main');root.setAttribute('data-level-description',spec.description);
const introDocument={activeElement:null,querySelector:()=>dialog,createElement:tag=>new IntroElement(tag),getElementById:()=>null,
 body:{append:node=>{dialog=node;}},addEventListener:(name,fn)=>{introHandler=fn;}};
vm.runInNewContext(fs.readFileSync(new URL('../public/circuit-level-intro.js',import.meta.url),'utf8'),{document:introDocument,HTMLElement:IntroElement});
introHandler({target:root,detail:{title:spec.title}});
assert.equal(dialog.children[0].children.find(node=>node.className==='zshxj-level-intro__placeholder').textContent,spec.description);
dialog.close();root.setAttribute('data-level-description','');
introHandler({target:root,detail:{title:'原关卡'}});
assert.ok(dialog.children[0].children.find(node=>node.className==='zshxj-level-intro__placeholder').textContent.includes('占位'));
dialog.close();
console.log('Binary lesson UI PASS: six ports, save/version, real instructions via title modal, independent main/side completion, partial/demo rejection, lifecycle cleanup.');
