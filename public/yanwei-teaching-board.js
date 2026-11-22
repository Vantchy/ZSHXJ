/** 子时嫣沩 · 三页算稿共用的玉网实验台。
 * 只负责绘制和本地即时提示；任务证据由既有 chapter PUT + Python 规则独立校验。
 * 本题的依赖图、逐级延迟和汇合候选都是明确标注的教学模型。
 */
const element=(parent,tag,text,cls='')=>{
  const node=document.createElement(tag);
  if(text!=null)node.textContent=text;
  if(cls)node.className=cls;
  parent.append(node);return node;
};
const press=(parent,label,callback,cls='mj-select-tile')=>{
  const b=element(parent,'button',label,cls);b.type='button';b.addEventListener('click',callback);return b;
};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function graphHasBackflow(spec,blocked){
  const graph=new Map();
  for(const edge of [...spec.forwardEdges,...spec.reverseEdges.filter(e=>!blocked.includes(e))]){
    const [from,to]=edge.split('>');
    if(!graph.has(from))graph.set(from,[]);
    graph.get(from).push(to);
  }
  for(const origin of spec.disturbanceSources){
    const todo=[origin],visited=new Set();
    while(todo.length){
      const at=todo.pop();if(visited.has(at))continue;visited.add(at);
      if(spec.protectedNodes.includes(at))return true;
      for(const next of graph.get(at)||[])todo.push(next);
    }
  }
  return false;
}
function expectedTable(spec,candidate){
  return spec.inputs.map(bits=>{
    if(candidate==='pass-a')return Number(bits[0]);
    if(candidate==='pass-b')return Number(bits[1]);
    return candidate==='const-1'?1:0;
  });
}
export function expectedYanweiAnswers(id,rules){
  if(id===rules.backflow?.id)return {
    blocked:[...rules.backflow.reverseEdges],
    diagnosis:rules.backflow.diagnosis,
    perturbationPassed:true,
  };
  if(id===rules.cascade?.id)return {
    start:'A=1',
    stableTicks:rules.cascade.chain.slice(1).map((_,i)=>(i+1)*rules.cascade.timePerStage),
    fanoutLoads:rules.cascade.fanoutLimit,
    fanoutConclusion:'within-limit',
  };
  if(id===rules.merge?.id)return {
    tried:[...rules.merge.candidates],
    targetOutputs:[...rules.merge.targetOutputs],
    missingStructure:rules.merge.missingStructure,
  };
  return null;
}
export function verifyYanweiAnswers(id,answers,rules){
  if(!answers||typeof answers!=='object'||Array.isArray(answers))return false;
  const expected=expectedYanweiAnswers(id,rules);
  if(!expected||Object.keys(answers).length!==Object.keys(expected).length||
      !Object.keys(answers).every(k=>Object.hasOwn(expected,k)))return false;
  if(id===rules.backflow?.id){
    return Array.isArray(answers.blocked)&&answers.blocked.length===expected.blocked.length&&
      answers.blocked.every(e=>expected.blocked.includes(e))&&
      answers.diagnosis===expected.diagnosis&&answers.perturbationPassed===true&&
      !graphHasBackflow(rules.backflow,answers.blocked);
  }
  if(id===rules.cascade?.id){
    return answers.start==='A=1'&&Array.isArray(answers.stableTicks)&&
      same(answers.stableTicks,expected.stableTicks)&&
      Number.isInteger(answers.fanoutLoads)&&answers.fanoutLoads===expected.fanoutLoads&&
      answers.fanoutConclusion===expected.fanoutConclusion;
  }
  if(id===rules.merge?.id){
    return Array.isArray(answers.tried)&&answers.tried.length===expected.tried.length&&
      expected.tried.every(item=>answers.tried.includes(item))&&
      same(answers.targetOutputs,expected.targetOutputs)&&
      answers.missingStructure===expected.missingStructure;
  }
  return false;
}
function loadCss(){
  if(document.querySelector('link[data-yanwei-board]'))return;
  const link=document.createElement('link');link.rel='stylesheet';
  link.href='/yanwei-scene.css?v=1';link.dataset.yanweiBoard='true';
  document.head.append(link);
}
export function mountYanweiBoard({host,boardId,config,rules,onSolved,onClose,readonly=false}){
  loadCss();
  const modal=element(host,'section',null,'mj-story-modal mj-board-modal mj-school-modal yw-board-modal');
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-label',config.title);
  const shade=element(modal,'div',null,'mj-story-shade');
  const shell=element(modal,'div',null,'mj-story-shell');
  const header=element(shell,'header',null,'mj-story-header');
  element(header,'span','嫣沩 · 玉网工坊 · 子时算稿','mj-story-eyebrow');
  element(header,'h2',config.title);
  element(header,'p',config.binaryConvention,'mj-story-hint');
  const body=element(shell,'main',null,'mj-story-content');
  element(body,'p',config.note,'mj-school-note');
  const exercise=element(body,'div',null,'mj-school-exercise yw-exercise');
  const footer=element(shell,'footer',null,'mj-story-footer');
  const status=element(footer,'p','按步骤操作，完成后提交本页结果。','mj-story-status');
  status.setAttribute('role','status');
  let closed=false,submitting=false;
  let currentAnswer=null;
  const onKey=e=>{if(e.key==='Escape'){e.preventDefault();cancel();}};
  const close=()=>{if(closed)return;closed=true;document.removeEventListener('keydown',onKey);modal.remove();};
  const cancel=()=>{close();onClose?.();};
  document.addEventListener('keydown',onKey);
  shade.addEventListener('click',cancel);
  press(footer,readonly?'结束回顾':'稍后继续',cancel,'mj-story-quiet');
  async function submit(){
    if(closed||submitting)return;
    if(!verifyYanweiAnswers(boardId,currentAnswer,rules)){
      status.textContent='尚未完成全部必要操作。请对照本关的实验条件，逐项验证。';return;
    }
    submitting=true;status.textContent=readonly?'已完成本页回顾。':'验证通过，准备记录正式任务步骤……';
    try{await onSolved?.(currentAnswer);close();}
    catch(err){submitting=false;status.textContent=err?.message||'存档失败，请再试一次。';}
  }
  const heading=(title,text)=>{
    const pane=element(exercise,'section',null,'yw-pane');
    element(pane,'h3',title);
    if(text)element(pane,'p',text);
    return pane;
  };
  function choice(parent,items,onChange){
    const area=element(parent,'div',null,'mj-option-grid');
    const options=new Map();
    for(const [value,label] of items){
      const b=press(area,label,()=>{onChange(value);for(const [v,btn] of options)btn.classList.toggle('is-chosen',v===value);});
      options.set(value,b);
    }
    return area;
  }
  if(boardId===rules.backflow.id){
    const spec=rules.backflow;
    const observe=heading('第一步 · 看清上游与下游',
      'A、B 是上游，C、D 是下游；逆向连线会使下游扰动返回上游。');
    const diagram=element(observe,'div',null,'yw-network');
    for(const edge of spec.forwardEdges)element(diagram,'span',edge.replace('>',' → '),'yw-forward');
    const diagnose=heading('第二步 · 诊断全部倒灌点',
      '试着封堵所有逆向边。按钮点亮表示这条边已被隔离。');
    const blocked=new Set();const tried=new Set();let diagnosis=null,tested=false;
    const edgePanel=element(diagnose,'div',null,'mj-option-grid');
    for(const edge of spec.reverseEdges){
      const btn=press(edgePanel,`逆向路径 ${edge.replace('>',' → ')} · 尚未封堵`,()=>{
        if(blocked.has(edge))blocked.delete(edge);else blocked.add(edge);
        btn.textContent=`逆向路径 ${edge.replace('>',' → ')} · ${blocked.has(edge)?'已封堵':'尚未封堵'}`;
        btn.classList.toggle('is-chosen',blocked.has(edge));tested=false;
        status.textContent='线路已改变，请重新进行下游扰动试验。';
      });
    }
    const diag=heading('第三步 · 给出故障原因','找出“为何上游会被下游改写”。');
    choice(diag,[['reverse-backflow','下游可经逆向边返回上游，形成倒灌'],
                 ['normal-cascade','单向级联必然反向影响上游']],v=>{diagnosis=v;});
    const test=heading('第四步 · 扰动验证',
      '从 C、D 两处分别模拟下游扰动。如果均不能到达 A、B，隔离才算完成。');
    const msg=element(test,'p','尚未运行扰动试验。','yw-result');
    press(test,'对 C、D 分别进行扰动测试',()=>{
      tested=!graphHasBackflow(spec,[...blocked]);
      msg.textContent=tested?'测试通过：下游扰动无法沿剩余通路返回上游 A、B。':
        '仍能倒灌：请检查所有逆向连线是否已经封堵。';
      status.textContent=tested?'隔离效果已确认，可以提交本关。':'扰动试验失败，请调整玉网。';
    },'mj-story-primary');
    press(exercise,'提交倒灌诊断与隔离结果',()=>{
      currentAnswer={blocked:spec.reverseEdges.filter(edge=>blocked.has(edge)),
        diagnosis,perturbationPassed:tested};return submit();
    },'mj-story-primary');
  }else if(boardId===rules.cascade.id){
    const spec=rules.cascade;
    let initiated=false,tick=0,fanoutLoads=null,fanoutConclusion=null;
    const seen=[];
    const network=heading('第一步 · 从首级启动','先把 A 置阳，然后每次推进一息，观察 B、C、D 按次序稳定。');
    const labels=element(network,'div',null,'yw-timeline');
    const display=element(network,'p','','yw-result');
    function paint(){
      labels.replaceChildren();
      spec.chain.forEach((name,index)=>element(labels,'span',
        `${name} · ${initiated&&index<=tick?'阳 1':'未稳定'}`,
        'yw-stage'+(initiated&&index<=tick?' is-live':'')));
      display.textContent=initiated?`已推进 ${tick} 息；记录的稳定时刻：${seen.join('、')||'暂无'}`:'尚未拨动首级 A。';
    }
    paint();
    press(network,'将 A 置为阳 1',()=>{initiated=true;tick=0;seen.length=0;paint();},'mj-select-tile');
    press(network,'继续传播一息',()=>{
      if(!initiated){status.textContent='请先拨动首级 A。';return;}
      if(tick<spec.chain.length-1){tick++;seen.push(tick*spec.timePerStage);}paint();
    },'mj-story-primary');
    const fan=heading('第二步 · 分析扇出限值',
      `本次实验约定：一级最多可靠驱动 ${spec.fanoutLimit} 路。请选择不超过上限且尽可能多的负载数。`);
    choice(fan,[[1,'仅驱动 1 路'],[2,'驱动 2 路'],[3,'驱动 3 路']],v=>{fanoutLoads=v;});
    choice(fan,[['within-limit','两路在本题约定的上限内，可可靠传递'],
                ['no-limit','通路越多越好，不存在负载限制']],v=>{fanoutConclusion=v;});
    press(exercise,'提交传播次序与扇出分析',()=>{
      currentAnswer={start:initiated?'A=1':null,stableTicks:[...seen],
        fanoutLoads,fanoutConclusion};return submit();
    },'mj-story-primary');
  }else if(boardId===rules.merge.id){
    const spec=rules.merge;
    const tried=new Set();let missingStructure=null;
    const target=[null,null,null,null];
    const model=heading('第一步 · 尝试受限的单向接法',
      '逐一试验：只转送 A、只转送 B、固定阴 0、固定阳 1。每种接法只使用一条输入通路。');
    const display=element(model,'div',null,'yw-truth-table');
    const names={'pass-a':'传导 A','pass-b':'传导 B','const-0':'恒为阴 0','const-1':'恒为阳 1'};
    const count=element(model,'p','已试 0 / 4 种接法','yw-result');
    const choices=element(model,'div',null,'mj-option-grid');
    function drawTable(candidate){
      display.replaceChildren();
      element(display,'strong','输入 A B');element(display,'strong','当前输出 Y');
      const outputs=expectedTable(spec,candidate);
      spec.inputs.forEach((bits,i)=>{
        element(display,'span',bits);element(display,'span',String(outputs[i]));
      });
    }
    for(const id of spec.candidates){
      press(choices,names[id],()=>{tried.add(id);drawTable(id);
        count.textContent=`已试 ${tried.size} / ${spec.candidates.length} 种接法。`;
      },'mj-select-tile');
    }
    const targetPane=heading('第二步 · 写出目标“二者同时满足才放行”',
      '点击每一行输出切换阴 / 阳，写出期望的四行真值表。');
    const table=element(targetPane,'div',null,'yw-truth-table');
    element(table,'strong','输入 A B');element(table,'strong','目标 Y');
    spec.inputs.forEach((bits,i)=>{
      element(table,'span',bits);
      const output=press(table,'未指定',()=>{target[i]=target[i]===null?0:1-target[i];
        output.textContent=target[i]===0?'阴 0':'阳 1';},'yw-toggle');
    });
    const conclusion=heading('第三步 · 推断缺失的结构',
      '为什么刚才的四种单输入接法均无法实现目标真值表？');
    choice(conclusion,[['merge-two','需要两路输入共同参与决定输出的汇合结构'],
                       ['copy-more','仅多加几根不相交的单输入通路就足够']],v=>{missingStructure=v;});
    press(exercise,'提交穷举结果并写算稿',()=>{
      currentAnswer={tried:spec.candidates.filter(id=>tried.has(id)),
        targetOutputs:[...target],missingStructure};return submit();
    },'mj-story-primary');
  }else{close();throw new Error('不支持的嫣沩教学板：'+boardId);}
  modal.querySelector('button')?.focus?.();
  return {close};
}
