/* ZSHXJ QUEST NAVIGATION V2 */
/* 学生游戏入口：身份认证、章节导航、进度保存与个人成绩。 */
import { cloudDescend } from "./transition.js";
import {
  api, hasToken, setToken, clearToken, getAuthSnapshot, isAuthSnapshotCurrent,
  downloadCsv, asBase64,
} from "./api.js";
import { createRoom } from "./room.js";
import { createPannableMap } from "./map-viewport.js";
import { mountNavigationPath } from "./navigation-path.js";
import { normalizeQuestCollection, changeQuestStatus,
         questPrerequisitesSatisfied } from "./task-model.js";
import {isWorkshopQuest, workshopProgressWithPass} from './workshop-quest.js';
import {syncFlowOfficialPass} from './quest-flow.js';
import {resolveQuestDestination} from './quest-navigation.js';
import {makeQuestReturnContext, readQuestReturnContext,
        resolveReturnLocation} from './quest-return-context.js';
import { createProgressSaveQueue, SessionChangedError } from "./progress-save-queue.js";
import { mergeRevisionedProgress, StaleOperationError } from "./progress-read-guard.js";
import { renderAdmin, renderTeacher } from "./management.js";
import { alertDialog, confirmDialog } from "./dialog.js";
const root = document.getElementById("app");
// Shared UI requests keep the existing app router and callbacks.
window.addEventListener("zshxj:ui-home-request", () => showHome());
window.addEventListener("zshxj:ui-settings-request", () => showSettings());

let me = null;
let chapters = [];
let characters = {};
let roomDispose = null;
let mapDispose = null;
let activePlugin = null;
const saved = new Map();
let gameProfile = { balance: 0, inventory: {} };
// Every page replacement invalidates asynchronous work started by older pages.
let viewGeneration = 0;
// A pending route request must not invalidate the page currently on screen.
let navigationGeneration = 0;
function beginNavigation() {
  return {request:++navigationGeneration, view:viewGeneration};
}
function stillNavigating(navigation, session) {
  return navigation.request === navigationGeneration &&
    navigation.view === viewGeneration && isAuthSnapshotCurrent(session);
}
// Overlapping progress reads must not let the oldest response win.
let gameLoadGeneration = 0;
let savedWriteGeneration = 0;
const stillOnView = (generation, session) =>
  viewGeneration === generation && isAuthSnapshotCurrent(session);

