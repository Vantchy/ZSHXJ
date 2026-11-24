// Task-book display regression: run from repository root with `node tests/js_quest_book_merge_fix.mjs`.
import assert from 'node:assert/strict';
import {questBookBranch,questBookDescription,questBookPlainTitle} from '../public/quest-book-display.js';
const cases = [
  ['yin-majority','yin-zhongcun-tent','寅','钟村'],
  ['yin-mux','yin-zhenxun-road','寅','斟鄩'],
  ['yin-summit','yin-jingbo-meeting','寅','景亳'],
  ['yangcheng-army-not','yangcheng-valley-deception','丑','阳城'],
  ['mengjin-jade-mainline','mengjin-jade-courtyard','亥','孟津'],
  ['yanwei-day-four','yanwei-riverside-day','子','嫣沩'],
  ['taosi-chou-handoff','taosi-old-academy-return','丑','陶寺'],
];
for (const [id, locationId, branch, city] of cases) {
  const quest={id,locationId,title:'第二场 中段',description:'查看本场任务，并完成互动。'};
  assert.equal(questBookBranch(quest),branch,id);
  const description=questBookDescription(quest,{locations:[]});
  assert.equal(description,city+'，查看本场任务，并完成互动。',id);
}
assert.equal(questBookPlainTitle({title:'寅时·景亳 桃林半加器'}),'桃林半加器');
assert.equal(questBookPlainTitle({title:'丑时·阳城 六事'}),'六事');
assert.equal(questBookDescription({
 id:'yin-mux', locationId:'yin-zhenxun-road',description:'斟鄩，已在此地。'
},{locations:[]}), '斟鄩，已在此地。');
console.log('PASS ZSHXJ quest-book city grouping, id fallback and no duplicate city');
