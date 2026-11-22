/** 子时陶寺：三页算稿共用的教学板。前端核对仅用于反馈，完成证据仍需 Python 服务端校验。 */
function put(parent,tag,text=null,cls=''){
  const el=document.createElement(tag);
  if(text!==null)el.textContent=text;
  if(cls)el.className=cls;
  parent.append(el);return el;
}
function action(parent,text,callback,cls='mj-select-tile'){
  const btn=put(parent,'button',text,cls);btn.type='button';
  btn.addEventListener('click',callback);return btn;
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function expectedTaosiAnswers(id,rules){
  if(id===rules.representation?.id){const spec=rules.representation;
    return {categories:Object.fromEntries(spec.items.map(item=>[item.key,item.expectedType])),
      relations:Object.fromEntries(spec.items.map(item=>[item.key,item.expectedRelation])),
      counterexample:spec.counterexample};
  }
  if(id===rules.direction?.id){const spec=rules.direction;
    return {edges:[...spec.edges],order:spec.order,ringConclusion:spec.ringConclusion};}
  if(id===rules.oneway?.id){const spec=rules.oneway;
    return {forward:spec.forward,reverse:spec.reverse,
      maxStages:Math.floor((spec.sourceStrength-spec.minimumReadable)/spec.lossPerStage),
      tradeoff:spec.tradeoff};}
  if(id===rules.handoff?.id){const spec=rules.handoff;
    return {source:spec.source,obstacle:spec.obstacle,firstTask:spec.firstTask};}
  return null;
}
export function verifyTaosiAnswers(id,answers,rules){
  if(!answers||typeof answers!=='object'||Array.isArray(answers))return false;
  const expected=expectedTaosiAnswers(id,rules);if(!expected)return false;
  if(Object.keys(answers).length!==Object.keys(expected).length)return false;
  if(!Object.keys(answers).every(key=>Object.hasOwn(expected,key)))return false;
  if(id===rules.representation?.id){
    for(const k of ['categories','relations']){
      if(!answers[k]||typeof answers[k]!=='object'||Array.isArray(answers[k]))return false;
      if(Object.keys(answers[k]).length!==Object.keys(expected[k]).length)return false;
    }
  }
  if(id===rules.direction?.id&&(!Array.isArray(answers.edges)||answers.edges.length!==expected.edges.length))return false;
  if(id===rules.oneway?.id&&!Number.isInteger(answers.maxStages))return false;
  return same(answers,expected);
}
export function mountTaosiBoard({host,boardId,config,rules,onSolved,onClose,readonly=false}){
  const modal=put(host,'section',null,'mj-story-modal mj-board-modal mj-school-modal taosi-board-modal');
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-label',config.title);
  const shade=put(modal,'div',null,'mj-story-shade');
  const shell=put(modal,'div',null,'mj-story-shell');
  const header=put(shell,'header',null,'mj-story-header');
  put(header,'span','陶寺 · 器派旧学舍 · 子时算稿','mj-story-eyebrow');
  put(header,'h2',config.title);
  put(header,'p',config.binaryConvention,'mj-story-hint');
  const body=put(shell,'main',null,'mj-story-content');
  put(body,'p',config.note,'mj-school-note');
  const footer=put(shell,'footer',null,'mj-story-footer');
  const status=put(footer,'p','按照题面逐项操作，再提交。','mj-story-status');
  status.setAttribute('role','status');
  let submitting=false,closed=false,currentAnswer=null;
  const close=()=>{if(closed)return;closed=true;document.removeEventListener('keydown',onKey);modal.remove();};
  const cancel=()=>{close();onClose?.();};
  const onKey=(event)=>{if(event.key==='Escape'){event.preventDefault();cancel();}};
  document.addEventListener('keydown',onKey);
  shade.addEventListener('click',cancel);
  action(footer,readonly?'结束回顾':'稍后继续',cancel,'mj-story-quiet');
  async function submit(){
    if(submitting||closed)return;
    if(!verifyTaosiAnswers(boardId,currentAnswer,rules)){
      status.textContent='尚未全部正确。检查分类、方向、顺序与给定条件，然后再试。';return;
    }
    submitting=true;status.textContent=readonly?'本页已经回顾。':'答卷正确，返回子自述并记录算稿……';
    try{await onSolved?.(currentAnswer);close();}
    catch(err){submitting=false;status.textContent=err?.message||'未能记录，请重试。';}
  }
  const box=put(body,'div',null,'mj-school-exercise');
  const addToggle=(parent,choices,get,change)=>{
    const group=put(parent,'div',null,'mj-option-grid');
    const draw=()=>{group.replaceChildren();choices.forEach(([value,label])=>{
      action(group,label,()=>{change(value);draw();},'mj-select-tile'+(get()===value?' is-chosen':''));
    });};draw();return group;
  };
  if(boardId===rules.representation.id){
    const cats={}, rels={};let counterexample=null;
    const sync=()=>{currentAnswer={categories:{...cats},relations:{...rels},counterexample};};
    put(box,'h3','将器物分类，并为每种情况选一条关系式');
    for(const item of config.items){
      const row=put(box,'section',null,'taosi-board-item');
      put(row,'strong',item.name);put(row,'p',item.description);
      put(row,'p','① 属于表示，还是发生运算？');
      addToggle(row,[['representation','表示：照原样呈现'],['operation','运算：规则改变状态']],
        ()=>cats[item.key]??null,v=>{cats[item.key]=v;sync();});
      put(row,'p','② 选择相应关系式（X 为输入，Y 为输出）');
      addToggle(row,[['copy','Y = X'],['plus-one','Y = X + 1（本题算筹约定）']],
        ()=>rels[item.key]??null,v=>{rels[item.key]=v;sync();});
    }
    put(box,'h3','哪个例子看似有动作、实则没有进行计算？');
    addToggle(box,[['moving-tablet','把记数玉版搬到另一张案上，所记仍原样不变'],
      ['add-one','按规则让输入三的结果变成四']],()=>counterexample,v=>{counterexample=v;sync();});
    action(box,'完成第一页分类与关系式',submit,'mj-story-primary');
  }else if(boardId===rules.direction.id){
    put(box,'h3','先替玉网的三条连接定向');
    put(box,'p','每次点击箭头可反转方向；目标是让输入从 A 逐级传向 D。');
    const pairs=[['A','B'],['B','C'],['C','D']];
    const direction=[null,null,null];let order=null,ringConclusion=null;
    const sync=()=>{currentAnswer={edges:direction.map((v,i)=>v===null?null:
      v===0?`${pairs[i][0]}>${pairs[i][1]}`:`${pairs[i][1]}>${pairs[i][0]}`),order,ringConclusion};};
    const edges=put(box,'div',null,'mj-option-grid');
    const draw=()=>{edges.replaceChildren();pairs.forEach(([a,b],i)=>{
      const v=direction[i];const label=v===null?`${a} — ${b}（待定向）`:v===0?`${a} → ${b}`:`${b} → ${a}`;
      action(edges,label,()=>{direction[i]=v===null?0:1-v;sync();draw();},
        'mj-select-tile'+(v===0?' is-chosen':''));
    });};draw();
    put(box,'h3','应当按哪个次序计算？');
    addToggle(box,[['ABCD','A → B → C → D'],['DCBA','D → C → B → A'],['ACBD','A → C → B → D']],
      ()=>order,v=>{order=v;sync();});
    put(box,'h3','试着闭合 A → B → C → A 的回线，如何判断？');
    const ring=put(box,'div',null,'taosi-ring-note');
    let closedRing=false;
    action(ring,'闭合 / 断开回线',()=>{closedRing=!closedRing;
      ringText.textContent=closedRing?'现已闭合 A→B→C→A：没有无依赖的起点，需要额外模型或初始条件。':'回线已断开。';
    });
    const ringText=put(ring,'p','回线已断开。');
    addToggle(box,[['cycle-needs-rule','反馈环有依赖循环；未给定时序/初态，不能做普通拓扑排序'],
      ['always-oscillates','只要有环，任何条件下一定振荡']],
      ()=>ringConclusion,v=>{ringConclusion=v;sync();});
    action(box,'提交第二页定向玉网',()=>{
      if(!closedRing){status.textContent='请先动手闭合一次回线，再作判断。';return;}
      return submit();
    },'mj-story-primary');
  }else if(boardId===rules.oneway.id){
    const state={forward:null,reverse:null,maxStages:null,tradeoff:null};
    const sync=()=>{currentAnswer={...state};};
    put(box,'h3','定向玉的输入端和输出端');
    put(box,'p','设左端是输入，右端是输出。选一选：正向发送与逆向发送分别如何？');
    addToggle(box,[['pass','顺通：信号通过'],['block','顺断：信号不能通过']],
      ()=>state.forward,v=>{state.forward=v;sync();});
    put(box,'p','若把信号从右端送回左端呢？');
    addToggle(box,[['pass','逆通'],['block','逆断']],
      ()=>state.reverse,v=>{state.reverse=v;sync();});
    put(box,'h3','在本题给定的衰减模型下，最多可传几级？');
    put(box,'p',`初始强度 ${config.sourceStrength}，每级损失 ${config.lossPerStage}；强度不低于 ${config.minimumReadable} 才能辨认。`);
    addToggle(box,[[5,'5 级'],[7,'7 级'],[8,'8 级']],
      ()=>state.maxStages,v=>{state.maxStages=v;sync();});
    put(box,'h3','单向确定性付出的代价是什么？');
    addToggle(box,[['reverse-lost','切断反向通路，不再支持逆向传递'],['none','没有任何代价']],
      ()=>state.tradeoff,v=>{state.tradeoff=v;sync();});
    action(box,'提交第三页定向玉推演',submit,'mj-story-primary');
  }else if(boardId===rules.handoff.id){
    const state={source:null,obstacle:null,firstTask:null};
    const sync=()=>{currentAnswer={...state};};
    put(box,'h3','丑在旧书案前先理清：这册稿子是谁留下的？');
    put(box,'p','老妇交代子曾回到旧学舍，把数年来的推演供在先生牌位前。');
    addToggle(box,[['zi-notes','子留下的算稿与念头'],['hai-order','亥当场留下的现成制门图'],['old-woman-story','老妇凭记忆口述的零散见闻']],
      ()=>state.source,v=>{state.source=v;sync();});
    put(box,'h3','为什么子没有把“门”真正做出来？');
    put(box,'p','从算稿第六页往下看，关键缺口不在“会不会传”，而在“能否让两路共决一处”。');
    addToggle(box,[['needs-merge-and-craft','图纸已经指向“汇合判断”，但还缺把结构做成器物的双手'],['forgot-binary','因为子忘了两态和四象'],['no-material','只是因为一时没有足够玉料']],
      ()=>state.obstacle,v=>{state.obstacle=v;sync();});
    put(box,'h3','丑接下来该先从哪一步做起？');
    put(box,'p','此处先按正式主线的通用流程，只确认“先做哪一门”，不直接跳进后续全部关卡。');
    addToggle(box,[['nand-first','先从与非门入手，作为“一门生六门”的起点'],['xor-first','先做异或门，再回头补基础'],['all-at-once','七门一起并做，不分先后']],
      ()=>state.firstTask,v=>{state.firstTask=v;sync();});
    action(box,'确认书案结论',submit,'mj-story-primary');
  }else{close();throw new Error('不支持的陶寺教学板：'+boardId);}
  modal.querySelector('button')?.focus?.();
  return {close};
}