function cleanupPlugin() {
  const active = activePlugin;
  if (!active) return;
  activePlugin = null;
  active.controller.abort();
  if (active.dispose) {
    try { active.dispose(); } catch (error) {
      console.error("章节清理失败：", error);
    }
  }
}
const progressQueue = createProgressSaveQueue({
  getSession:getAuthSnapshot,
  isCurrentSession:isAuthSnapshotCurrent,
  getProgress:chapterId => saved.get(chapterId),
  setProgress:(chapterId, progress) => {
    saved.set(chapterId, progress);
    savedWriteGeneration += 1;
  },
  sendProgress:(chapterId, payload, authToken) =>
    api("PUT", `/api/progress/${encodeURIComponent(chapterId)}`, payload, {authToken}),
  copy,
});
function el(tag, text, parent) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (parent) parent.append(item);
  return item;
}
function button(label, parent, onClick) {
  const item = el("button", label, parent);
  item.type = "button";
  if (/^(删除|停用|归档|移出)/.test(label)) item.className = "button--danger";
  item.addEventListener("click", async () => {
    item.disabled = true;
    try { await onClick(); } catch (error) { await showError(error); }
    finally { item.disabled = false; }
  });
  return item;
}
function textField(parent, title, type = "text", required = true) {
  const label = el("label", title + "：", parent);
  const field = el("input", undefined, label);
  field.type = type;
  field.required = required;
  if (type === "password") {
    field.minLength = 8;
    field.maxLength = 128;
  }
  return field;
}
function page(title, skin = "general") {
  viewGeneration += 1;
  navigationGeneration += 1; // invalidate pending routes when page truly changes
  cleanupPlugin();
  if (roomDispose) { roomDispose(); roomDispose = null; }
  if (mapDispose) { mapDispose(); mapDispose = null; }
  root.replaceChildren();
  // Only add presentation classes; preserve DOM order and existing behavior.
  root.className = `page page--${skin}`;
  if (skin === "scores" || skin === "leaderboard") return root;
  const heading = el("h2", title, root);
  heading.className = "page-title";
  if (!["landing", "auth", "home", "placeholder", "settings"].includes(skin)) {
    const brand = el("button", "铸算 · 华夏纪", heading);
    brand.type = "button";
    brand.className = "brand-link";
    brand.title = "返回主界面";
    brand.addEventListener("click", () => {
      // Formal circuit editor can veto accidental navigation with unsaved work.
      if (activePlugin?.canLeave && !activePlugin.canLeave()) return;
      showHome();
    });
    if (heading.firstChild) heading.insertBefore(brand, heading.firstChild);
  }
  return root;
}
function copy(item) { return JSON.parse(JSON.stringify(item)); }
async function showError(error) {
  // A queued operation invalidated by logout belongs to an obsolete screen.
  if (error?.code === "SESSION_CHANGED" || error?.code === "STALE_OPERATION") return;
  if (error.code === "REVISION_CONFLICT") {
    await alertDialog("存档版本冲突：另一页面更新了存档。请刷新页面后重试。");
  } else if (error.code === "PASSWORD_SETUP_REQUIRED") {
    clearToken();
    me = null;
    showAuth();
  } else {
    await alertDialog(error.message || "操作失败");
  }
}
function requireChapter(id) {
  const found = chapters.find((item) => item.id === id);
  if (!found) throw new Error("章节不存在");
  return found;
}
async function loadGame() {
  const session = getAuthSnapshot();
  const role = me?.role;
  const readGeneration = ++gameLoadGeneration;
  const writtenBeforeRead = savedWriteGeneration;
  // Teachers need chapter titles for instructional filters, not personal progress.
  if (role === "admin") {
    chapters = [];
    saved.clear();
    return;
  }
  const boundGet = path => api("GET", path, undefined, {authToken:session.token});
  let chapterReply, progressReply, profileReply, characterReply, storyReply;
  try {
    [chapterReply, progressReply, profileReply, characterReply, storyReply] = await Promise.all([
      boundGet("/api/chapters"),
      role === "student" ? boundGet("/api/progress") : Promise.resolve({ progress: [] }),
      role === "student" ? boundGet("/api/game/profile").catch(() => ({ balance: 0, inventory: {} })) : Promise.resolve({ balance: 0, inventory: {} }),
      boundGet("/story/characters.json"),
      boundGet("/story/ch1.json"),
    ]);
  } catch (error) {
    if (!isAuthSnapshotCurrent(session)) throw new SessionChangedError();
    if (readGeneration !== gameLoadGeneration) throw new StaleOperationError();
    throw error;
  }
  // A previous account's delayed GET results must never clear/replace the
  // currently logged-in account's chapter, wallet or progress data.
  if (!isAuthSnapshotCurrent(session)) throw new SessionChangedError();
  // A GET may finish while an earlier PUT is still queued or in flight.
  // Let already queued writes finish before reconciling the response.
  await progressQueue.whenIdle(null, session);
  if (!isAuthSnapshotCurrent(session)) throw new SessionChangedError();
  // A slower previous load must not publish after a more recent load.
  if (readGeneration !== gameLoadGeneration) throw new StaleOperationError();
  // Static chapter content joins the original room route; no server reload or
  // alternate preview is required. Authored server dialogues take precedence.
  const locations = new Map(storyReply.locations.map(item => [item.id, item]));
  chapters = chapterReply.chapters.map(chapter => {
    if (chapter.id !== storyReply.chapterId) return chapter;
    const configured = {...chapter, questTargets: chapter.questTargets ?? storyReply.questTargets ?? {}};
    if (chapter.dialogues?.length) return configured;
    return {...configured, dialogues: storyReply.dialogues,
      locations: (chapter.locations || []).map(location => ({...location, ...locations.get(location.id)}))};
  });
  characters = Object.fromEntries([
    ...storyReply.characters, ...(characterReply.characters || []),
  ].map(item => [item.id, item]));
  // A score or quest save made while the GET was pending may also update
  // profile/rewards. Do not overwrite newer profile data with an older GET.
  if (savedWriteGeneration === writtenBeforeRead) gameProfile = profileReply;
  mergeRevisionedProgress(saved, progressReply.progress);
}
function defaultState(chapterId) {
  return {
    schemaVersion: 2,
    roomId: `${chapterId}-room`,
    position: { x: 180 },
    inventory: [],
    dialogues: [],
    tasks: normalizeQuestCollection(null, chapters.find(item => item.id === chapterId)?.quests),
    flags: {},
    circuits: {},
    code: "",
  };
}
function saveChapter(chapterId, state, checkpoint, ownerSession = getAuthSnapshot()) {
  // A room/editor passes the session captured when it was created. A delayed
  // callback from A cannot turn into a new B write just by starting late.
  return progressQueue.save(chapterId, state, checkpoint, ownerSession);
}
/** 进入屏只负责视觉和导航；不参与账号认证。 */
function showLanding() {
  page("铸算 · 华夏纪", "landing");
  const enter = button("点击进入游戏", root, () => {
    if (me) showHome();
    else showAuth("login");
  });
  enter.className = "landing-enter";
}
function showAuth(mode = "login") {
  page(mode === "login" ? "登录" : "注册", "auth");
  root.setAttribute("data-auth-mode", mode);
  const form = el("form", undefined, root);
  const account = textField(form, "账号");
  account.minLength = 3;
  account.maxLength = 32;
  account.autocomplete = "username";
  const password = textField(form, "密码", "password");
  password.autocomplete = mode === "register" ? "new-password" : "current-password";
  if (mode === "login") password.required = false;
  const name = mode === "register" ? textField(form, "姓名/显示名") : null;
  if (name) name.maxLength = 40;
  const submit = el("button", mode === "register" ? "注册" : "登录", form);
  submit.type = "submit";
  const message = el("p", "", root);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const authView = viewGeneration;
    submit.disabled = true;
    try {
      const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body = { username: account.value, password: password.value };
      if (name) body.displayName = name.value;
      const reply = await api("POST", path, body);
      if (viewGeneration !== authView) return;
      if (reply.setupRequired) {
        showSetupPassword(reply.setupToken, reply.username);
        return;
      }
      setToken(reply.token);
      progressQueue.invalidatePending();
      me = reply.user;
      const loginSession = getAuthSnapshot();
      await loadGame();
      if (!stillOnView(authView, loginSession)) return;
      showHome();
    } catch (error) {
      if (viewGeneration === authView &&
          !['SESSION_CHANGED', 'STALE_OPERATION'].includes(error?.code)) {
        message.textContent = error.message;
      }
    } finally {
      submit.disabled = false;
    }
  });
  const actions = el("nav", undefined, root);
  actions.className = "auth-secondary-actions";
  actions.setAttribute("aria-label", "账号操作");
  button(mode === "login" ? "注册" : "返回登录", actions, () => {
    showAuth(mode === "login" ? "register" : "login");
  });
  if (mode === "login") button("返回", actions, showLanding);
  if (mode === "register") {
    el("p", "此处为自主练习账号注册。班级学生账号由教师批量导入。", root);
  } else {
    el("p", "班级学生首次登录或教师重置后：只填写10位学号，密码留空，登录后设置新密码。", root);
  }
}
function showSetupPassword(setupToken, username) {
  page("学生设置登录密码", "auth");
  root.setAttribute("data-auth-mode", "setup");
  el("p", `学号：${username}。不需要输入旧密码。`, root);
  const form = el("form", undefined, root);
  const newPassword = textField(form, "新密码", "password");
  newPassword.autocomplete = "new-password";
  const repeat = textField(form, "确认新密码", "password");
  repeat.autocomplete = "new-password";
  const submit = el("button", "设置并进入游戏", form);
  submit.type = "submit";
  const message = el("p", "", root);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const authView = viewGeneration;
    if (newPassword.value !== repeat.value) {
      message.textContent = "两次输入的密码不一致";
      return;
    }
    submit.disabled = true;
    try {
      const reply = await api("POST", "/api/auth/setup-password", {
        setupToken, newPassword: newPassword.value,
      });
      if (viewGeneration !== authView) return;
      setToken(reply.token);
      progressQueue.invalidatePending();
      me = reply.user;
      const loginSession = getAuthSnapshot();
      await loadGame();
      if (!stillOnView(authView, loginSession)) return;
      showHome();
    } catch (error) {
      if (viewGeneration === authView &&
          !['SESSION_CHANGED', 'STALE_OPERATION'].includes(error?.code)) {
        message.textContent = error.message;
      }
    } finally {
      submit.disabled = false;
    }
  });
  button("返回登录", root, () => showAuth());
}
async function logout() {
  const oldSession = getAuthSnapshot();
  // Invalidate queued operations *before* any network wait. A slow logout
  // must not let A's pending save use a B login session.
  clearToken();
  progressQueue.invalidatePending();
  me = null;
  chapters = [];
  characters = {};
  gameProfile = {balance:0, inventory:{}};
  saved.clear();
  showLanding();
  // Sign out the original token only: never accidentally log out a newer B.
  try {
    if (oldSession.token) {
      await api("POST", "/api/auth/logout", {}, {authToken:oldSession.token});
    }
  } catch (_) { /* 已在本机立即注销；旧令牌的网络错误不影响新账号 */ }
}

