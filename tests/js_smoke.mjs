/*
 * 可选前端逻辑冒烟：node tests/js_smoke.mjs
 * 使用最小 DOM 假实现测试按钮状态与任务流，不要求安装npm包。
 */
import assert from "node:assert/strict";
import { mount } from "./fixtures/legacy-demo.mjs";
import { createRoom } from "../public/room.js";
import { randomInt, clientUUID } from "../public/random.js";

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.textContent = "";
    this.disabled = false;
    this.handlers = {};
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(event, listener) {
    this.handlers[event] ??= [];
    this.handlers[event].push(listener);
  }
  removeEventListener(event, listener) {
    this.handlers[event] = (this.handlers[event] || []).filter((h) => h !== listener);
  }
  setAttribute() {}
  querySelectorAll(tag) {
    const matching = [];
    for (const child of this.children) {
      if (child.tagName === tag.toUpperCase()) matching.push(child);
      matching.push(...child.querySelectorAll(tag));
    }
    return matching;
  }
  getContext() {
    return {
      clearRect() {}, strokeRect() {}, fillRect() {},
      beginPath() {}, moveTo() {}, lineTo() {},
      stroke() {}, fillText() {},
    };
  }
  async click() {
    if (this.disabled) throw new Error("Click on disabled control");
    for (const listener of this.handlers.click || []) await listener();
  }
}
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  activeElement: null,
};
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

function findButton(element, text) {
  const found = element.querySelectorAll("button").find(
    (x) => x.textContent === text
  );
  assert.ok(found, `Button not found: ${text}`);
  return found;
}

const quests = {
  main: { id: "main", title: "主线：工坊委托" },
  side: [
    { id: "tools", title: "支线：整理器具", completion: {mode:"test-only",levelIds:[]},
      steps:[{id:"step-1",title:"步骤一"},{id:"step-2",title:"步骤二"}] },
    { id: "symbols", title: "支线：辨认符号", completion: {mode:"test-only",levelIds:[]},
      steps:[{id:"step-1",title:"步骤一"},{id:"step-2",title:"步骤二"}] },
  ],
};
const state = {
  schemaVersion: 2, roomId: "ch1-room",
  position: { x: 180 }, inventory: [], dialogues: [],
  tasks: { main: { status: "not-accepted" }, side: {} },
  flags: {}, circuits: {}, code: "",
};
const roomContainer = new FakeElement("div");
let progressWrites = 0;
let levelStarts = 0;
const dispose = createRoom({
  host: roomContainer,
  chapter: { id: "ch1", room: "夏工坊", npc: "工匠", quests },
  state,
  onSave: async () => { progressWrites += 1; },
  onStartLevel: async () => { levelStarts += 1; },
  onExit: async () => {},
  onError: (error) => { throw error; },
});
for (let i = 0; i < 8; i++) await findButton(roomContainer, "向右").click();
assert.ok(state.position.x > 500);
await findButton(roomContainer, "与 NPC 交互").click();
await findButton(roomContainer, "接取任务").click();
assert.equal(state.tasks.main.status, "accepted");
await findButton(roomContainer, "整理器具").click();
assert.equal(state.tasks.side.tools.status, "accepted");
assert.equal(state.tasks.side.symbols.status, "not-accepted");
await findButton(roomContainer, "步骤一（测试）").click();
assert.equal(state.tasks.side.tools.steps["step-1"].status, "done");
assert.equal(state.tasks.side.tools.status, "accepted");
await findButton(roomContainer, "步骤二（测试）").click();
assert.equal(state.tasks.side.tools.status, "completed");
await findButton(roomContainer, "交付 · 整理器具").click();
assert.equal(state.tasks.side.tools.status, "submitted");
await findButton(roomContainer, "进入电路关卡").click();
assert.equal(levelStarts, 1);
dispose();

