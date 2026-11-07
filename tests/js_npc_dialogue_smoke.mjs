/* NPC 对话新增行为回归测试：只使用 Node 标准库，不依赖浏览器/第三方包。 */
import assert from "node:assert/strict";
import { createRoom } from "../public/room.js";

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.textContent = "";
    this.disabled = false;
    this.handlers = {};
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); }
  removeEventListener(name, fn) {
    this.handlers[name] = (this.handlers[name] || []).filter((other) => other !== fn);
  }
  setAttribute() {}
  focus() { document.activeElement = this; }
  getContext() {
    return { clearRect() {}, strokeRect() {}, beginPath() {}, moveTo() {},
      lineTo() {}, stroke() {}, fillRect() {}, fillText() {} };
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 240 }; }
  querySelectorAll(name) {
    const result = [];
    for (const child of this.children) {
      if (child.tagName === name.toUpperCase()) result.push(child);
      result.push(...child.querySelectorAll(name));
    }
    return result;
  }
  async click(event = {}) {
    for (const fn of this.handlers.click || []) await fn({ preventDefault() {}, ...event });
  }
}
const listeners = {};
globalThis.document = {
  activeElement: null,
  createElement: (tag) => new Element(tag),
};
globalThis.window = {
  addEventListener(name, fn) { (listeners[name] ??= []).push(fn); },
  removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter((x) => x !== fn); },
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function key(code) {
  const event = { code, repeat: false, preventDefault() {} };
  for (const fn of [...listeners.keydown || []]) fn(event);
}
function find(container, label) {
  const result = container.querySelectorAll("button").find((b) => b.textContent === label);
  assert.ok(result, `Missing option: ${label}`);
  return result;
}
const buttonLabels = (container) => container.querySelectorAll("button").map((el) => el.textContent);
const chapter = {
  id: "ch1", room: "夏 · 工坊", npc: "工匠",
  npcLine: "炉子里的铜刚化开，你来得正巧。",
  quests: { main: { id: "main", title: "主线：工坊委托" }, side: [
    { id: "tools", title: "支线：整理器具", completion: {mode:"test-only",levelIds:[]},
      steps:[{id:"step-1",title:"步骤一"},{id:"step-2",title:"步骤二"}] },
    { id: "symbols", title: "支线：辨认符号", completion: {mode:"test-only",levelIds:[]},
      steps:[{id:"step-1",title:"步骤一"},{id:"step-2",title:"步骤二"}] },
  ] },
};
const state = { position: { x: 530 }, dialogues: [], tasks: { main: {}, side: {} } };
const checks = [];
const host = new Element("div");
let starts = 0;
let formalStarts = 0;
const create = (place, gameState, chapterData = chapter) => createRoom({
  host: place, chapter: chapterData, state: gameState,
  onSave: async (checkpoint) => { checks.push(checkpoint); },
  onStartDemo: async () => { starts++; },
  onStartLevel: async () => { formalStarts++; }, onExit: async () => {},
  onError: (e) => { throw e; },
});
const dispose = create(host, state);
await find(host, "与 NPC 交互").click();
const line = host.querySelectorAll("p").find((p) => p.className === "npc-dialogue-line");
assert.ok(line, "NPC dialogue line must exist in the new panel");
assert.equal(line.textContent, "");
assert.ok(buttonLabels(host).includes("接取任务"), "Options must be present immediately, before the line finishes");
const previousX = state.position.x;
await find(host, "向右").click();
assert.equal(state.position.x, previousX, "Movement must freeze during dialogue");
await sleep(75);
assert.ok(line.textContent.length > 0 && line.textContent.length < chapter.npcLine.length);
key("Space");
assert.equal(line.textContent, chapter.npcLine, "Space must immediately finish the sentence");
assert.notEqual(state.tasks.main.status, "accepted", "Space must finish the line without accepting a quest");
await sleep(190);
assert.deepEqual(host.querySelectorAll("button")
  .filter((button) => String(button.className || "").includes("npc-dialogue-option"))
  .map((button) => button.textContent), [
  "接取任务", "整理器具", "辨认符号", "结束对话",
]);
key("ArrowDown");
assert.equal(document.activeElement.textContent, "整理器具");
key("Enter");
await sleep(0);
assert.equal(state.tasks.side.tools.status, "accepted");
assert.ok(buttonLabels(host).includes("步骤一（测试）"));
assert.equal(line.textContent, chapter.npcLine, "Task refresh must not replay the NPC line");
await find(host, "接取任务").click();
assert.equal(state.tasks.main.status, "accepted");
assert.ok(buttonLabels(host).includes("进入电路关卡"));
assert.ok(checks.includes("side_tools_completed") === false);
assert.ok(checks.includes("quest_tools_accepted"));
assert.ok(checks.includes("quest_main_accepted"));
key("Escape");
await find(host, "向右").click();
assert.equal(state.position.x, previousX + 45, "Movement must resume after closing");
assert.ok(state.dialogues.includes("npc_first_interaction"));
const persistentState = JSON.parse(JSON.stringify(state));
dispose();