function managementContext() {
  return {
    api, root, page,
    home: showHome,
    logout, downloadCsv, asBase64,
    chapters,
  };
}
function showHome() {
  if (me?.role === "admin") return renderAdmin(managementContext(), "overview");
  page("主界面", "home");
  const role = { student: "学生", teacher: "教师", admin: "管理员" }[me.role] || me.role;
  el("p", `${me.displayName}（${role}）`, root);
  if (me.role === "student") {
    const progressCount = Object.values(gameProfile.inventory || {}).flat().length;
    const completedLevels = gameProfile.rewards?.filter(r => r.key.startsWith("level:") && r.chapterId === "ch1").length || 0;
    const summary = el("div", undefined, root); summary.className = "home-game-summary";
    el("span", `第一章 · 正式关卡已完成 ${completedLevels}/4`, summary);
    el("strong", `铜钱 ${gameProfile.balance || 0}`, summary);
    el("small", `已收集器物 ${progressCount}`, summary);
    button("开始", root, showMap);
    button("成绩", root, showMyScores);
    button("成就", root, () => showPlaceholder("成就"));
  }
  button("排行榜", root, () => showLeaderboard());
  button("设置", root, showSettings);
  if (me.role === "teacher") button("教学管理", root, () => renderTeacher(managementContext(), "students"));
  button("退出登录", root, logout);
}
/**
 * 成绩与排行共用独立顶栏：标题仅一处，左上并列“返回 / 菜单”。
 * 返回使用来源界面的回调；菜单总是返回主界面。
 */