let scoreSubmissions = 0;
let mainHomeExits = 0;
let smallMapExits = 0;
let issuedCount = 0;
let lastScore = null;
let unsavedDraft = false;
const pluginContainer = new FakeElement("div");
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
let timersCreated = 0;
let timersCleared = 0;
globalThis.setInterval = (...args) => {
  timersCreated++;
  return originalSetInterval(...args);
};
globalThis.clearInterval = (handle) => {
  timersCleared++;
  originalClearInterval(handle);
};
const pluginCleanup = await mount({
  container: pluginContainer,
  state,
  setUnsavedChanges: (dirty) => { unsavedDraft = dirty; },
  startAttempt: async () => {
    issuedCount++;
    return "issued-from-server-0001";
  },
  saveProgress: async () => { progressWrites += 1; },
  submitScore: async (result) => {
    scoreSubmissions += 1;
    lastScore = result;
    return { score: { score: result.score }, created: true };
  },
  exit: async () => { smallMapExits++; },
  exitToHome: async () => { mainHomeExits++; },
});
assert.ok(
  !pluginContainer.querySelectorAll("p").some((x) => x.textContent.includes("本次进入电路关卡：")),
  "Student UI must not show a live timer"
);
assert.equal(unsavedDraft,false,"A newly opened level is clean");
await findButton(pluginContainer, "生成随机演示结果").click();
assert.equal(unsavedDraft,true,"Generated but unsaved result is dirty");
assert.equal(scoreSubmissions, 0);
await findButton(pluginContainer, "重试（重新生成）").click();
assert.equal(scoreSubmissions, 0, "Retry must not save");
assert.equal(issuedCount, 0, "Retries must not issue attempts either");
await findButton(pluginContainer, "保存结果").click();
assert.equal(unsavedDraft,false,"Fully saved result is clean again");
assert.equal(issuedCount, 1, "Saving result must first request server-issued attempt");
assert.equal(scoreSubmissions, 1);
assert.equal(lastScore.attemptId, "issued-from-server-0001");
assert.equal(lastScore.score,0,"Legacy demo uses an internal zero placeholder, never a 1–100 grade");
assert.equal(lastScore.details.passedCount,4);
assert.equal(lastScore.details.totalCount,4);
assert.equal(lastScore.details.unit,"组");
assert.ok(!("durationSeconds" in lastScore.details),
  "Demo must no longer generate or save completion time spent");
assert.equal(lastScore.details.mock,true);
assert.equal(state.tasks.main.status, "completed");
assert.equal(state.tasks.side.tools.status, "submitted");
assert.ok(progressWrites > 0);
assert.ok(
  pluginContainer.querySelectorAll("button").every(
    (item) => item.textContent !== "生成随机演示结果"
  ),
  "Successful result must no longer show a generate button"
);
assert.equal(typeof pluginCleanup, "function");
await findButton(pluginContainer, "返回主界面").click();
assert.equal(mainHomeExits, 1, "Chapter exposes a direct main-menu exit");
pluginCleanup();
const secondContainer = new FakeElement("div");
const secondCleanup = await mount({
  container: secondContainer,
  state: { flags: {}, tasks: { main: { status: "accepted" }, side: {} } },
  setUnsavedChanges: (dirty) => { unsavedDraft = dirty; },
  startAttempt: async () => { throw new Error("No save expected"); },
  saveProgress: async () => { throw new Error("No save expected"); },
  submitScore: async () => { throw new Error("No score expected"); },
  exit: async () => { smallMapExits++; },
  exitToHome: async () => { mainHomeExits++; },
});
await findButton(secondContainer, "生成随机演示结果").click();
assert.equal(unsavedDraft,true,"Second level's unsaved result is dirty");
await findButton(secondContainer, "返回小地图").click();
assert.equal(smallMapExits, 1, "Chapter exposes a small-map exit");
secondCleanup();
assert.equal(timersCreated, 0, "Student demo should not start a live timer");
assert.equal(timersCleared, 0, "No hidden live timer should remain");
assert.equal(pluginContainer.querySelectorAll("button").every((button) =>
  (button.handlers.click || []).length === 0), true, "Plugin event listeners removed");
globalThis.setInterval = originalSetInterval;
globalThis.clearInterval = originalClearInterval;

// Simulate browser insecure LAN context: crypto.randomUUID and getRandomValues absent.
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
try {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true, value: undefined,
  });
  const result = randomInt(1, 5);
  assert.ok(result >= 1 && result <= 5);
  assert.match(clientUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
} finally {
  if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
  else delete globalThis.crypto;
}
console.log("JS smoke passed: room tasks, result save, no timer, main-menu exit, cleanup, insecure LAN fallback.");
