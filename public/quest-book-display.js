/** 第一章任务书的纯显示分组；不修改原始任务、进度或存档标识。 */
import {questPrerequisitesSatisfied} from './task-model.js';

const EARTHLY_BRANCHES = ['亥','子','丑','寅','卯','辰','巳','午','未','申','酉','戌'];
const NUMERALS = ['零','一','二','三','四','五','六','七','八','九','十'];
const numeral = n => n <= 10 ? NUMERALS[n] : n < 20 ? `十${NUMERALS[n-10]}` : String(n);

/** Preserve the source classification so former “其他” quests can become 寅 endings. */
function questBookSourceBranch(quest) {
  const title=String(quest?.title||'');
  if (/^孟津主线[·：:\s]/.test(title) || /^mengjin-(?:jade|diviner|school)/.test(quest?.id||'')) return '亥';
  const branch=title.match(/^([亥子丑寅卯辰巳午未申酉戌])时[·：:\s]/)?.[1];
  if(branch)return branch;
  if (quest?.id === 'taosi-chou-handoff') return '丑';
  if (/^(taosi-three-pages|yanwei-)/.test(quest?.id||'')) return '子';
  return '其他';
}
export function questBookBranch(quest) {
  const branch=questBookSourceBranch(quest);
  return branch==='其他' ? '寅' : branch;
}
export function questBookPlainTitle(quest) {
  return String(quest?.title||'未命名任务')
    .replace(/^(?:主线|支线)[：:]\s*/,'')
    .replace(/^孟津主线\s*[·：:]\s*/,'')
    .replace(/^[亥子丑寅卯辰巳午未申酉戌]时\s*结局\s*[·：:]\s*/,'')
    .replace(/^[亥子丑寅卯辰巳午未申酉戌]时\s*[·：:]\s*/,'')
    // 地名和当地章节编号只在原始剧情标题中出现；任务书统一重新编号。
    .replace(/^(?:孟津|陶寺|嫣沩|阳城|钟村|斟鄩|景亳)(?:[·、，:：\s]+|$)/,'')
    .replace(/^(?:器派)?旧学舍(?=重归|归来|夜制)/,'')
    .replace(/^其[零一二三四五六七八九十百千\d]+\s*[·：:]\s*/,'')
    .replace(/^第[一二三四五六七八九十百\d]+场\s*/,'')
    .replace(/[（(]\s*[日夜]\s*[）)]/g,'')
    .trim(); // （上）和（下）保留
}
/** 地名只出现在任务介绍中，取自任务实际地点（而非标题中可能省略的城市）。 */
export function questBookDescription(quest,chapter) {
  const description=String(quest?.description||'').trim();
  if(!description)return '';
  const scene=chapter?.locations?.find(item=>item.id===quest?.locationId);
  // 城名取实际场景名的首段：阳城军营、钟村、斟鄩和景亳不再遗漏。
  const scenePlace=String(scene?.name||'').split(/[·、，:：\s（(]/,1)[0];
  const knownPlaces=['孟津','陶寺','嫣沩','阳城','钟村','斟鄩','景亳'];
  const cityFromScene=knownPlaces.includes(scenePlace) ? scenePlace : '';
  const sceneId=String(quest?.locationId||'');
  const cityFromId=Object.entries({
    'mengjin-':'孟津','taosi-':'陶寺','yanwei-':'嫣沩',
    'yangcheng-':'阳城','yin-zhongcun-':'钟村',
    'yin-zhenxun-':'斟鄩','yin-jingbo-':'景亳',
  }).find(([prefix])=>sceneId.startsWith(prefix))?.[1];
  const city=cityFromScene||cityFromId||
    (quest?.id==='taosi-chou-handoff'?'陶寺':'')||
    (quest?.id==='binary-decoder'?'孟津':'');
  if(!city)return description;
  // 重入渲染不会重复叠加地名；统一使用中文逗号。
  const body=description.replace(/^(?:孟津|陶寺|嫣沩|阳城|钟村|斟鄩|景亳)[，,、:：\s]+/,'');
  return `${city}，${body}`;
}

export function questBookStoryGroups(tasks) {
  const branches=new Map();
  const seen=new Set();
  for (const entry of tasks.filter(item=>item.category==='story')) {
    // A mission is numbered only once per branch; crossing a city never
    // restarts its ordinal, and duplicate entries cannot produce two 其n labels.
    const identity=entry.quest?.id||entry.key;
    if(seen.has(identity))continue;
    seen.add(identity);
    const sourceBranch=questBookSourceBranch(entry.quest);
    const branch=sourceBranch==='其他' ? '寅' : sourceBranch;
    if(!branches.has(branch))branches.set(branch,[]);
    const records=branches.get(branch);
    // Former “其他” consists of the five 寅时结局 quests: move them beneath 寅,
    // but keep their “结局·…” labels separate from the numbered story missions.
    const isEnding=sourceBranch==='其他' || /^寅时\s*[·：:]\s*结局/.test(entry.quest?.title||'');
    const number=records.filter(item=>!item.isEnding).length+1;
    const title=questBookPlainTitle(entry.quest);
    records.push({...entry,isEnding,displayTitle:isEnding?`结局·${title}`:`其${numeral(number)}·${title}`});
  }
  return [...branches].sort((a,b)=>{
    const ai=EARTHLY_BRANCHES.indexOf(a[0]),bi=EARTHLY_BRANCHES.indexOf(b[0]);
    return (ai<0?999:ai)-(bi<0?999:bi);
  }).map(([branch,entries])=>({branch,entries}));
}
export function questBookDisplayTitle(entry,tasks) {
  for(const group of questBookStoryGroups(tasks)) {
    const found=group.entries.find(item=>item.key===entry?.key);
    if(found)return found.displayTitle;
  }
  return questBookPlainTitle(entry?.quest);
}
/** 任务指示箭头来自实际正在进行的任务，与用户点击浏览哪项无关。 */
export function questBookCurrentKey(tasks,chapter,state,locationId=null) {
  const story=tasks.filter(item=>item.category==='story');
  const open=item=>item.progress?.status!=='submitted';
  const eligible=item=>questPrerequisitesSatisfied(chapter,state,item.quest);
  return (story.find(item=>open(item)&&item.quest.locationId===locationId&&
       ['accepted','completed'].includes(item.progress?.status)) ||
    story.find(item=>open(item)&&['accepted','completed'].includes(item.progress?.status)) ||
    story.find(item=>open(item)&&item.quest.locationId===locationId&&eligible(item)) ||
    story.find(item=>open(item)&&eligible(item)) || null)?.key||'';
}

/** 在同一滚动容器中绘制分组、任务和当前箭头，箭头天然随滚动移动。 */
export function renderQuestBookGroups({container,tasks,selectedKey,currentKey,
  expandedBranches,onSelect}) {
  const make=(tag,cls,text,parent)=>{
    const element=document.createElement(tag);
    if(cls)element.className=cls;
    if(text!==undefined)element.textContent=text;
    if(parent)parent.append(element);
    return element;
  };
  const image=(parent,name,cls)=>{
    const node=make('img',cls,undefined,parent);
    node.src='/assets/quests/'+name;node.alt='';node.setAttribute('aria-hidden','true');
    return node;
  };
  const heading=(title,parent)=>{
    const header=make('div','room-quest-group-heading',undefined,parent);
    image(header,'quest-group-marker.png','room-quest-group-icon');
    make('strong','',title,header);
  };
  const taskButton=(entry,parent,title)=>{
    const active=entry.key===selectedKey;
    const current=entry.key===currentKey;
    const button=make('button','room-quest-task'+(active?' is-selected':'')+
      (current?' is-current-quest':''),title,parent);
    button.type='button';button.title=title;
    button.setAttribute('aria-current',String(active));
    if(current)button.setAttribute('aria-label',`${title}，当前任务`);
    button.addEventListener('click',()=>onSelect(entry));
    return button;
  };
  const story=questBookStoryGroups(tasks);
  if(story.length){
    const block=make('section','room-quest-group room-quest-story',undefined,container);
    heading('剧情主线',block);
    for(const {branch,entries} of story){
      const wrapper=make('div','room-quest-branch',undefined,block);
      const expanded=expandedBranches.has(branch);
      const isCurrent=entries.some(entry=>entry.key===currentKey);
      const toggle=make('button','room-quest-branch-button'+
        (isCurrent?' is-current-branch':''),branch,wrapper);
      toggle.type='button';toggle.setAttribute('aria-expanded',String(expanded));
      toggle.setAttribute('aria-label',`${branch}，${expanded?'收起':'展开'}任务`);
      const detail=make('div','room-quest-branch-list'+(expanded?'':' is-collapsed'),undefined,wrapper);
      detail.setAttribute('aria-hidden',String(!expanded));detail.inert=!expanded;
      toggle.addEventListener('click',()=>{
        const next=!expandedBranches.has(branch);
        if(next)expandedBranches.add(branch);else expandedBranches.delete(branch);
        toggle.setAttribute('aria-expanded',String(next));
        toggle.setAttribute('aria-label',`${branch}，${next?'收起':'展开'}任务`);
        detail.classList.toggle('is-collapsed',!next);
        detail.setAttribute('aria-hidden',String(!next));detail.inert=!next;
      });
      for(const entry of entries)taskButton(entry,detail,entry.displayTitle);
    }
  }
  const practice=tasks.filter(entry=>entry.category==='practice');
  if(practice.length){
    const block=make('section','room-quest-group room-quest-practice',undefined,container);
    heading('教学练习',block);
    for(const entry of practice)taskButton(entry,block,questBookPlainTitle(entry.quest));
  }
}