function renderResultsHeader(label, returnTo = showHome) {
  const header = el("header", undefined, root);
  header.className = "results-header";
  const nav = el("nav", undefined, header);
  nav.className = "results-header-actions";
  nav.setAttribute("aria-label", "页面导航");
  button("返回", nav, returnTo).className = "results-header-button";
  button("菜单", nav, showHome).className = "results-header-button";
  el("h1", label, header).className = "results-page-title";
}
/** 排行榜业务未接入：只保留真实的列标题与未开放说明。 */
function showLeaderboard(returnTo = showHome) {
  page("", "leaderboard");
  renderResultsHeader("排行", returnTo);

  // The board is actual user artwork, not a synthetic box over a placeholder.
  const board = el("section", undefined, root);
  board.className = "leaderboard-board";
  board.setAttribute("aria-label", "排行榜");

  const content = el("div", undefined, board);
  content.className = "leaderboard-content";
  // A native table makes the future ranking fields accessible without adding
  // background blocks, fake entries, or temporary test rows.
  const table = el("table", undefined, content);
  table.className = "leaderboard-table";
  table.setAttribute("aria-label", "排行榜记录");
  const header = el("thead", undefined, table);
  const headerRow = el("tr", undefined, header);
  ["名次", "玩家", "已完成关卡", "提交次数", "最后完成"].forEach((label) => {
    const cell = el("th", label, headerRow);
    cell.scope = "col";
  });
  el("tbody", undefined, table);
  const empty = el("div", undefined, content);
  empty.className = "leaderboard-empty";
  el("h2", "静候揭榜", empty).className = "leaderboard-empty-title";
  el("p", "排行榜功能尚未开放。", empty).className = "leaderboard-empty-copy";
}
function showPlaceholder(title) {
  if (title === "排行榜") return showLeaderboard();
  page(title, "placeholder"); el("p", "待开发", root); button("返回主界面", root, showHome);
}
function showSettings() {
  page("设置", "settings"); el("p", "设置选项暂未开放。", root); button("返回主界面", root, showHome);
}
/* Map landmarks are image-relative points. 0..1 coordinates keep city
   buttons attached to the actual artwork at every zoom and viewport size. */
const MAP_LANDMARKS = Object.freeze({
  cityCenter: Object.freeze({x: .806, y: .568}),
  cityGate: Object.freeze({x: .498, y: .458}),
});
/** Map pages are true replacement scenes: never render the former header,
 * framed map card, explanatory text or footer from previous prototypes. */
