/** Read-only scene index. Never advances a quest or forges a completion. */
import {ensureMengjinStylesheet} from './mengjin-board.js';
export const MENGJIN_ACTS = [
  {stage:'白昼 · 玉匠铺', quest:'mengjin-jade-mainline', locationId:'mengjin-jade-courtyard', step:'hear-jade-story', title:'第一幕 · 初见玉匠垂', entryId:'mengjin-jade-story-opening'},
  {stage:'白昼 · 玉匠铺', quest:'mengjin-jade-mainline', locationId:'mengjin-jade-courtyard', step:'solve-jade-board', title:'第二幕 · 九村五贡物', boardId:'mengjin-jade-sixbit'},
  {stage:'白昼 · 玉匠铺', quest:'mengjin-jade-mainline', locationId:'mengjin-jade-courtyard', step:'reflect-jade', title:'第三幕 · 一态无言，两态成话', entryId:'mengjin-jade-story-reflection'},
  {stage:'白昼 · 玉匠铺', quest:'mengjin-jade-mainline', locationId:'mengjin-jade-courtyard', step:'report-jade', title:'第四幕 · 向玉匠回报', entryId:'mengjin-jade-story-report'},
  {stage:'夜景 · 贞人居所', quest:'mengjin-diviner-mainline', locationId:'mengjin-diviner-residence', step:'meet-diviner', title:'第五幕 · 夜访老贞', entryId:'mengjin-diviner-intro'},
  {stage:'夜景 · 贞人居所', quest:'mengjin-diviner-mainline', locationId:'mengjin-diviner-residence', step:'learn-four-patterns', title:'第六幕 · 双玉璜四象', boardId:'mengjin-diviner-four-symbols'},
  {stage:'夜景 · 贞人居所', quest:'mengjin-diviner-mainline', locationId:'mengjin-diviner-residence', step:'report-diviner', title:'第七幕 · 夜访收束', entryId:'mengjin-diviner-report'},
  {stage:'白昼 · 授业学舍（上）',quest:'mengjin-school-upper',locationId:'mengjin-school-courtyard',step:'school-upper-intro',title:'第八幕 · 数年之后',entryId:'mengjin-school-upper-intro'},
  {stage:'白昼 · 授业学舍（上）',quest:'mengjin-school-upper',locationId:'mengjin-school-courtyard',step:'school-truth-table',title:'第九幕 · 八行真值表',boardId:'mengjin-school-truth-table'},
  {stage:'白昼 · 授业学舍（上）',quest:'mengjin-school-upper',locationId:'mengjin-school-courtyard',step:'school-upper-report',title:'第十幕 · 授业上收束',entryId:'mengjin-school-upper-report'},
  {stage:'白昼 · 授业学舍（下）',quest:'mengjin-school-lower',locationId:'mengjin-school-courtyard',step:'school-lower-intro',title:'第十一幕 · 丑入学舍',entryId:'mengjin-school-lower-intro'},
  {stage:'白昼 · 授业学舍（下）',quest:'mengjin-school-lower',locationId:'mengjin-school-courtyard',step:'school-find-fault',title:'第十二幕 · 查故障',boardId:'mengjin-school-fault-check'},
  {stage:'白昼 · 授业学舍（下）',quest:'mengjin-school-lower',locationId:'mengjin-school-courtyard',step:'school-critical-path',title:'第十三幕 · 算延迟',boardId:'mengjin-school-delay-path'},
  {stage:'白昼 · 授业学舍（下）',quest:'mengjin-school-lower',locationId:'mengjin-school-courtyard',step:'school-signal-regeneration',title:'第十四幕 · 衰减与再生',boardId:'mengjin-school-signal-regen'},
  {stage:'白昼 · 授业学舍（下）',quest:'mengjin-school-lower',locationId:'mengjin-school-courtyard',step:'school-lower-report',title:'第十五幕 · 授业下收束',entryId:'mengjin-school-lower-report'},
  {stage:'白昼 · 授业学舍（下）',quest:'mengjin-school-lower',locationId:'mengjin-school-courtyard',step:'school-mengjin-summary',title:'第十六幕 · 孟津算稿交接',entryId:'mengjin-school-summary'},

  {stage:'陶寺 · 子时算稿第一页',quest:'taosi-three-pages',locationId:'taosi-old-academy',step:'taosi-one-intro',title:'第十七幕 · 旧学舍与遗玉',entryId:'taosi-one-intro'},
  {stage:'陶寺 · 子时算稿第一页',quest:'taosi-three-pages',locationId:'taosi-old-academy',step:'taosi-one-board',title:'第十八幕 · 表示与运算',boardId:'taosi-representation-board'},
  {stage:'陶寺 · 子时算稿第一页',quest:'taosi-three-pages',locationId:'taosi-old-academy',step:'taosi-one-note',title:'第十九幕 · 算稿第一页',entryId:'taosi-one-note'},
  {stage:'陶寺 · 子时算稿第二页',quest:'taosi-three-pages',locationId:'taosi-old-academy',step:'taosi-two-intro',title:'第二十幕 · 定向玉网',entryId:'taosi-two-intro'},
  {stage:'陶寺 · 子时算稿第二页',quest:'taosi-three-pages',locationId:'taosi-old-academy',step:'taosi-two-board',title:'第二十一幕 · 方向与环路',boardId:'taosi-direction-board'},
  {stage:'陶寺 · 子时算稿第二页',quest:'taosi-three-pages',locationId:'taosi-old-academy',step:'taosi-two-note',title:'第二十二幕 · 算稿第二页',entryId:'taosi-two-note'},
  {stage:'陶寺 · 子时算稿第三页',quest:'taosi-three-pages',locationId:'taosi-old-academy',step:'taosi-three-intro',title:'第二十三幕 · 定向玉',entryId:'taosi-three-intro'},
  {stage:'陶寺 · 子时算稿第三页',quest:'taosi-three-pages',locationId:'taosi-old-academy',step:'taosi-three-board',title:'第二十四幕 · 顺通逆断',boardId:'taosi-oneway-board'},
  {stage:'陶寺 · 子时算稿第三页',quest:'taosi-three-pages',locationId:'taosi-old-academy',step:'taosi-three-note',title:'第二十五幕 · 算稿第三页',entryId:'taosi-three-note'},
  {stage:'嫣沩日景 · 算稿第四页',quest:'yanwei-day-four',locationId:'yanwei-riverside-day',step:'yanwei-four-intro',title:'第二十六幕 · 水畔倒灌',entryId:'yanwei-four-intro'},
  {stage:'嫣沩日景 · 算稿第四页',quest:'yanwei-day-four',locationId:'yanwei-riverside-day',step:'yanwei-four-board',title:'第二十七幕 · 封堵倒灌点',boardId:'yanwei-backflow-board'},
  {stage:'嫣沩日景 · 算稿第四页',quest:'yanwei-day-four',locationId:'yanwei-riverside-day',step:'yanwei-four-note',title:'第二十八幕 · 算稿第四页',entryId:'yanwei-four-note'},
  {stage:'嫣沩夜景 · 算稿第五页',quest:'yanwei-night-five-six',locationId:'yanwei-riverside-night',step:'yanwei-five-intro',title:'第二十九幕 · 一级推动一级',entryId:'yanwei-five-intro'},
  {stage:'嫣沩夜景 · 算稿第五页',quest:'yanwei-night-five-six',locationId:'yanwei-riverside-night',step:'yanwei-five-board',title:'第三十幕 · 级联与扇出',boardId:'yanwei-cascade-board'},
  {stage:'嫣沩夜景 · 算稿第五页',quest:'yanwei-night-five-six',locationId:'yanwei-riverside-night',step:'yanwei-five-note',title:'第三十一幕 · 算稿第五页',entryId:'yanwei-five-note'},
  {stage:'嫣沩夜景 · 算稿第六页',quest:'yanwei-night-five-six',locationId:'yanwei-riverside-night',step:'yanwei-six-intro',title:'第三十二幕 · 传导与判断的边界',entryId:'yanwei-six-intro'},
  {stage:'嫣沩夜景 · 算稿第六页',quest:'yanwei-night-five-six',locationId:'yanwei-riverside-night',step:'yanwei-six-board',title:'第三十三幕 · 找到汇合结构',boardId:'yanwei-merge-board'},
  {stage:'嫣沩夜景 · 算稿第六页',quest:'yanwei-night-five-six',locationId:'yanwei-riverside-night',step:'yanwei-six-note',title:'第三十四幕 · 六页算稿收束',entryId:'yanwei-six-note'},

  {stage:'陶寺 · 丑返旧学舍',quest:'taosi-chou-handoff',locationId:'taosi-old-academy-return',step:'chou-meet-old-woman',title:'第三十五幕 · 与老妇重见',entryId:'taosi-chou-intro'},
  {stage:'陶寺 · 丑返旧学舍',quest:'taosi-chou-handoff',locationId:'taosi-old-academy-return',step:'chou-read-manuscript',title:'第三十六幕 · 查看书案与算稿',boardId:'taosi-handoff-board'},
  {stage:'陶寺 · 丑返旧学舍',quest:'taosi-chou-handoff',locationId:'taosi-old-academy-return',step:'chou-take-responsibility',title:'第三十七幕 · 接下制门第一步',entryId:'taosi-chou-report'},

];
const SCENE_PREREQUISITE = Object.freeze({
  'mengjin-diviner-mainline':'mengjin-jade-mainline',
  'mengjin-school-upper':'mengjin-diviner-mainline',
  'mengjin-school-lower':'mengjin-school-upper',
  'taosi-three-pages':'mengjin-school-lower',
  'yanwei-day-four':'taosi-three-pages',
  'yanwei-night-five-six':'yanwei-day-four',
  'taosi-chou-handoff':'yanwei-night-five-six',
});
export function sceneIndexStatus(state, act) {
  const saves=state?.tasks?.side || {};
  const previous=SCENE_PREREQUISITE[act.quest];
  if (previous && saves[previous]?.status !== 'submitted') return 'locked';
  const progress=saves[act.quest];
  const acts=MENGJIN_ACTS.filter(item=>item.quest===act.quest);
  const here=acts.findIndex(item=>item.step===act.step);
  if (here<0) return 'locked';
  if (progress?.steps?.[act.step]?.status==='done') return 'done';
  const first=acts.findIndex(item=>progress?.steps?.[item.step]?.status!=='done');
  if (here===(first<0?acts.length:first)) return 'current';
  return 'locked';
}
export function mountMengjinCatalog(host,{state,onVisit}) {
  ensureMengjinStylesheet();
  const trigger=document.createElement('button');trigger.type='button';
  trigger.textContent='第一章 · 剧情目录';trigger.className='mj-catalog-button';
  host.append(trigger);
  let modal=null;
  function close(){modal?.remove();modal=null;}
  trigger.addEventListener('click',()=>{
    if(modal){close();return;}
    modal=document.createElement('section');modal.className='mj-story-modal mj-catalog-modal';
    modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-label','第一章剧情目录');
    host.append(modal);
    const shade=document.createElement('div');shade.className='mj-story-shade';modal.append(shade);shade.addEventListener('click',close);
    const shell=document.createElement('div');shell.className='mj-story-shell';modal.append(shell);
    const header=document.createElement('header');header.className='mj-story-header';shell.append(header);
    const title=document.createElement('h2');title.textContent=`第一章 · 剧情目录（${MENGJIN_ACTS.length}幕）`;header.append(title);
    const hint=document.createElement('p');hint.className='mj-story-hint';hint.textContent='已解锁的幕可以直接回顾；回顾不改变任务进度，也不会重新领取奖励。';header.append(hint);
    const list=document.createElement('div');list.className='mj-catalog-list';shell.append(list);
    let latestStage='';
    MENGJIN_ACTS.forEach(act=>{
      if(latestStage!==act.stage){latestStage=act.stage;const h=document.createElement('strong');h.className='mj-catalog-stage';h.textContent=act.stage;list.append(h);}
      const status=sceneIndexStatus(state,act);
      const btn=document.createElement('button');btn.type='button';btn.className='mj-catalog-entry';
      const label=document.createElement('strong');label.textContent=act.title;btn.append(label);
      const flag=document.createElement('span');flag.textContent=status==='done'?'已完成':status==='current'?'当前可看':'尚未解锁';btn.append(flag);
      btn.disabled=status==='locked';
      btn.addEventListener('click',()=>{if(btn.disabled)return;close();onVisit(act);});
      list.append(btn);
    });
    const closeBtn=document.createElement('button');closeBtn.type='button';closeBtn.className='mj-story-quiet';closeBtn.textContent='关闭目录';
    closeBtn.addEventListener('click',close);shell.append(closeBtn);
  });
  return {close};
}
