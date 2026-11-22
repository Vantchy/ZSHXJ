import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isPlaceholderQuest, questDisplayCategory, visibleTaskEntries, selectVisibleTaskKey}
  from '../public/story-task-presentation.js';
import {completedSceneReviewEntries} from '../public/story-review-model.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const story=JSON.parse(fs.readFileSync(path.join(root,'public/story/ch1.json'),'utf8'));
const room=fs.readFileSync(path.join(root,'public/room.js'),'utf8');
const script=story.questTargets;
const main={id:'main',locationId:'gate-road',title:'主线任务'};
const test={id:'side-test',locationId:'gate-road',title:'支线任务'};
const practice={id:'binary-decoder',locationId:'gate-road',title:'玉匠铺·两纹记数'};
const jade={id:'mengjin-jade-mainline',locationId:'mengjin-jade-courtyard',title:'孟津主线·玉匠铺',prerequisites:[]};
const next={id:'mengjin-diviner-mainline',locationId:'mengjin-diviner-residence',title:'孟津主线·贞人居所',prerequisites:['mengjin-jade-mainline']};
const chapter={quests:{main,side:[test,practice,jade,next]},questTargets:script,dialogues:story.dialogues};
const state={tasks:{main:{status:'accepted'},side:{'side-test':{status:'accepted'},
  'binary-decoder':{status:'not-accepted'},'mengjin-jade-mainline':{status:'submitted'},
  'mengjin-diviner-mainline':{status:'accepted'}}}};
assert(isPlaceholderQuest(main));
assert(isPlaceholderQuest(test));
assert.equal(questDisplayCategory(main,chapter),null);
assert.equal(questDisplayCategory(jade,chapter),'story');
assert.equal(questDisplayCategory(practice,chapter),'practice');
const tasks=visibleTaskEntries(chapter,state);
assert.deepEqual(tasks.map(x=>x.key),['side:binary-decoder','side:mengjin-jade-mainline','side:mengjin-diviner-mainline']);
assert.equal(tasks.filter(x=>x.category==='story').length,2);
assert.equal(tasks.filter(x=>x.category==='practice').length,1);
assert.equal(selectVisibleTaskKey(tasks,'main',state,chapter,'mengjin-diviner-residence'),
    'side:mengjin-diviner-mainline');
assert.equal(selectVisibleTaskKey(tasks,'side:mengjin-jade-mainline',state,chapter,'mengjin-diviner-residence'),
    'side:mengjin-jade-mainline');
const quest={id:jade.id,steps:[
  {id:'hear-jade-story',title:'听故事',condition:{dialogueId:'mengjin-jade-story-opening'}},
  {id:'solve-jade-board',title:'刻玉纹',condition:{boardId:'mengjin-jade-sixbit',dialogueId:'mengjin-jade-board-done'}},
  {id:'reflect-jade',title:'复述知识',condition:{dialogueId:'mengjin-jade-story-reflection'}},
  {id:'report-jade',title:'交付',condition:{dialogueId:'mengjin-jade-story-report'}},
]};
const progress={status:'submitted',steps:Object.fromEntries(quest.steps.map(s=>[s.id,{status:'done',evidence:{safe:true}}]))};
const snapshot=JSON.stringify(progress);
const replay=completedSceneReviewEntries(chapter,quest,progress);
assert.deepEqual(replay.map(x=>x.kind),['dialogue','board','dialogue','dialogue']);
assert.deepEqual(replay.map(x=>x.targetId),['mengjin-jade-story-opening','mengjin-jade-sixbit',
  'mengjin-jade-story-reflection','mengjin-jade-story-report']);
assert.equal(JSON.stringify(progress),snapshot, 'replay route must not mutate progress');
progress.steps['solve-jade-board'].status='current';
assert(!completedSceneReviewEntries(chapter,quest,progress).some(x=>x.kind==='board'));
// V7.5 consolidates the old NPC replay modal into the task book's spot review.
assert.match(room,/openSpotReviewInTaskBook\(sceneQuest\.id\)/);
assert.match(room,/node\('strong','本光点回顾',heading\)/);
assert(!room.includes('openSceneReplayPanel'));
assert(!room.includes('scene-replay-item'));
assert.match(room,/dialogueAction\('继续', \(\) => storyPlayer\?\.advance\(\)/);
assert(!room.includes("'显示全文'"));
console.log('PASS V7.3: mainline/task-book presentation, read-only per-step replay, concise dialogue actions');