// 已读对话和任务保存在原有 JSON state 中；重开房间不会重复“首次对话”。
const host2 = new Element("div");
const reopened = create(host2, persistentState);
await find(host2, "与 NPC 交互").click();
key("KeyE");
await sleep(175);
assert.equal(persistentState.tasks.main.status, "accepted");
assert.ok(buttonLabels(host2).includes("进入电路关卡"));
assert.equal(checks.filter((x) => x === "npc_first_dialogue").length, 1);
await find(host2, "进入电路关卡").click();
assert.equal(formalStarts, 1, "接取后必须进入四关选择页，而非虚假成绩插件");
assert.equal(starts, 0, "不应进入旧模拟成绩占位页");
assert.ok(!buttonLabels(host2).includes("结束对话"));
reopened();

// Demo 已完成但还没有交付时，必须出现正式电路入口而不是默认重开 Demo。
const completedState = JSON.parse(JSON.stringify(persistentState));
completedState.tasks.main.status = "completed";
const completedHost = new Element("div");
const closeCompleted = create(completedHost, completedState);
await find(completedHost, "与 NPC 交互").click();
key("Space");
assert.ok(buttonLabels(completedHost).includes("进入电路关卡"));
await find(completedHost, "进入电路关卡").click();
assert.equal(formalStarts, 2, "已完成任务也必须进入四关选择页");
closeCompleted();

// 已交付主线的旧存档也应直接允许继续正式实验，且能重温剧情 Demo。
const submittedState = JSON.parse(JSON.stringify(persistentState));
submittedState.tasks.main.status = "submitted";
const submittedHost = new Element("div");
const closeSubmitted = create(submittedHost, submittedState);
await find(submittedHost, "与 NPC 交互").click();
key("Space");
assert.ok(!buttonLabels(submittedHost).includes("重新选择演示关卡"));
await find(submittedHost, "进入电路关卡").click();
assert.equal(formalStarts, 3, "已交付任务应仍可进入四关选择页");
closeSubmitted();

// 没有任务也没有台词时，仅出现“结束对话”；销毁后不再执行打字回调。
const host3 = new Element("div");
const emptyRoom = create(host3, { position: { x: 530 }, dialogues: [], tasks: {} }, {
  id: "empty", room: "空房间", npc: "守卫", npcLine: "", quests: { main: null, side: [] },
});
await find(host3, "与 NPC 交互").click();
assert.equal(buttonLabels(host3).filter((x) => x === "结束对话").length, 1);
assert.ok(!host3.querySelectorAll("p").some((p) => p.className === "npc-dialogue-line"));
emptyRoom();

const host4 = new Element("div");
const disposeHalfLine = create(host4, { position: { x: 530 }, dialogues: [], tasks: {} });
await find(host4, "与 NPC 交互").click();
await sleep(45);
const partial = host4.querySelectorAll("p").find((p) => p.className === "npc-dialogue-line");
disposeHalfLine();
const frozenText = partial.textContent;
await sleep(110);
assert.equal(partial.textContent, frozenText, "Dispose must cancel pending typewriter callbacks");
assert.equal(listeners.keydown.length, 0, "Dispose must remove window key listeners");

// 从旧 1400 宽房间迁移的存档，如果超出 1024，应按比例转入同学新场景。
const oldSave = {position:{x:1200},dialogues:[],tasks:{}};
const oldHost = new Element("div");
const closeOld = create(oldHost, oldSave, {
  id:"ch1",room:"旧存档位置测试",npc:"工匠",npcLine:"",quests:{main:null,side:[]}
});
assert.ok(oldSave.position.x > 800 && oldSave.position.x < 900);
closeOld();
// Failed saves must not advance quest state in memory; a subsequent click can retry.
const failedHost = new Element("div");
const failedState = {position:{x:530},dialogues:[],tasks:{}};
let failOnce = true;
let errorCount = 0;
const stopFailedRoom = createRoom({
  host:failedHost, chapter, state:failedState,
  onSave: async checkpoint => {
    if (checkpoint === "quest_main_accepted" && failOnce) {
      failOnce = false;
      throw new Error("simulated progress save failure");
    }
  },
  onStartLevel:async()=>{},onExit:async()=>{},
  onError:()=>{errorCount++;},
});
await find(failedHost,"与 NPC 交互").click();
await find(failedHost,"接取任务").click();
assert.equal(errorCount,1);
assert.equal(failedState.tasks.main.status,"not-accepted");
await find(failedHost,"接取任务").click();
assert.equal(failedState.tasks.main.status,"accepted");
stopFailedRoom();
// Malformed optional fields in an old save must not crash the room on entry.
const malformed = {position:{x:530},inventory:{},dialogues:"bad",
  flags:["wrong"],circuits:null,code:42,tasks:{main:{},side:[]}};
const malformedHost=new Element("div");
const stopMalformed=create(malformedHost,malformed);
assert.ok(Array.isArray(malformed.dialogues));
assert.ok(Array.isArray(malformed.inventory));
assert.ok(!Array.isArray(malformed.flags) && typeof malformed.flags==="object");
assert.equal(typeof malformed.tasks.side,"object");
assert.ok(!Array.isArray(malformed.tasks.side));
assert.equal(malformed.code,"");
stopMalformed();
console.log("NPC dialogue smoke passed: story demo/formal routing, state persistence, coordinate fallback, save rollback, malformed save handling.");
