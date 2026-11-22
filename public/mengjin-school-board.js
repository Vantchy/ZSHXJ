/** Additional teaching tasks at the official Mengjin school scene.
 *  These educational interactions have server-side verification in story_board_rules.py;
 *  do not spoof circuit attempts or bypass the ordered scene controller.
 */
function add(parent, tag, text = null, className = '') {
  const item = document.createElement(tag);
  if (text != null) item.textContent = text;
  if (className) item.className = className;
  parent.append(item);
  return item;
}
function click(parent, label, onClick, className = 'mj-select-tile') {
  const button = add(parent, 'button', label, className);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}
export function expectedSchoolAnswers(boardId, school) {
  if (boardId === school.truth.id) return {
    outputs: school.truth.inputs.map(bits => [...bits].filter(bit => bit === '1').length >= 2 ? 1 : 0),
  };
  if (boardId === school.fault.id) {
    const index = school.fault.expected.findIndex((expected, i) => expected !== school.fault.observed[i]);
    return {faultInput: school.fault.inputs[index]};
  }
  if (boardId === school.delay.id) {
    const paths = school.delay.paths;
    const criticalPath = Object.keys(paths).reduce((best, name) => paths[name] > paths[best] ? name : best);
    return {criticalPath, totalDelay: paths[criticalPath] * school.delay.timePerPiece};
  }
  if (boardId === school.regen.id) return {action:'regenerate', numericLimit:'unknown'};
  return null;
}
export function verifySchoolAnswers(boardId, answers, school) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return false;
  const expected = expectedSchoolAnswers(boardId, school);
  if (!expected || Object.keys(answers).length !== Object.keys(expected).length) return false;
  if (boardId === school.truth.id) return Object.keys(answers)[0] === 'outputs' &&
    Array.isArray(answers.outputs) && answers.outputs.length === expected.outputs.length &&
    answers.outputs.every((value, i) => Number.isInteger(value) && value === expected.outputs[i]);
  return Object.keys(expected).every(key => Object.hasOwn(answers, key) && answers[key] === expected[key]) &&
    Object.keys(answers).every(key => Object.hasOwn(expected, key));
}

