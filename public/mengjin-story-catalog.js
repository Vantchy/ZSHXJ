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

];
const SCENE_PREREQUISITE = Object.freeze({
  'mengjin-diviner-mainline':'mengjin-jade-mainline',
  'mengjin-school-upper':'mengjin-diviner-mainline',
  'mengjin-school-lower':'mengjin-school-upper',
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
    modal.setAttribute('aria-label','第一章孟津剧情目录');
    host.append(modal);
    const shade=document.createElement('div');shade.className='mj-story-shade';modal.append(shade);shade.addEventListener('click',close);
    const shell=document.createElement('div');shell.className='mj-story-shell';modal.append(shell);
    const header=document.createElement('header');header.className='mj-story-header';shell.append(header);
    const title=document.createElement('h2');title.textContent='孟津 · 剧情目录（十六幕）';header.append(title);
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
