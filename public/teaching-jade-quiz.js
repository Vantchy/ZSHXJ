/** 第一章教学选择题：一题一页、四个无框选项，提交载荷继续经过原有服务端校验。 */
import {expectedSchoolAnswers} from './mengjin-school-board.js';
import {expectedTaosiAnswers} from './taosi-teaching-board.js';
import {expectedYanweiAnswers} from './yanwei-teaching-board.js';

const question = (text,options,correct) => {
  if (!Array.isArray(options) || options.length !== 4 ||
      !Number.isInteger(correct) || correct < 0 || correct > 3) {
    throw new Error('每道教学题须有四个选项和唯一的正确序号');
  }
  return {text,options,correct};
};
const names = values => values.map(value => String(value));
const arrow = edge => edge.replace('>','→');

/** Questions follow the exact conditions in the official JSON, not a detached answer key. */
export function buildTeachingJadeQuiz(boardId,rules) {
  const jade=rules.jade, diviner=rules.diviner;
  if(boardId===jade.id){
    const count=jade.villages.length*jade.offerings.length;
    const bits=Math.ceil(Math.log2(count));
    const codeIndex=Number.parseInt(jade.readCode,2);
    const decodedOffering=jade.offerings[codeIndex%jade.offerings.length];
    const codeValue=jade.villages.indexOf(jade.writeVillage)*jade.offerings.length+
      jade.offerings.indexOf(jade.writeOffering);
    const encoded=codeValue.toString(2).padStart(jade.bitCount,'0');
    const offerings=[...jade.offerings.filter(item=>item!==decodedOffering).slice(0,3),decodedOffering];
    const encodings=[codeValue+1,codeValue-1,codeValue+2].map(v=>
      Math.max(0,v).toString(2).padStart(jade.bitCount,'0'));
    return {title:jade.title,answers:{bits,decodedOffering,encoded},questions:[
      question(`九村五贡物，共 ${count} 种组合，最少需要几位阴阳刻纹？`,
        names([bits-1,bits,bits+1,bits+2]).map(v=>`${v} 位`),1),
      question(`左高位、阴为 0、阳为 1。玉纹 ${jade.readCode} 记载何种贡物？`,offerings,3),
      question(`${jade.writeVillage}贡${jade.writeOffering}，按村庄与贡物依次编号，应刻哪组玉纹？`,
        [encodings[0],encoded,encodings[1],encodings[2]],1),
    ]};
  }
  if(boardId===diviner.id){
    return {title:diviner.title,answers:{seen:[...diviner.patterns]},questions:[
      question('两片玉璜各有阴、阳两态，左右位置不同，共有几种排列？',
        ['2 种','3 种','4 种','8 种'],2),
      question('左璜先读，阴为 0、阳为 1。“阳阴”应记作什么？',
        ['00','01','10','11'],2),
      question('哪一组完整列出了两片玉璜的四象？',
        ['00、01、10、11','00、01、10、10','00、10、11、11','01、01、10、11'],0),
    ]};
  }
  const school=rules.school||{};
  if(boardId===school.truth?.id){
    const spec=school.truth,answers=expectedSchoolAnswers(boardId,school);
    return {title:spec.title,answers,questions:spec.inputs.map((bits,i)=>
      question(`三位输入 ABC = ${bits}，至少两位为 1 才输出 1，Y 应取何值？`,
        ['0','1','未定义','总为 1'],answers.outputs[i]))};
  }
  if(boardId===school.fault?.id){
    const spec=school.fault,answers=expectedSchoolAnswers(boardId,school);
    return {title:spec.title,answers,questions:[
      question('对照每行期望与实测输出，应先检查哪一组输入？',
        spec.inputs.map((bits,i)=>`${bits}：${spec.expected[i]} / ${spec.observed[i]}`),
        spec.inputs.indexOf(answers.faultInput)),
    ]};
  }
  if(boardId===school.delay?.id){
    const spec=school.delay,answers=expectedSchoolAnswers(boardId,school);
    return {title:spec.title,answers,questions:[
      question(`上路 ${spec.paths.upper} 片、下路 ${spec.paths.lower} 片，每片 ${spec.timePerPiece} 息。哪一路是关键路径？`,
        ['上路','下路','两路一样长','没有关键路径'],answers.criticalPath==='lower'?1:0),
      question('两路并行，整体完成需要等待多少息？',
        names([spec.paths.upper*spec.timePerPiece,answers.totalDelay,
          (spec.paths.upper+spec.paths.lower)*spec.timePerPiece,
          answers.totalDelay+spec.timePerPiece]).map(v=>`${v} 息`),1),
    ]};
  }
  if(boardId===school.regen?.id){
    const spec=school.regen;
    return {title:spec.title,answers:expectedSchoolAnswers(boardId,school),questions:[
      question('信号沿长链衰减到难以判断时，应如何处理？',
        ['继续照常传送','恢复清晰的两态信号','任意猜测当前状态','直接把弱信号视为 1'],1),
      question('没有衰减幅度与判定阈值，能确定最多串联几片吗？',
        ['可以，固定为三片','可以，固定为七片','不能，需具体参数','可以，无限串联'],2),
    ]};
  }
  const taosi=rules.taosi||{};
  if(boardId===taosi.representation?.id){
    const spec=taosi.representation,answers=expectedTaosiAnswers(boardId,taosi);
    const questions=[];
    for(const item of spec.items){
      questions.push(question(`${item.name}：${item.description}。这是表示还是运算？`,
        ['表示：原样呈现','运算：按规则改变','既不是表示也不是运算','输入不可能有输出'],
        item.expectedType==='representation'?0:1));
      questions.push(question(`${item.name}在本题约定中对应哪条输入输出关系？`,
        ['Y = X + 2','Y = X','Y = X + 1','Y 恒为 0'],
        item.expectedRelation==='copy'?1:2));
    }
    questions.push(question('哪个例子看似发生动作，实际上没有进行计算？',
      ['移动玉版，所记仍不变','将输入三变为四','把两路输入合为一路','按规则使输出翻转'],0));
    return {title:spec.title,answers,questions};
  }
  if(boardId===taosi.direction?.id){
    const spec=taosi.direction,answers=expectedTaosiAnswers(boardId,taosi);
    const questions=spec.edges.map(edge=>{
      const [from,to]=edge.split('>');
      return question(`输入由 A 逐级传向 D，${from} 与 ${to} 之间应如何定向？`,
        [`${from}→${to}`,`${to}→${from}`,`${from}↔${to}`,`${from} 与 ${to} 不连接`],0);
    });
    questions.push(question('从 A 经 B、C 到 D 的信号应按什么次序计算？',
      ['D→C→B→A','A→C→B→D','A→B→C→D','B→A→D→C'],2));
    questions.push(question('A→B→C→A 构成反馈环，未给时序与初态时应如何判断？',
      ['任意从一处开始拓扑排序','必然发生振荡','一定没有输出','不能直接进行普通拓扑排序'],3));
    return {title:spec.title,answers,questions};
  }
  if(boardId===taosi.oneway?.id){
    const spec=taosi.oneway,answers=expectedTaosiAnswers(boardId,taosi);
    return {title:spec.title,answers,questions:[
      question('定向玉从左端输入、右端输出时，正向信号应如何？',
        ['顺通','顺断','自动逆流','输出永远为 0'],0),
      question('若从右端尝试反向传递信号，定向玉应如何？',
        ['逆通','逆断','自动增强','反向强于正向'],1),
      question(`起始强度 ${spec.sourceStrength}，每级损失 ${spec.lossPerStage}，须不低于 ${spec.minimumReadable}，最多可传几级？`,
        [`${answers.maxStages-2} 级`,`${answers.maxStages+1} 级`,`${answers.maxStages} 级`,`${answers.maxStages+2} 级`],2),
      question('单向确定性传播付出的代价是什么？',
        ['没有任何代价','信号不再需要输入','每级都可无限分叉','失去逆向传递能力'],3),
    ]};
  }
  if(boardId===taosi.handoff?.id){
    const spec=taosi.handoff;
    return {title:spec.title,answers:expectedTaosiAnswers(boardId,taosi),questions:[
      question('老妇与丑在旧书案上找到的算稿是谁留下的？',
        ['亥当场绘制的制门图','子留下的算稿','老妇口述的杂记','商贩留下的账册'],1),
      question('为何子尚未把“门”真正制成器物？',
        ['忘记阴阳两态','玉料已经用尽','缺少汇合判断的实作结构','没有画任何图'],2),
      question('丑接下来应先制哪一门，作为“一门生六门”的起点？',
        ['异或门','或门','与门','与非门'],3),
    ]};
  }
  const yanwei=rules.yanwei||{};
  if(boardId===yanwei.backflow?.id){
    const spec=yanwei.backflow,answers=expectedYanweiAnswers(boardId,yanwei);
    return {title:spec.title,answers,questions:[
      question('A、B 为上游，C、D 为下游。哪两条逆向连线必须封堵？',
        [`${spec.reverseEdges.map(arrow).join('、')}`,`${spec.forwardEdges.slice(0,2).map(arrow).join('、')}`,
          `${arrow(spec.reverseEdges[0])}、${arrow(spec.forwardEdges[0])}`,
          `${arrow(spec.forwardEdges[1])}、${arrow(spec.forwardEdges[2])}`],0),
      question('封堵逆向通路后，哪种现象说明下游扰动测试通过？',
        ['扰动能返回上游','上游信号全部消失','C、D 扰动均不能抵达 A、B','让所有连接双向导通'],2),
      question('在这条有向信号网中，倒灌问题最准确的诊断是什么？',
        ['下游存在回到上游的路径','任意反馈环都必然振荡','所有信号必须反向传递','没有任何有向连接'],0),
    ]};
  }
  if(boardId===yanwei.cascade?.id){
    const spec=yanwei.cascade,answers=expectedYanweiAnswers(boardId,yanwei);
    return {title:spec.title,answers,questions:[
      question('按 A→B→C→D 逐级自动传递，初始 A 应设为什么？',
        ['A=0','B=1','A=1','D=1'],2),
      question(`每级延迟 ${spec.timePerStage} 息，A 置阳后 D 最迟何时稳定？`,
        [`${answers.stableTicks.at(-1)} 息`,`${spec.timePerStage} 息`,
          `${answers.stableTicks.at(-1)+spec.timePerStage} 息`,'无需等待'],0),
      question(`每级扇出上限为 ${spec.fanoutLimit} 路，允许同时驱动几路？`,
        [`${spec.fanoutLimit+2} 路`,`${spec.fanoutLimit} 路`,
          `${spec.fanoutLimit+1} 路`,'无限多路'],1),
      question('当前连接数未超过扇出上限，应如何判断？',
        ['必须停机','必然产生倒灌','已超过负载限制','本题模型中仍在限制内'],3),
    ]};
  }
  if(boardId===yanwei.merge?.id){
    const spec=yanwei.merge,answers=expectedYanweiAnswers(boardId,yanwei);
    return {title:spec.title,answers,questions:[
      question('仅允许复制 A、复制 B 或输出常量，哪个并非该模型的候选通路？',
        ['复制 A','复制 B','两路输入合并判断','恒为 1'],2),
      question('只有 A、B 同为 1 才输出 1，输入 00、01、10、11 的输出是？',
        ['0001','0111','0011','0101'],0),
      question('逐个试过复制 A、复制 B、恒 0、恒 1，能否单独实现目标？',
        ['复制 A 即可','恒 1 即可','复制 B 即可','都不行，须比较两路输入'],3),
      question('要实现两位均阳才输出阳，当前受限模型缺少什么结构？',
        ['只允许一个输入','把两路输入汇合判断','更多的常量输出','只改变输出颜色'],1),
    ]};
  }
  throw new Error('未知的教学题板：'+boardId);
}