function mountMapScene({type, source, width, height, marker, back, backLabel, focus}) {
  const label = type === 'world' ? '大地图' : '小地图';
  page(label, `map map--${type}`);
  // A map has the same semantic header and controls as a room, rather than
  // a generic page heading or a floating old-style map HUD.
  root.querySelector('.page-title')?.remove();
  const topbar = el('header', undefined, root);
  topbar.className = 'room-topbar';
  const brand = button('铸算 · 华夏纪', topbar, showHome);
  brand.className = 'room-brand';
  mountNavigationPath(topbar, type, (destination) => {
    if (destination === 'world') cloudDescend(showMap, {
      enter: {el: () => document.querySelector('.map-camera-scene'), from: 0.94},
    });
  });
  const wallet = el('strong', undefined, topbar);
  wallet.className = 'room-wallet';
  const coin = el('img', undefined, wallet);
  coin.className = 'room-wallet-coin';
  coin.src = '/assets/room/bronze-coin.png';
  coin.alt = '';
  coin.setAttribute('aria-hidden', 'true');
  el('span', '铜钱', wallet).className = 'room-wallet-sr';
  el('span', String(gameProfile.balance || 0), wallet);
  const backButton = button(backLabel, topbar, back);
  backButton.className = 'room-top-action';
  button('设置', topbar, showSettings).className = 'room-top-action';
  mapDispose = createPannableMap({
    host: root, imageUrl: source, width, height, alt: label,
    focus, markers: [marker],
  }).dispose;
}
function showMap() {
  mountMapScene({
    type: 'world', source: '/assets/scenes/world-map-grand.png',
    width: 2048, height: 1152,
    // Coordinates refer to the source image, not the browser viewport.
    marker: {label: '进入地图', className:'scene-gate--world-entry',
      ...MAP_LANDMARKS.cityCenter, ariaLabel:'进入城市中心',
      onActivate: () => cloudDescend(() => showChapterMap('ch1'), {
        exit: {el: () => document.querySelector('.map-camera-scene'),
               origin: `${MAP_LANDMARKS.cityCenter.x * 100}% ${MAP_LANDMARKS.cityCenter.y * 100}%`, to: 1.45},
        fade: () => [...document.querySelectorAll('.scene-gate, .room-topbar')],
        enter: {el: () => document.querySelector('.map-camera-scene'), from: 0.94},
      })},
    focus: {x: window.innerWidth < 600 ? MAP_LANDMARKS.cityCenter.x : .7,
            y: MAP_LANDMARKS.cityCenter.y},
    back: showHome, backLabel: '返回主界面',
  });
}
function chapterState(chapterId) { return saved.get(chapterId)?.state || defaultState(chapterId); }
function locationUnlocked(chapter, location, index) {
  return Boolean(chapter.implemented && chapter.canEnter && index === 0);
}
function showChapterMap(chapterId) {
  const chapter = requireChapter(chapterId);
  const location = (chapter.locations || [])[0];
  // Preserve a navigable empty-state for chapters without a room.
  if (!location) {
    page(chapter.spaceTitle || `第${chapter.order}章`, 'map-empty');
    el('p', '暂无地图', root);
    button('返回大地图', root, showMap);
    return;
  }
  mountMapScene({
    type: 'chapter', source: '/assets/scenes/chapter-city-map.png',
    width: 1672, height: 941,
    marker: {label: '进入房间', className:'scene-gate--chapter-entry',
      ...MAP_LANDMARKS.cityGate, ariaLabel:`通过城门进入${location.name || '房间'}`,
      onActivate: () => cloudDescend(() => showRoom(chapterId, location.id), {
        exit: {el: () => document.querySelector('.map-camera-scene'),
               origin: `${MAP_LANDMARKS.cityGate.x * 100}% ${MAP_LANDMARKS.cityGate.y * 100}%`, to: 1.45},
        fade: () => [...document.querySelectorAll('.scene-gate, .room-topbar')],
        enter: {el: () => document.querySelector('.room-stage'), from: 0.95, hold: 0.35},
      })},
    focus: MAP_LANDMARKS.cityGate, back: () => cloudDescend(showMap, {
      enter: {el: () => document.querySelector('.map-camera-scene'), from: 0.94},
    }), backLabel:'返回大地图',
  });
}
async function showRoom(chapterId, locationId = null, resumeContext = null) {
  const roomSession = getAuthSnapshot();
  // Register a pending room route, leaving the current visible page active.
  const navigation = beginNavigation();
  const chapter = requireChapter(chapterId);
  if (!chapter.canEnter || !chapter.implemented) throw new Error("当前章节未开发");
  // Use committed progress for the initial score check, even if the previous
  // room/editor has a draft write still waiting in the queue.
  await progressQueue.whenIdle(chapterId, roomSession);
  if (!stillNavigating(navigation, roomSession)) return;
  // Re-entering from the map or after a previous session must reconcile passes
  // too. A temporary result-service failure leaves the exercise available.
  try { await syncFirstCircuitQuestCompletion(chapterId); }
  catch (error) { console.warn('任务成绩暂未同步：', error); }
  if (!stillNavigating(navigation, roomSession)) return;
  await progressQueue.whenIdle(chapterId, roomSession);
  if (!stillNavigating(navigation, roomSession)) return;
  const state = copy(saved.get(chapterId)?.state || defaultState(chapterId));
  const location = (chapter.locations || []).find(item => item.id === locationId) || chapter.locations?.[0];
  if (!location) throw new Error("本章尚无地图数据");
  state.locationId = location.id;
  const roomChapter = {...chapter, npc:location.npc || chapter.npc,
    npcLine:location.npcLine ?? chapter.npcLine, room:location.roomTitle || location.name};
  function reconcileMountedRoomTasks() {
    // Score reconciliation commits only to `saved` (the canonical server
    // snapshot). Keep the *still-visible* room's task state in sync before
    // a subsequent movement/exit save captures its whole-chapter snapshot.
    // Do not overwrite local position, draft circuit data or questReturn.
    if (!stillOnView(roomView, roomSession)) return;
    const committed = saved.get(chapterId)?.state?.tasks;
    if (!committed) return;
    state.tasks = copy(committed);
    roomDispose?.refreshTaskView?.();
  }
  async function exitRoomTo(destination) {
    if (!stillOnView(roomView, roomSession)) return;
    state.flags ??= {};
    state.flags.completedLocations ??= [];
    if (state.tasks?.main?.status === "submitted" &&
        !state.flags.completedLocations.includes(location.id)) {
      state.flags.completedLocations.push(location.id);
    }
    await saveChapter(chapterId, state, "exit_room", roomSession);
    if (!stillOnView(roomView, roomSession)) return;
    await loadGame();
    if (!stillOnView(roomView, roomSession)) return;
    await cloudDescend(() => {
      if (!stillOnView(roomView, roomSession)) return;
      if (destination === 'world') showMap();
      else showChapterMap(chapterId);
    }, {
      enter: {el: () => document.querySelector('.map-camera-scene'), from: 0.94},
    });
  }
  const host = page(`${chapter.spaceTitle || chapter.title} · ${location.name}`, "room");
  const roomView = viewGeneration;
  roomDispose = createRoom({
    returnContext:resumeContext,
    host, chapter: roomChapter, state, location, characters, wallet: gameProfile.balance || 0, inventory: gameProfile.inventory?.[chapterId] || [],
    onSave: async (checkpoint) => {
      if (!stillOnView(roomView, roomSession)) throw new StaleOperationError();
      const result = await saveChapter(chapterId, state, checkpoint, roomSession);
      if (!stillOnView(roomView, roomSession)) throw new StaleOperationError();
      if (checkpoint !== "room_moved" && me?.role === "student") {
        const profile = await api("GET", "/api/game/profile", undefined,
          {authToken:roomSession.token}).catch(() => null);
        if (!stillOnView(roomView, roomSession)) throw new StaleOperationError();
        if (profile) gameProfile = profile;
      }
      return { result, profile: gameProfile };
    },
    onProfileChange: (profile) => {
      if (stillOnView(roomView, roomSession)) gameProfile = profile;
    },
    onGetLevelResults: async () => {
      if (!stillOnView(roomView, roomSession)) throw new StaleOperationError();
      const reply = await api('GET', '/api/circuit/results/mine', undefined,
        {authToken:roomSession.token});
      if (!stillOnView(roomView, roomSession)) throw new StaleOperationError();
      return reply.results || [];
    },
    onHome: showHome,
    onSettings: showSettings,
    onAchievements: () => showPlaceholder("成就"),
    onShop: () => showPlaceholder("商店（敬请期待）"),
    onLeaderboard: async () => {
      // The room already saved checkpoint room_open_ranking behind its quest
      // transaction barrier. A second unsynchronized whole-chapter PUT here
      // could capture another task's optimistic state while profile GET waits.
      if (!stillOnView(roomView, roomSession)) return;
      showLeaderboard(() => showRoom(chapterId, location.id));
    },
    // The room's circuit entrance leads directly to this chapter's first formal
    // circuit. Keep the level-selection page implemented for later reuse.
    onStartLevel: async () => {
      if (!stillOnView(roomView, roomSession)) return;
      const firstLevelId = chapter.levels?.[0]?.id;
      if (!firstLevelId) throw new Error("本章暂无可进入的正式电路关卡");
      state.questReturn = makeQuestReturnContext({
        chapterId, locationId:location.id, levelId:firstLevelId,
        playerX:state.position?.x,
      });
      await saveChapter(chapterId, state, "before_circuit_demo", roomSession);
      if (!stillOnView(roomView, roomSession)) return;
      // A temporary score-service error should not block entry to the editor.
      try { await syncFirstCircuitQuestCompletion(chapterId); }
      catch (error) { console.warn("电路任务进度暂未同步：", error); }
      if (!stillOnView(roomView, roomSession)) return;
      reconcileMountedRoomTasks();
      await showLevel(chapterId, firstLevelId);
    },
    onGoToLevel: async (levelId, navigation = {}) => {
      if (!stillOnView(roomView, roomSession)) return;
      if (!chapter.levels?.some(level => level.id === levelId)) {
        throw new Error('本章没有此电路关卡');
      }
      if (navigation.questId) {
        const quest = [chapter.quests?.main, ...(chapter.quests?.side || [])]
          .find(item => item?.id === navigation.questId);
        const progress = quest === chapter.quests?.main
          ? state.tasks?.main : state.tasks?.side?.[navigation.questId];
        const route = resolveQuestDestination({
          entry:{quest,progress}, chapter, state, locationId:location.id,
          canGoToLevel:true,
        });
        const currentTarget = !route.reason && route.target?.type === 'level' &&
          route.target.id === levelId && route.stepId === navigation.stepId;
        // A completed workshop may be replayed without earning a second reward.
        const replayStep = quest?.steps?.find(step => step.id === navigation.stepId);
        const authorizedReplay = navigation.replay === true && isWorkshopQuest(quest) &&
          ['completed','submitted'].includes(progress?.status) &&
          quest.locationId === location.id &&
          questPrerequisitesSatisfied(chapter, state, quest) &&
          replayStep?.condition?.type === 'level-completed' &&
          replayStep.condition.levelId === levelId &&
          chapter.questTargets?.[quest.id]?.steps?.[replayStep.id]?.id === levelId;
        if (navigation.locationId && navigation.locationId !== location.id ||
            !currentTarget && !authorizedReplay) {
          throw new Error('当前任务、步骤、地点与关卡入口不匹配');
        }
      }
      // Persist the route in the existing chapter JSON before opening editor.
      // No extra database, and no user-supplied quest progress is trusted here.
      const previousReturn = state.questReturn;
      state.questReturn = makeQuestReturnContext({
        chapterId, locationId:location.id, levelId,
        questId:navigation.questId ?? null, stepId:navigation.stepId ?? null,
        playerX:state.position?.x,
      });
      try {
        await saveChapter(chapterId, state, 'before_task_circuit', roomSession);
      } catch (error) {
        state.questReturn = previousReturn;
        throw error;
      }
      if (!stillOnView(roomView, roomSession)) return;
      try { await syncFirstCircuitQuestCompletion(chapterId); }
      catch (error) { console.warn('电路任务进度暂未同步：', error); }
      if (!stillOnView(roomView, roomSession)) return;
      reconcileMountedRoomTasks();
      await showLevel(chapterId, levelId);
    },
    onExit: () => exitRoomTo('chapter'),
    onWorldMap: () => exitRoomTo('world'),
    onError: showError,
  });
  if (!saved.has(chapterId)) {
    try { await saveChapter(chapterId, state, "first_room_enter", roomSession); }
    catch (error) { await showError(error); }
  }
}