export function mountSchoolBoard({host, boardId, config, rules, onSolved, onClose, readonly = false}) {
  const modal = add(host,'section',null,'mj-story-modal mj-board-modal mj-school-modal');
  modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-label',config.title);
  const shade = add(modal,'div',null,'mj-story-shade');
  const shell = add(modal,'div',null,'mj-story-shell');
  const header = add(shell,'header',null,'mj-story-header');
  add(header,'span','孟津 · 营地学舍 · 授业','mj-story-eyebrow');
  add(header,'h2',config.title);
  add(header,'p',config.binaryConvention,'mj-story-hint');
  const content = add(shell,'main',null,'mj-story-content mj-school-content');
  const note = add(content,'p',config.note,'mj-school-note');
  const footer = add(shell,'footer',null,'mj-story-footer');
  const status = add(footer,'p','选择答案后提交。','mj-story-status');
  status.setAttribute('role','status');
  let busy = false, closed = false;
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); onClose?.(); } };
  const close = () => {
    if (closed) return;
    closed = true; document.removeEventListener('keydown',onKey); modal.remove();
  };
  document.addEventListener('keydown',onKey);
  shade.addEventListener('click',()=>{close();onClose?.();});
  click(footer, readonly?'结束回顾':'稍后继续',()=>{close();onClose?.();},'mj-story-quiet');
  let currentAnswer = null;
  async function submit() {
    if (busy || closed) return;
    if (!verifySchoolAnswers(boardId, currentAnswer, rules)) {
      status.textContent='答案尚未正确，请核对题面和每一项后重试。';
      return;
    }
    busy = true;
    status.textContent=readonly?'本幕知识已经回顾。':'答卷正确，正在返回课堂对白……';
    try {
      await onSolved?.(currentAnswer);
      close();
    } catch (error) {
      busy=false; status.textContent=error?.message||'未能保存，请稍后重试。';
    }
  }
  const answerBox = add(content,'div',null,'mj-school-exercise');
  if (boardId === rules.truth.id) {
    add(answerBox,'h3','将三位输入的八种组合逐行写入真值表');
    const values = Array(config.inputs.length).fill(null);
    const grid = add(answerBox,'div',null,'mj-school-rows');
    const headings = add(grid,'div',null,'mj-school-row mj-school-head');
    add(headings,'strong','A B C'); add(headings,'strong','Y（请填 0 或 1）');
    function renderTable() {
      grid.replaceChildren(headings);
      config.inputs.forEach((bits,i)=>{
        const row=add(grid,'div',null,'mj-school-row');
        add(row,'span',bits.split('').join('  '),'mj-code-display');
        const buttons=add(row,'div',null,'mj-school-choices');
        [0,1].forEach(choice=>click(buttons,`输出 ${choice}`,()=>{
          values[i]=choice; currentAnswer={outputs:[...values]}; renderTable();
          status.textContent=`已填写 ${values.filter(v=>v!==null).length} / 8 行。`;
        },'mj-select-tile'+(values[i]===choice?' is-chosen':'')));
      });
    }
    renderTable();
    click(answerBox,'核对八行真值表',submit,'mj-story-primary');
  } else if (boardId === rules.fault.id) {
    add(answerBox,'h3','对照期望值和实测值，找出最应先检查的一行');
    const grid=add(answerBox,'div',null,'mj-school-rows');
    const headings=add(grid,'div',null,'mj-school-row mj-school-head');
    add(headings,'strong','A B'); add(headings,'strong','期望 Y / 实测 Y');
    config.inputs.forEach((input,i)=>{
      const row=add(grid,'div',null,'mj-school-row');
      add(row,'span',input,'mj-code-display');
      const cell=add(row,'div',null,'mj-school-choices');
      click(cell,`${config.expected[i]} / ${config.observed[i]} · ${currentAnswer?.faultInput===input?'已选':'选择'}`,()=>{
        currentAnswer={faultInput:input};
        [...grid.querySelectorAll('.mj-school-choices button')].forEach((btn,j)=>{
          btn.classList.toggle('is-chosen',config.inputs[j]===input);
          btn.textContent=`${config.expected[j]} / ${config.observed[j]} · ${config.inputs[j]===input?'已选':'选择'}`;
        });
      },'mj-select-tile');
    });
    click(answerBox,'提交异常行',submit,'mj-story-primary');
  } else if (boardId === rules.delay.id) {
    add(answerBox,'h3','两路同时出发，整体何时才算传递完成？');
    const info=add(answerBox,'div',null,'mj-school-paths');
    add(info,'p',`上路：${config.paths.upper} 片玉，每片 ${config.timePerPiece} 息`,'mj-school-path');
    add(info,'p',`下路：${config.paths.lower} 片玉，每片 ${config.timePerPiece} 息`,'mj-school-path');
    let path=null, delay=null;
    const pathBtns=add(answerBox,'div',null,'mj-option-grid');
    [ ['upper','上路'],['lower','下路'] ].forEach(([key,label])=>click(pathBtns,label,()=>{
      path=key; pathBtns.querySelectorAll('button').forEach(b=>b.classList.toggle('is-chosen',b.textContent===label));
      currentAnswer={criticalPath:path,totalDelay:delay};
    }));
    add(answerBox,'p','请选择关键路径，再选择最长等待时间。');
    const timeBtns=add(answerBox,'div',null,'mj-option-grid');
    [3,7,10].forEach(value=>click(timeBtns,`${value} 息`,()=>{
      delay=value; timeBtns.querySelectorAll('button').forEach(b=>b.classList.toggle('is-chosen',b.textContent===`${value} 息`));
      currentAnswer={criticalPath:path,totalDelay:delay};
    }));
    click(answerBox,'核对关键路径',submit,'mj-story-primary');
  } else if (boardId === rules.regen.id) {
    add(answerBox,'h3','观察信号沿长链传递时的变化');
    const chain=add(answerBox,'div',null,'mj-school-signal');
    config.exampleStages.forEach((label,i)=>add(chain,'span',`${i+1}. ${label}`,'mj-school-signal-stage'));
    let action=null, count=null;
    add(answerBox,'p','信号到达难以判定区间，接下来应如何处理？');
    const decisions=add(answerBox,'div',null,'mj-option-grid');
    [['ignore','仍按原状传下去'],['regenerate','在合适位置重新恢复两态']].forEach(([key,label])=>click(decisions,label,()=>{
      action=key; decisions.querySelectorAll('button').forEach(b=>b.classList.toggle('is-chosen',b.textContent===label));
      currentAnswer={action,numericLimit:count};
    }));
    add(answerBox,'p','若没有衰减幅度和阈值参数，能否算出“最多可以串联几片”？');
    const counts=add(answerBox,'div',null,'mj-option-grid');
    [['known','可以直接给出固定数字'],['unknown','不能，需要具体参数']].forEach(([key,label])=>click(counts,label,()=>{
      count=key; counts.querySelectorAll('button').forEach(b=>b.classList.toggle('is-chosen',b.textContent===label));
      currentAnswer={action,numericLimit:count};
    }));
    click(answerBox,'完成信号观察',submit,'mj-story-primary');
  } else {close();throw new Error('未知的学舍题板：'+boardId);}
  const first=modal.querySelector('button:not([disabled])');first?.focus?.();
  return {close};
}
