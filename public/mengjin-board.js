/** 第一章教学玉版入口。答题版面与校验独立，保留原任务流程。 */
import {verifySchoolAnswers} from './mengjin-school-board.js';
import {verifyTaosiAnswers} from './taosi-teaching-board.js';
import {verifyYanweiAnswers} from './yanwei-teaching-board.js';
import {mountTeachingJadeQuiz} from './teaching-jade-quiz.js?v=chapter-ui-5';

const RESOURCE = '/scene-activities/mengjin-teaching-boards.json';
const STATIONS = Object.freeze({
  'mengjin-jade-courtyard':335, // 玉环中心：原图 x≈627/1916，世界坐标≈335
  'mengjin-diviner-residence':325, // 案上龟甲中心：原图 x≈565/1774，世界坐标≈326
  'mengjin-school-courtyard':315,
  'taosi-old-academy':446,
  'taosi-old-academy-return':446,
  'yanwei-riverside-day':318,
  'yanwei-riverside-night':318,
});
export const boardStationForLocation=id=>STATIONS[id]??null;

export function expectedJadeAnswers(spec){
  const index=Number.parseInt(spec.readCode,2);
  const offered=spec.offerings[index%spec.offerings.length];
  const write=spec.villages.indexOf(spec.writeVillage)*spec.offerings.length+
    spec.offerings.indexOf(spec.writeOffering);
  return {
    bits:Math.ceil(Math.log2(spec.villages.length*spec.offerings.length)),
    decodedOffering:offered,
    encoded:write.toString(2).padStart(spec.bitCount,'0'),
  };
}
/** Preserve the exact first-chapter and later teaching-board answer contracts. */
export function verifyTeachingAnswers(boardId,answers,rules){
  if(boardId===rules.jade.id){
    const expected=expectedJadeAnswers(rules.jade);
    return answers.bits===expected.bits &&
      answers.decodedOffering===expected.decodedOffering &&
      answers.encoded===expected.encoded;
  }
  if(boardId===rules.diviner.id){
    const wanted=rules.diviner.patterns;
    return Array.isArray(answers.seen)&&answers.seen.length===wanted.length&&
      wanted.every(value=>answers.seen.includes(value));
  }
  if(rules.school&&Object.values(rules.school).some(spec=>spec.id===boardId))
    return verifySchoolAnswers(boardId,answers,rules.school);
  if(rules.taosi&&Object.values(rules.taosi).some(spec=>spec.id===boardId))
    return verifyTaosiAnswers(boardId,answers,rules.taosi);
  if(rules.yanwei&&Object.values(rules.yanwei).some(spec=>spec.id===boardId))
    return verifyYanweiAnswers(boardId,answers,rules.yanwei);
  return false;
}
export function ensureMengjinStylesheet(){
  if(document.querySelector('link[data-mengjin-board]'))return;
  const link=document.createElement('link');
  link.rel='stylesheet';
  link.href='/mengjin-story.css?v=4';
  link.dataset.mengjinBoard='true';
  document.head.append(link);
}
/** All completions use the existing chapter step/answer verification callbacks. */
export async function mountMengjinBoard({host,boardId,onSolved,onClose,readonly=false}){
  ensureMengjinStylesheet();
  const response=await fetch(RESOURCE,{cache:'no-store'});
  if(!response.ok)throw new Error('教学题板配置加载失败，请检查项目文件。');
  const rules=await response.json();
  return mountTeachingJadeQuiz({host,boardId,rules,onSolved,onClose,readonly});
}