// This used to run only while opening the four-level list. Keep the task
// progression independent of that page so hiding it does not disable quests.
async function syncFirstCircuitQuestCompletion(chapterId, resultRows = null) {
  const session = getAuthSnapshot();
  if (!session.token || !isAuthSnapshotCurrent(session)) {
    throw new SessionChangedError();
  }
  const current = saved.get(chapterId)?.state;
  if (!current?.tasks) return;
  const chapter = requireChapter(chapterId);
  const definitions = [chapter.quests?.main, ...(chapter.quests?.side || [])].filter(Boolean);
  const needsScores = definitions.some(quest => {
    const progress = quest === chapter.quests.main
      ? current.tasks.main : current.tasks.side?.[quest.id];
    return quest.completion?.mode === 'official-circuit' &&
      (progress?.status === 'accepted' ||
        isWorkshopQuest(quest) && ['completed', 'submitted'].includes(progress?.status));
  });
  if (!needsScores) return;

  // The result query can take longer than a room/editor save. Fetch with the
  // original login token; never allow a later account to supply the response.
  const rows = resultRows ??
    (await api("GET", "/api/circuit/results/mine", undefined,
      {authToken:session.token})).results ?? [];
  if (!isAuthSnapshotCurrent(session)) throw new SessionChangedError();

  // Serialize *inside* the chapter save queue. Once preceding saves have
  // settled, read the newest saved state and modify tasks only. Do not submit
  // a stale pre-GET copy containing old circuitLevels, position or questReturn.
  return progressQueue.mutateLatest(chapterId, 'official_circuit_tasks_completed', nextState => {
    if (!nextState.tasks) return false;
    let changed = false;
    for (const quest of definitions) {
      const progress = quest === chapter.quests.main
        ? nextState.tasks.main : nextState.tasks.side?.[quest.id];
      if (quest.completion?.mode !== 'official-circuit' ||
          !(progress?.status === 'accepted' ||
            isWorkshopQuest(quest) && ['completed', 'submitted'].includes(progress?.status))) {
        continue;
      }
      if (!questPrerequisitesSatisfied(chapter, nextState, quest)) continue;
      if (quest.completion?.requireAllSteps === true) {
        const updated = isWorkshopQuest(quest)
          ? workshopProgressWithPass(progress, quest, rows)
          : syncFlowOfficialPass(progress, quest, rows);
        if (JSON.stringify(updated) !== JSON.stringify(progress)) {
          if (quest === chapter.quests.main) nextState.tasks.main = updated;
          else nextState.tasks.side[quest.id] = updated;
          changed = true;
        }
        continue; // No ordered quest is completed merely by polling scores.
      }
      const proof = rows.find(row => row.completed === true &&
        row.assessmentType === 'circuit_server' &&
        quest.completion.levelIds.includes(row.levelId));
      if (!proof) continue;
      const completed = changeQuestStatus(progress, 'completed');
      for (const step of quest.steps || []) {
        if (step.condition?.type === 'level-completed' && step.condition.levelId === proof.levelId) {
          completed.steps[step.id] = {...completed.steps[step.id], status:'done',
            updatedAt:completed.updatedAt,
            evidence:{levelId:proof.levelId, assessmentType:'circuit_server'}};
        }
      }
      if (quest === chapter.quests.main) nextState.tasks.main = completed;
      else nextState.tasks.side[quest.id] = completed;
      changed = true;
    }
    return changed;
  }, session);
}

