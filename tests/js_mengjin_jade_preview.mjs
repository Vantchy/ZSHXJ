/** The user's first complete Mengjin workshop scene on V9's shared room/dialogue. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDialoguePlayer} from '../public/dialogue-player.js';
import {createRoomActors} from '../public/room-actors.js';
import {getChapterOneRegion} from '../public/chapter-one-region-maps.js';
import {enterRoomLocation, captureRoomLocationPosition} from '../public/room-location-position.js';

const story=JSON.parse(fs.readFileSync(new URL('../public/story/ch1.json',import.meta.url),'utf-8'));
const marker=getChapterOneRegion('mengjin').hotspots;
assert.equal(marker.length,2);
assert.equal(marker[0].id,'mengjin-inner-court');
assert.equal(marker[0].locationId,null,'school is still reserved');
assert.equal(marker[1].id,'mengjin-river-gate');
assert.equal(marker[1].locationId,'mengjin-jade-courtyard');

const location={id:'mengjin-jade-courtyard',npc:'玉匠垂',spawnX:914,
  roomType:'story-preview',background:'/assets/scenes/mengjin-jade-workshop.png',
  ...story.locations.find(loc=>loc.id==='mengjin-jade-courtyard')};
const chapter={id:'ch1',npc:'玉匠垂',quests:{main:null,side:[]},questTargets:{}};
const actors=createRoomActors(chapter,location,Object.fromEntries(story.characters.map(c=>[c.id,c])));
assert.equal(actors.length,1);
assert.equal(actors[0].id,'artisan-chui');
assert.equal(actors[0].x,304);
assert.equal(actors[0].dialogueId,'mengjin-jade-preview-opening');
assert.equal(actors[0].questId,null);
assert.equal(actors[0].name,'玉匠垂');

const draft={locationId:'gate-road',position:{x:625},circuits:{sample:{nodes:1}},
  tasks:{main:{status:'accepted'},side:{'binary-decoder':{status:'submitted'}}}};
const snapshot=JSON.stringify(draft.tasks);
assert.equal(enterRoomLocation(draft,location,{legacyLocationId:'gate-road'}),914);
assert.equal(draft.position.x,914,'enter from the RIGHT');
assert.ok(draft.position.x>actors[0].x+500,'walk from right to LEFT of workshop');
assert.deepEqual(draft.locationPositions['gate-road'],{x:625});
assert.deepEqual(draft.locationPositions[location.id],{x:914});
draft.position.x=410;
captureRoomLocationPosition(draft,location.id);
assert.deepEqual(draft.locationPositions[location.id],{x:410});
enterRoomLocation(draft,{id:'gate-road',spawnX:180},{legacyLocationId:'gate-road'});
assert.equal(draft.position.x,625,'revisit preserves preexisting legacy workshop position');
enterRoomLocation(draft,location,{legacyLocationId:'gate-road'});
assert.equal(draft.position.x,410,'return restores preview position');
assert.equal(JSON.stringify(draft.tasks),snapshot,'location switching cannot modify tasks');
assert.deepEqual(draft.circuits,{sample:{nodes:1}},'location switching preserves old circuit draft');

const nodes=new Map(story.dialogues.map(p=>[p.id,p]));
const intro=nodes.get('mengjin-jade-preview-opening');
const board=nodes.get('mengjin-jade-preview-board');
const end=nodes.get('mengjin-jade-preview-after-board');
assert.equal(intro.lines.length,5);
assert.equal(board.lines.length,2);
assert.equal(end.lines.length,3);
assert.match(intro.lines[2].text,/绳会烂，骨会朽/);
assert.match(intro.lines[3].text,/二百五十六样/);
assert.match(intro.lines[4].text,/九个村、五种贡物/);
assert.match(board.lines[0].text,/下邽村贡麦/);
assert.match(end.lines[0].text,/六位六十有四/);
assert.match(end.lines[1].text,/刻深了，玉裂/);
assert.equal(end.lines.at(-1).text,'（低声）一态无言，两态成话。');
assert.deepEqual(intro.lines.map(l=>l.expression||'serious'),
  ['serious','thinking','serious','surprised','smile']);
assert.deepEqual(end.lines.map(l=>l.expression),['thinking','serious','thinking']);
for (const p of [intro,board,end]) {
  assert.ok(!(p.options||[]).some(choice=>choice.target?.type==='level'),
    'unreleased exercise must not open old circuit editor');
}

let last, finished=0, tick=0;
const player=createDialoguePlayer({dialogues:story.dialogues,entryId:intro.id,
  characters:Object.fromEntries(story.characters.map(c=>[c.id,c])),
  delay:0,inputDelay:0,now:()=>++tick,
  onChange:state=>last=state,onFinish:()=>finished++});
player.start();
for(let i=0;i<intro.lines.length;i++){
  assert.equal(last.paragraphId,intro.id);
  assert.equal(last.lineIndex,i);
  assert.equal(last.speaker.expression,intro.lines[i].expression||'serious');
  assert.equal(last.fullText,intro.lines[i].text);
  if(i<intro.lines.length-1) assert.equal(player.advance(),true);
}
assert.equal(last.phase,'choices');
assert.ok(last.options[0].text.includes('待制作'));
assert.equal(player.choose(0),true);
assert.equal(last.paragraphId,board.id);
assert.match(last.fullText,/对照编码表解码/);
player.advance();
assert.match(last.fullText,/不记录成绩/);
assert.equal(last.phase,'choices');
player.choose(0);
assert.equal(last.paragraphId,end.id);
for(let i=0;i<end.lines.length;i++){
  assert.equal(last.speaker.expression,end.lines[i].expression);
  if(i<end.lines.length-1) player.advance();
}
assert.equal(last.phase,'end');
player.advance();
assert.equal(finished,1);
assert.equal(JSON.stringify(draft.tasks),snapshot,
  'watching the whole preview cannot complete or submit legacy quests');
console.log('Mengjin scene PASS: outer river-gate, right-to-left cylinders, original dialogue/emotions, temporary exercise prompt, independent saved position.');
