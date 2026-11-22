/** Shared teaching-board UI. The server separately checks the submitted answers. */
import {mountSchoolBoard, verifySchoolAnswers} from './mengjin-school-board.js';
import {mountTaosiBoard, verifyTaosiAnswers} from './taosi-teaching-board.js';
const RESOURCE = '/scene-activities/mengjin-teaching-boards.json';
// Scene-specific floor coordinates. The generic room task/navigation engine
// still owns player movement, dialogue and quest lifecycle.
const STATIONS = Object.freeze({
  'mengjin-jade-courtyard': 226,
  'mengjin-diviner-residence': 302,
  'mengjin-school-courtyard': 315,
  'taosi-old-academy': 446,
});
export const boardStationForLocation = id => STATIONS[id] ?? null;
function element(tag, text, parent, className = '') {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}
function button(text, parent, act, className = '') {
  const item = element('button', text, parent, className);
  item.type = 'button'; item.addEventListener('click', act); return item;
}
export function expectedJadeAnswers(spec) {
  const index = Number.parseInt(spec.readCode, 2);
  const offered = spec.offerings[index % spec.offerings.length];
  const write = spec.villages.indexOf(spec.writeVillage) * spec.offerings.length +
    spec.offerings.indexOf(spec.writeOffering);
  return {bits: Math.ceil(Math.log2(spec.villages.length * spec.offerings.length)),
          decodedOffering: offered, encoded: write.toString(2).padStart(6, '0')};
}
export function verifyTeachingAnswers(boardId, answers, rules) {
  if (boardId === rules.jade.id) {
    const expected = expectedJadeAnswers(rules.jade);
    return answers.bits === expected.bits && answers.decodedOffering === expected.decodedOffering &&
      answers.encoded === expected.encoded;
  }
  if (boardId === rules.diviner.id) {
    const wanted = rules.diviner.patterns;
    return Array.isArray(answers.seen) && answers.seen.length === wanted.length &&
      wanted.every(value => answers.seen.includes(value));
  }
  if (rules.school && Object.values(rules.school).some(spec=>spec.id===boardId))
    return verifySchoolAnswers(boardId, answers, rules.school);
  if (rules.taosi && Object.values(rules.taosi).some(spec=>spec.id===boardId))
    return verifyTaosiAnswers(boardId,answers,rules.taosi);
  return false;
}
export function ensureMengjinStylesheet() {
  if (document.querySelector('link[data-mengjin-board]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet';
  link.href = '/mengjin-story.css?v=4'; link.dataset.mengjinBoard = 'true';
  document.head.append(link);
}
/** Returns a close() handle. Every completion still requires a normal chapter PUT. */
export async function mountMengjinBoard({host, boardId, onSolved, onClose, readonly = false}) {
  ensureMengjinStylesheet();
  const response = await fetch(RESOURCE, {cache:'no-store'});
  if (!response.ok) throw new Error('教学题板配置加载失败，请检查项目文件。');
  const rules = await response.json();
  const taosiConfig = rules.taosi && Object.values(rules.taosi).find(spec=>spec.id===boardId);
  if (taosiConfig) return mountTaosiBoard({host,boardId,config:taosiConfig,
    rules:rules.taosi,onSolved,onClose,readonly});
  const schoolConfig = rules.school && Object.values(rules.school).find(spec=>spec.id===boardId);
  if (schoolConfig) return mountSchoolBoard({host,boardId,config:schoolConfig,rules:rules.school,
    onSolved,onClose,readonly});
  const diviner = boardId === rules.diviner.id;
  if (!diviner && boardId !== rules.jade.id) throw new Error('未知的教学题板：' + boardId);
  const config = diviner ? rules.diviner : rules.jade;
  const modal = element('section', null, host, 'mj-story-modal mj-board-modal');
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', config.title);
  const shade = element('div', null, modal, 'mj-story-shade');
  const shell = element('div', null, modal, 'mj-story-shell');
  const head = element('header', null, shell, 'mj-story-header');
  element('span', diviner ? '孟津 · 贞人居所' : '孟津 · 玉匠铺', head, 'mj-story-eyebrow');
  element('h2', config.title, head);
  element('p', config.binaryConvention, head, 'mj-story-hint');
  const content = element('main', null, shell, 'mj-story-content');
  const footer = element('footer', null, shell, 'mj-story-footer');
  const status = element('p', '', footer, 'mj-story-status'); status.setAttribute('role', 'status');
  const close = () => { modal.remove(); };
  button(readonly ? '结束回顾' : '稍后继续', footer, () => {close(); onClose?.();}, 'mj-story-quiet');
  shade.addEventListener('click', () => {close(); onClose?.();});
  let submitting = false;
  async function complete(answers) {
    if (submitting) return;
    if (!verifyTeachingAnswers(boardId, answers, rules)) {
      status.textContent = '尚未完成当前题板，请检查后重试。'; return;
    }
    submitting = true;
    status.textContent = readonly ? '四象与玉纹已回顾。' : '答卷正确，正在返回剧情……';
    try { await onSolved?.(answers); close(); }
    catch (error) {submitting = false; status.textContent = error?.message || '保存失败，请重试。';}
  }
  if (diviner) {
    const seen = new Set(), marks=[0,0];
    element('p', '试着切换左右两片玉璜，分别摆出四种不同的顺序。左右位置不同，意义也不同。', content);
    const bits = element('div', null, content, 'mj-two-bits');
    function redraw() {
      bits.replaceChildren();
      marks.forEach((value, index) => button(`${index === 0?'左璜':'右璜'}：${value?'阳 1':'阴 0'}`, bits, () => {
        marks[index] ^= 1; redraw();
      }, 'mj-binary-tile'));
    }
    redraw();
    const seenDisplay = element('p', '已观察：0 / 4', content, 'mj-story-progress');
    button('记录当前排列', content, () => {
      seen.add(marks.join(''));
      seenDisplay.textContent = `已观察：${seen.size} / 4（${[...seen].map(v => v.split('').map(x=>x==='1'?'阳':'阴').join('')).join('、')}）`;
      status.textContent = seen.size < 4 ? '继续切换，直到四种排列都看过。' : '四象已经完整，请确认本场观察。';
    }, 'mj-story-primary');
    button('完成四象观察', content, () => complete({seen:[...seen]}), 'mj-story-primary');
  } else {
    const spec=rules.jade, answer=expectedJadeAnswers(spec);
    let phase=0, selected=0, decoded='', marks=[0,0,0,0,0,0];
    const note = element('p', '', content, 'mj-story-progress');
    const question = element('div', null, content, 'mj-story-question');
    function render() {
      note.textContent=`第 ${phase+1} / 3 步 · ${['选定最少位数','查表解码玉版','反向刻制玉版'][phase]}`;
      question.replaceChildren(); status.textContent='';
      if (phase===0) {
        element('h3', '九个村、五种贡物，共 45 种组合，最少需要几位阴阳刻纹？', question);
        const options=element('div',null,question,'mj-option-grid');
        [5,6,7].forEach(n=>button(`${n} 位`,options,()=>{selected=n;render();},'mj-select-tile'+(selected===n?' is-chosen':'')));
        button('核对位数',question,()=>{ if(selected!==answer.bits) status.textContent='五位不足、七位不是最少；请重新计算。'; else {phase=1;render();}},'mj-story-primary');
      } else if(phase===1) {
        element('h3', '玉匠垂给出一片六位玉版，请根据编码表读出贡物。',question);
        element('p', `玉版刻纹：${spec.readCode}（阴=0、阳=1；左高位）`,question,'mj-code-display');
        element('p','本场约定按村庄次序依次排入五种贡物，编号从零开始。',question);
        const table=element('div',null,question,'mj-code-table');
        spec.villages.forEach((v,i)=>{
          const row=element('div',null,table,'mj-code-row');
          element('strong',v,row);
          spec.offerings.forEach((good,j)=>element('span',`${(i*5+j).toString(2).padStart(6,'0')} ${good}`,row));
        });
        const select=element('select',null,question,'mj-story-select');
        element('option','请选择玉版所记贡物',select).value='';
        spec.offerings.forEach(item=>element('option',item,select).value=item);
        select.value=decoded; select.addEventListener('change',()=>decoded=select.value);
        button('核对解码',question,()=>{if(decoded!==answer.decodedOffering) status.textContent='请按六位编号，在表中找到对应贡物。'; else {phase=2;render();}},'mj-story-primary');
      } else {
        element('h3',`请刻出“${spec.writeVillage}贡${spec.writeOffering}”的六位玉纹。`,question);
        const grid=element('div',null,question,'mj-six-bits');
        marks.forEach((bit,index)=>button(`${bit?'阳':'阴'} ${bit}`,grid,()=>{marks[index]^=1;render();},'mj-binary-tile'));
        element('p','当前玉版：'+marks.join(''),question,'mj-code-display');
        button('提交玉版',question,()=>{
          if(marks.join('')!==answer.encoded) {status.textContent='这片玉版与编码表不符，可按编号重新刻制。';return;}
          complete({bits:selected,decodedOffering:decoded,encoded:marks.join('')});
        },'mj-story-primary');
      }
    }
    render();
  }
  return {close};
}