async function showLevel(chapterId, selectedLevelId) {
  const levelSession = getAuthSnapshot();
  // Do not retire the current room before the level GET actually succeeds.
  const navigation = beginNavigation();
  if (!selectedLevelId) {
    throw new Error("正式电路关卡需要有效 ID");
  }
  const chapter = requireChapter(chapterId);
  const selectedLevel = chapter.levels?.find(item => item.id === selectedLevelId);
  let reply;
  try {
    reply = await api("GET", `/api/levels/${encodeURIComponent(selectedLevelId)}`,
      undefined, {authToken:levelSession.token});
  } catch (error) {
    if (!stillNavigating(navigation, levelSession)) return;
    throw error;
  }
  if (!stillNavigating(navigation, levelSession)) return;
  await progressQueue.whenIdle(chapterId, levelSession);
  if (!stillNavigating(navigation, levelSession)) return;
  const spec = reply.level;
  const host = page(
    `${selectedLevel?.lineage || "正式关卡"} · ${selectedLevel?.title || spec.title}`,
    "level circuit-level-page"
  );
  const levelView = viewGeneration;
  const levelState = copy(saved.get(chapterId)?.state || defaultState(chapterId));
  const returnContext = readQuestReturnContext(levelState.questReturn, {
    chapterId, levelId:selectedLevelId, locations:chapter.locations,
  });
  const returnLocation = chapter.locations?.find(loc => loc.id === returnContext?.locationId);
  const lifetime = { controller: new AbortController(), dispose: null };
  activePlugin = lifetime;
  let lastSaved = JSON.stringify(levelState);
  let exitingLevel = false;
  const module = await import("./circuit-editor.js");
  if (activePlugin !== lifetime || lifetime.controller.signal.aborted ||
      !stillOnView(levelView, levelSession)) return;
  const ctx = Object.freeze({
    container: host,
    chapter: Object.freeze({ id: chapter.id, title: chapter.title, region: chapter.region }),
    level: Object.freeze({ ...spec, lineage: selectedLevel?.lineage || "器派" }),
    returnLabel: selectedLevelId === 'ch1_binary_decoder' ? '返回玉匠铺'
      : returnContext?.questId && returnLocation?.name ? `返回${returnLocation.name}` : undefined,
    completionHint: selectedLevelId === 'ch1_binary_decoder' ? '四种组合已通过，请返回玉匠铺，向玉匠回报。' : '',
    state: levelState,
    signal: lifetime.controller.signal,
    api: (method, path, body, options = {}) => {
      if (!stillOnView(levelView, levelSession)) throw new StaleOperationError();
      return api(method, path, body, {...options, authToken:levelSession.token});
    },
    saveProgress: async (state, checkpoint) => {
      if (!stillOnView(levelView, levelSession)) throw new StaleOperationError();
      const snapshot = JSON.stringify(state);
      const record = await saveChapter(chapterId, state, checkpoint, levelSession);
      if (!stillOnView(levelView, levelSession)) throw new StaleOperationError();
      if (state === levelState) lastSaved = snapshot;
      return record;
    },
    exit: async () => {
      if (!stillOnView(levelView, levelSession)) return;
      // circuit-editor.js has already checked canLeave() before calling this callback.
      if (exitingLevel || activePlugin !== lifetime) return;
      exitingLevel = true;
      try {
        await loadGame();
        if (!stillOnView(levelView, levelSession)) return;
        // Navigation remains available if task-status synchronization temporarily fails.
        try { await syncFirstCircuitQuestCompletion(chapterId); }
        catch (error) { console.warn("电路任务进度暂未同步：", error); }
        if (activePlugin !== lifetime ||
            !stillOnView(levelView, levelSession)) return;
        // Keep the editor active during asynchronous room entry. page()
        // disposes it only when the destination room is actually mounted.
        const latestState = saved.get(chapterId)?.state || levelState;
        const restored = readQuestReturnContext(latestState.questReturn, {
          chapterId, levelId:selectedLevelId, locations:chapter.locations,
        });
        await showRoom(chapterId,
          resolveReturnLocation(latestState, chapter, selectedLevelId), restored);
      } finally {
        exitingLevel = false;
      }
    },
  });
  try {
    const returned = await module.mount(ctx);
    const disposer = typeof returned === "function" ? returned :
      (returned && typeof returned.dispose === "function" ? () => returned.dispose() : null);
    if (activePlugin !== lifetime || lifetime.controller.signal.aborted ||
        !stillOnView(levelView, levelSession)) {
      if (disposer) disposer();
      return;
    }
    lifetime.dispose = disposer;
    if (returned && typeof returned.canLeave === "function") {
      lifetime.canLeave = returned.canLeave;
    }
  } catch (error) {
    if (!stillOnView(levelView, levelSession)) return;
    if (activePlugin === lifetime) {
      cleanupPlugin();
      page("电路编辑器加载失败");
      el("p", error.message || "编辑器初始化失败", root);
      button("返回房间", root, () => showRoom(chapterId, levelState.locationId));
    }
    throw error;
  }
}
function renderTable(parent, headers, items, { scoreDates = null } = {}) {
  if (!items.length) {
    el("p", "暂无记录", parent);
    return;
  }
  const table = el("table", undefined, parent);
  const tr = el("tr", undefined, el("thead", undefined, table));
  for (const title of headers) el("th", title, tr);
  const tbody = el("tbody", undefined, table);
  for (const [rowIndex, row] of items.entries()) {
    const entry = el("tr", undefined, tbody);
    for (const [columnIndex, value] of row.entries()) {
      const cell = el("td", String(value ?? ""), entry);
      if (typeof value === "number") cell.className = "number-cell";
      if (scoreDates && columnIndex === 4) cell.classList.add("score-count-centered");
      if (scoreDates && columnIndex === 5 && scoreDates[rowIndex]) {
        cell.title = `完成日期：${scoreDates[rowIndex]}`;
      }
    }
  }
  return table;
}
function gradeCountLabel(record) {
  if (!Number.isInteger(record.bestPassedCount) ||
      !Number.isInteger(record.totalCount)) {
    return "旧版演示未记录组数";
  }
  return `${record.bestPassedCount}/${record.totalCount} ${record.unit}`;
}
function formatCompletionDuration(record) {
  // The personal scores endpoint must return the duration in its FIRST reply.
  // Do not fetch again or mutate the table later.
  if (!Object.prototype.hasOwnProperty.call(record, "completionDurationSeconds")) {
    return "接口未提供";
  }
  const value = record.completionDurationSeconds;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "—"; // Old / unsuccessful result: no actual completion duration.
  }
  if (value < 1) return "不足 1 秒";
  const rounded = Math.round(value);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  if (hours) return `${hours} 小时 ${minutes} 分 ${seconds} 秒`;
  if (minutes) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}