/** Author-reviewed, versioned four-choice bank. The original teaching
 * questions remain available for legacy callers; gameplay uses this bank. */
export function buildReviewedJadeQuiz(boardId,bank){
  if(bank?.schemaVersion!==2 || !bank.boards?.[boardId]) {
    throw new Error('缺少审改题板：'+boardId);
  }
  const board=bank.boards[boardId],skin=bank.skins?.[board.skin];
  if(!skin || !Array.isArray(skin.writingRect) ||
     skin.writingRect.length!==4 || !board.questions?.length)
    throw new Error('题板素材或题目未准备完整：'+boardId);
  for(const item of board.questions) {
    if(!item.text || !Array.isArray(item.options) || item.options.length!==4 ||
       !Number.isInteger(item.correct) || item.correct<0 || item.correct>3)
      throw new Error('题目格式不正确：'+item?.id);
  }
  return {...board,skin};
}

function add(parent,tag,className,text){
  const el=document.createElement(tag);
  if(className)el.className=className;
  if(text!==undefined)el.textContent=text;
  parent.append(el);return el;
}

/** Same semantics for story progression/review: only presentation changes. */
export function mountTeachingJadeQuiz({host,boardId,rules,bank=null,onSolved,onClose,readonly=false}) {
  const quiz=bank ? buildReviewedJadeQuiz(boardId,bank) : buildTeachingJadeQuiz(boardId,rules);
  const modal=add(host,'section','mj-story-modal mj-jade-quiz');
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-label',quiz.title);
  const shade=add(modal,'div','mj-story-shade');
  const shell=add(modal,'div','mj-jade-quiz-shell');
  const skin=bank ? quiz.skin : null;
  if(skin) {
    modal.classList.add('mj-jade-quiz--reviewed');
    shell.classList.add(skin.material==='shell'?'is-shell':'is-jade');
    shell.dataset.skin=quiz.skin.imageUrl;
    shell.dataset.scene=quiz.sceneId;
    shell.style.setProperty('--jade-art',`url("${skin.imageUrl}")`);
    shell.style.setProperty('--jade-art-ratio',`${skin.width} / ${skin.height}`);
    const [x,y,w,h]=skin.writingRect;
    shell.style.setProperty('--jade-write-x',`${x*100}%`);
    shell.style.setProperty('--jade-write-y',`${y*100}%`);
    shell.style.setProperty('--jade-write-w',`${w*100}%`);
    shell.style.setProperty('--jade-write-h',`${h*100}%`);
  }
  const page=add(shell,'div','mj-jade-quiz-page');
  const content=add(page,'div','mj-jade-quiz-content');
  const stem=add(content,'p','mj-jade-quiz-question');
  const options=add(content,'div','mj-jade-quiz-options');
  options.setAttribute('role','group');options.setAttribute('aria-label','选择答案');
  const footer=add(content,'div','mj-jade-quiz-footer');
  const status=add(footer,'span','mj-jade-quiz-feedback');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const confirm=add(footer,'button','mj-jade-quiz-confirm','确定');
  confirm.type='button';
  let index=0,selected=-1,correct=false,busy=false,closed=false;
  const selectedAnswers=[]; // Each entry records a genuine correct choice.
  function placeArtifact() {
    if(!skin || closed)return;
    const [x,y,w,h]=skin.writingRect;
    const width=modal.clientWidth||window.innerWidth||1200;
    const height=modal.clientHeight||window.innerHeight||800;
    const maxInkWidth=Math.min(width-22,width<700?366:width<1100?480:570);
    const boardWidth=Math.max(1,Math.min(
      1320,(height-22)*(skin.width/skin.height),maxInkWidth/w
    ));
    shell.style.width=`${boardWidth.toFixed(2)}px`;
    shell.style.height=`${(boardWidth*skin.height/skin.width).toFixed(2)}px`;
    // Keep the entire carving visible vertically. Center the *writing face*
    // horizontally, since asymmetrical carved animals place it off-center.
    shell.style.transform=`translate(${(-100*(x+w/2)).toFixed(5)}%,-50%)`;
  }
  if(skin)placeArtifact();
  // Fit the entire question/options/footer block inside the solid jade area.
  // Size is measured against the actual local KaiTi font and recomputed for
  // each question and viewport, never letting long prompts spill into alpha.
  let fitFrame=0;
  let sizeObserver=null;
  function fitQuestion(){
    if(closed||!page.isConnected)return;
    const width=page.clientWidth;
    const height=page.clientHeight;
    if(!width||!height)return;
    const qBase=Math.min(26,Math.max(15,width*.065));
    const optionBase=Math.min(21,Math.max(12,width*.053));
    const feedbackBase=Math.min(19,Math.max(11,width*.047));
    const padding=Number.parseFloat(getComputedStyle(page).paddingTop)||0;
    const available=height-padding*2-1;
    // Recalculate from full size on each item: short questions stay large.
    for(let factor=1;factor>=.47;factor-=.045){
      page.style.setProperty('--jade-question-size',`${Math.max(10,qBase*factor).toFixed(2)}px`);
      page.style.setProperty('--jade-choice-size',`${Math.max(10,optionBase*factor).toFixed(2)}px`);
      page.style.setProperty('--jade-feedback-size',`${Math.max(10,feedbackBase*factor).toFixed(2)}px`);
      if(content.getBoundingClientRect().height <= available)break;
    }
  }
  const scheduleFit=()=>{
    cancelAnimationFrame(fitFrame);
    fitFrame=requestAnimationFrame(fitQuestion);
  };
  if(typeof ResizeObserver!=='undefined'){
    sizeObserver=new ResizeObserver(scheduleFit);
    sizeObserver.observe(page);
  }
  window.addEventListener('resize',scheduleFit);
  if(skin)window.addEventListener('resize',placeArtifact);
  const close=()=>{
    if(closed)return;
    closed=true;
    cancelAnimationFrame(fitFrame);
    sizeObserver?.disconnect();
    window.removeEventListener('resize',scheduleFit);
    if(skin)window.removeEventListener('resize',placeArtifact);
    document.removeEventListener('keydown',onKey);
    modal.remove();
  };
  const cancel=()=>{close();onClose?.();};
  function onKey(event){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}
  }
  document.addEventListener('keydown',onKey);
  shade.addEventListener('click',cancel);
  function render(){
    selected=-1;correct=false;busy=false;
    status.textContent='';status.className='mj-jade-quiz-feedback';
    confirm.textContent='确定';confirm.disabled=false;
    const entry=quiz.questions[index];
    stem.textContent=`${index+1}. ${entry.text}`;
    options.replaceChildren();
    entry.options.forEach((label,choiceIndex)=>{
      const item=add(options,'button','mj-jade-quiz-option',bank?`${'ABCD'[choiceIndex]}．${label}`:label);
      item.type='button';item.setAttribute('aria-pressed','false');
      item.addEventListener('click',()=>{
        if(correct||busy)return;
        selected=choiceIndex;status.textContent='';
        status.className='mj-jade-quiz-feedback';
        for(const sibling of options.children){
          const chosen=sibling===item;
          sibling.classList.toggle('is-selected',chosen);
          sibling.setAttribute('aria-pressed',String(chosen));
        }
      });
    });
    scheduleFit();
  }
  confirm.addEventListener('click',async()=>{
    if(closed||busy)return;
    if(!correct){
      if(selected<0)return;
      correct=selected===quiz.questions[index].correct;
      if(correct&&bank)selectedAnswers[index]=selected;
      status.textContent=correct?'√回答正确':'×回答错误';
      status.className='mj-jade-quiz-feedback '+(correct?'is-correct':'is-wrong');
      if(correct){confirm.textContent='继续';
        for(const item of options.children)item.disabled=true;}
      return;
    }
    if(index<quiz.questions.length-1){index++;render();return;}
    busy=true;confirm.disabled=true;
    try {
      const answers=bank
        ? {schemaVersion:2,boardId,choices:selectedAnswers.slice()} : quiz.answers;
      if(bank&&(selectedAnswers.length!==quiz.questions.length ||
                selectedAnswers.some(v=>!Number.isInteger(v))))
        throw new Error('题目尚未全部作答');
      await onSolved?.(answers);
      close();
    }
    catch(error){
      busy=false;confirm.disabled=false;
      status.textContent='×保存失败';status.className='mj-jade-quiz-feedback is-wrong';
      console.error('教学题板保存失败',error);
    }
  });
  render();
  return {close};
}