async function showMyScores() {
  const session = getAuthSnapshot();
  const navigation = beginNavigation();
  // One request, one render. Date remains available as a cell tooltip.
  let reply;
  try {
    reply = await api("GET", "/api/circuit/results/mine");
  } catch (error) {
    if (!stillNavigating(navigation, session)) return;
    throw error;
  }
  if (!stillNavigating(navigation, session)) return;
  const records = Array.isArray(reply.results) ? reply.results : [];
  page("", "scores");
  renderResultsHeader("成绩");
  // 成绩直接显示在凤鸟背景上，不再创建装饰底板或纸质容器。
  // 保留真实接口、表格字段与独立滚动；仅在需要时横向滚动表格。
  const content = el("main", undefined, root);
  content.className = "scores-content";
  content.setAttribute("aria-label", "个人成绩");
  const scroller = el("div", undefined, content);
  scroller.className = "scores-scroll";
  scroller.tabIndex = 0;
  scroller.setAttribute("role", "region");
  scroller.setAttribute("aria-label", "关卡成绩记录（可滚动查看）");
  if (!records.length) {
    const empty = el("p", "暂无已提交成绩。", scroller);
    empty.className = "scores-empty";
  } else {
    renderTable(scroller,
      ["章节", "关卡", "状态", "最佳通过组数/步数", "提交次数", "完成用时"],
      records.map((record) => [
        record.chapterTitle, record.levelTitle, record.status,
        gradeCountLabel(record),
        record.submissionCount, formatCompletionDuration(record),
      ]), { scoreDates: records.map((record) => record.completedDate || record.completedAt || null) });
  }
}
async function boot() {
  // Visiting the site always starts with the scenic entry screen.
  // Existing sessions are verified before the entry button can lead to Home.
  if (!hasToken()) { showLanding(); return; }
  const session = getAuthSnapshot();
  const bootView = viewGeneration;
  try {
    const reply = await api("GET", "/api/auth/me", undefined, {authToken:session.token});
    if (!stillOnView(bootView, session)) return;
    me = reply.user;
    if (me.needsPasswordSetup) {
      clearToken();
      me = null;
      showLanding();
      return;
    }
    await loadGame();
    if (!stillOnView(bootView, session)) return;
    showLanding();
  } catch (error) {
    // Superseded reads are not authentication failures.
    if (error?.code === 'STALE_OPERATION') return;
    // A late boot failure must never clear a token or replace a newer page.
    if (!stillOnView(bootView, session)) return;
    clearToken();
    progressQueue.invalidatePending();
    me = null;
    showLanding();
  }
}
boot();
