/* 学生游戏入口：身份认证、章节导航、进度保存与个人成绩。 */
import {
  api, hasToken, setToken, clearToken, downloadCsv, asBase64,
} from "./api.js";
import { createRoom } from "./room.js";
import { createPannableMap } from "./map-viewport.js";
import { mountNavigationPath } from "./navigation-path.js";
import { normalizeQuestCollection, changeQuestStatus } from "./task-model.js";
import { renderAdmin, renderTeacher } from "./management.js";
import { alertDialog, confirmDialog } from "./dialog.js";
const root = document.getElementById("app");
// Shared UI requests keep the existing app router and callbacks.
window.addEventListener("zshxj:ui-home-request", () => showHome());
window.addEventListener("zshxj:ui-settings-request", () => showSettings());

let me = null;
let chapters = [];
let roomDispose = null;
let mapDispose = null;
let activePlugin = null;
const saved = new Map();
let gameProfile = { balance: 0, inventory: {} };

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
const writeTails = new Map();
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
  // Teachers need chapter titles for instructional filters, not personal progress.
  if (me?.role === "admin") {
    chapters = [];
    saved.clear();
    return;
  }
  const [chapterReply, progressReply, profileReply] = await Promise.all([
    api("GET", "/api/chapters"),
    me?.role === "student" ? api("GET", "/api/progress") : Promise.resolve({ progress: [] }),
    me?.role === "student" ? api("GET", "/api/game/profile").catch(() => ({ balance: 0, inventory: {} })) : Promise.resolve({ balance: 0, inventory: {} }),
  ]);
  chapters = chapterReply.chapters;
  gameProfile = profileReply;
  saved.clear();
  for (const item of progressReply.progress) saved.set(item.chapterId, item);
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
function saveChapter(chapterId, state, checkpoint) {
  const snapshot = copy(state);
  const previous = writeTails.get(chapterId) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const rev = saved.get(chapterId)?.revision ?? 0;
    const reply = await api("PUT", `/api/progress/${encodeURIComponent(chapterId)}`, {
      checkpoint, state: snapshot, expectedRevision: rev,
    });
    // Saving progress must not implicitly fetch the wallet; callers decide
    // when a checkpoint can change rewards. This avoids double profile
    // requests during quest saves and pointless polling after movement.
    saved.set(chapterId, reply.progress);
    return reply.progress;
  });
  writeTails.set(chapterId, next);
  return next;
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
    submit.disabled = true;
    try {
      const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body = { username: account.value, password: password.value };
      if (name) body.displayName = name.value;
      const reply = await api("POST", path, body);
      if (reply.setupRequired) {
        showSetupPassword(reply.setupToken, reply.username);
        return;
      }
      setToken(reply.token);
      me = reply.user;
      await loadGame();
      showHome();
    } catch (error) {
      message.textContent = error.message;
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
    if (newPassword.value !== repeat.value) {
      message.textContent = "两次输入的密码不一致";
      return;
    }
    submit.disabled = true;
    try {
      const reply = await api("POST", "/api/auth/setup-password", {
        setupToken, newPassword: newPassword.value,
      });
      setToken(reply.token);
      me = reply.user;
      await loadGame();
      showHome();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  button("返回登录", root, () => showAuth());
}
async function logout() {
  try { await api("POST", "/api/auth/logout", {}); } catch (_) { /* 本地也会清理 */ }
  clearToken();
  me = null;
  chapters = [];
  saved.clear();
  writeTails.clear();
  showLanding();
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
    if (destination === 'world') showMap();
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
      onActivate: () => showChapterMap('ch1')},
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
      onActivate: () => showRoom(chapterId, location.id)},
    focus: MAP_LANDMARKS.cityGate, back: showMap, backLabel:'返回大地图',
  });
}
async function showRoom(chapterId, locationId = null) {
  const chapter = requireChapter(chapterId);
  if (!chapter.canEnter || !chapter.implemented) throw new Error("当前章节未开发");
  const state = copy(saved.get(chapterId)?.state || defaultState(chapterId));
  const location = (chapter.locations || []).find(item => item.id === locationId) || chapter.locations?.[0];
  if (!location) throw new Error("本章尚无地图数据");
  state.locationId = location.id;
  const roomChapter = {...chapter, npc:location.npc || chapter.npc,
    npcLine:location.npcLine ?? chapter.npcLine, room:location.roomTitle || location.name};
  async function exitRoomTo(destination) {
    state.flags ??= {};
    state.flags.completedLocations ??= [];
    if (state.tasks?.main?.status === "submitted" &&
        !state.flags.completedLocations.includes(location.id)) {
      state.flags.completedLocations.push(location.id);
    }
    await saveChapter(chapterId, state, "exit_room");
    await loadGame();
    if (destination === 'world') showMap();
    else showChapterMap(chapterId);
  }
  const host = page(`${chapter.spaceTitle || chapter.title} · ${location.name}`, "room");
  roomDispose = createRoom({
    host, chapter: roomChapter, state, location, wallet: gameProfile.balance || 0, inventory: gameProfile.inventory?.[chapterId] || [],
    onSave: async (checkpoint) => {
      const result = await saveChapter(chapterId, state, checkpoint);
      if (checkpoint !== "room_moved" && me?.role === "student") {
        gameProfile = await api("GET", "/api/game/profile").catch(() => gameProfile);
      }
      return { result, profile: gameProfile };
    },
    onProfileChange: (profile) => { gameProfile = profile; },
    onHome: showHome,
    onSettings: showSettings,
    onAchievements: () => showPlaceholder("成就"),
    onShop: () => showPlaceholder("商店（敬请期待）"),
    onLeaderboard: async () => {
      await saveChapter(chapterId, state, "open_leaderboard");
      showLeaderboard(() => showRoom(chapterId, location.id));
    },
    // The room's circuit entrance leads directly to this chapter's first formal
    // circuit. Keep the level-selection page implemented for later reuse.
    onStartLevel: async () => {
      const firstLevelId = chapter.levels?.[0]?.id;
      if (!firstLevelId) throw new Error("本章暂无可进入的正式电路关卡");
      await saveChapter(chapterId, state, "before_circuit_demo");
      // A temporary score-service error should not block entry to the editor.
      try { await syncFirstCircuitQuestCompletion(chapterId); }
      catch (error) { console.warn("电路任务进度暂未同步：", error); }
      await showLevel(chapterId, firstLevelId);
    },
    onExit: () => exitRoomTo('chapter'),
    onWorldMap: () => exitRoomTo('world'),
    onError: showError,
  });
  if (!saved.has(chapterId)) {
    try { await saveChapter(chapterId, state, "first_room_enter"); }
    catch (error) { await showError(error); }
  }
}

// This used to run only while opening the four-level list. Keep the task
// progression independent of that page so hiding it does not disable quests.
async function syncFirstCircuitQuestCompletion(chapterId, resultRows = null) {
  const prior = saved.get(chapterId)?.state;
  if (chapterId !== "ch1" || prior?.tasks?.main?.status !== "accepted") return;
  const officialLevelIds = new Set((requireChapter(chapterId).levels || []).map(level => level.id));
  if (!officialLevelIds.size) return;
  const rows = resultRows ?? (await api("GET", "/api/circuit/results/mine")).results ?? [];
  if (!rows.some(row => row.completed === true && row.assessmentType === "circuit_server" &&
        officialLevelIds.has(row.levelId))) return;
  const nextState = copy(prior);
  nextState.tasks.main = changeQuestStatus(nextState.tasks.main, "completed");
  await saveChapter(chapterId, nextState, "first_circuit_level_passed");
}

async function showLevelList(chapterId, locationId = null) {
  const chapter = requireChapter(chapterId);
  const result = await api("GET", "/api/circuit/results/mine");
  const rows = result.results || result.items || [];
  const levels = chapter.levels || [];
  const officialLevelIds = new Set(levels.map(level => level.id));
  const completed = new Set(rows.filter(r =>
    r.completed === true && r.assessmentType === "circuit_server" &&
    officialLevelIds.has(r.levelId)
  ).map(r => r.levelId));
  const resultByLevel = new Map(rows.map(r => [r.levelId, r]));
  await syncFirstCircuitQuestCompletion(chapterId, rows);
  const host = page("正式电路关卡", "level-list");
  const intro = el("p", chapterId === "ch1"
    ? "选择下面四项电路实验中的一项，进入数字电路搭建与仿真。"
    : `${chapter.spaceTitle || chapter.title} · 器派谱系`, host);
  intro.className = "level-list-intro";
  if (levels.length) {
    const panel = el("section", undefined, host); panel.className = "scroll-panel level-list-panel";
    levels.forEach((level, index) => {
      const row = el("article", undefined, panel); row.className = "level-list-row";
      const title = el("h3", `${level.lineage}　${level.title}`, row);
      const best = resultByLevel.get(level.id);
      const bestText = best ? `最佳通过 ${best.bestPassedCount ?? best.passedCount ?? 0}/${best.totalCount ?? 0} 组` : "尚未完成";
      el("p", `${bestText} · ${completed.has(level.id) ? "已完成" : "首次通过可得铜钱 +30"}`, row);
      button(completed.has(level.id) ? "查看关卡" : "进入关卡", row, () => showLevel(chapterId, level.id));
    });
  } else if (chapter.entry) {
    // Compatibility hook used only by standalone plugin fixtures in tests.
    el("p", "暂无正式关卡", host);
    button("打开插件", host, () => showLevel(chapterId));
  } else {
    el("p", "暂无关卡", host);
  }
  button("返回房间", host, () => showRoom(chapterId, locationId));
}
async function showLevel(chapterId, selectedLevelId = null) {
  const chapter = requireChapter(chapterId);
  const selectedLevel = chapter.levels?.find(item => item.id === selectedLevelId);
  if (selectedLevelId) {
    const reply = await api("GET", `/api/levels/${encodeURIComponent(selectedLevelId)}`);
    const spec = reply.level;
    const host = page(`${selectedLevel?.lineage || "正式关卡"} · ${selectedLevel?.title || spec.title}`, "level circuit-level-page");
    const levelState = copy(saved.get(chapterId)?.state || defaultState(chapterId));
    const lifetime = { controller: new AbortController(), dispose: null };
    activePlugin = lifetime;
    let lastSaved = JSON.stringify(levelState);
    let exitingLevel = false;
    const module = await import("./circuit-editor.js");
    if (activePlugin !== lifetime || lifetime.controller.signal.aborted) return;
    const ctx = Object.freeze({
      container: host,
      chapter: Object.freeze({ id: chapter.id, title: chapter.title, region: chapter.region }),
      level: Object.freeze({ ...spec, lineage: selectedLevel?.lineage || "器派" }),
      state: levelState,
      signal: lifetime.controller.signal,
      api,
      saveProgress: async (state, checkpoint) => {
        const snapshot = JSON.stringify(state);
        const record = await saveChapter(chapterId, state, checkpoint);
        if (state === levelState) lastSaved = snapshot;
        return record;
      },
      exit: async () => {
        // circuit-editor.js has already checked canLeave() (including its
        // unsaved-circuit warning) before calling this callback.
        if (exitingLevel || activePlugin !== lifetime) return;
        exitingLevel = true;
        try {
          await loadGame();
          // Navigation must still work if task-status synchronization fails.
          try { await syncFirstCircuitQuestCompletion(chapterId); }
          catch (error) { console.warn("电路任务进度暂未同步：", error); }
          if (activePlugin !== lifetime) return;
          cleanupPlugin();
          await showRoom(chapterId, levelState.locationId);
        } finally {
          exitingLevel = false;
        }
      },
    });
    try {
      const returned = await module.mount(ctx);
      const disposer = typeof returned === "function" ? returned :
        (returned && typeof returned.dispose === "function" ? () => returned.dispose() : null);
      if (activePlugin !== lifetime || lifetime.controller.signal.aborted) {
        if (disposer) disposer();
        return;
      }
      lifetime.dispose = disposer;
      if (returned && typeof returned.canLeave === "function") {
        lifetime.canLeave = returned.canLeave;
      }
    } catch (error) {
      if (activePlugin === lifetime) {
        cleanupPlugin();
        page("电路编辑器加载失败");
        el("p", error.message || "编辑器初始化失败", root);
        button("返回房间", root, () => showRoom(chapterId, levelState.locationId));
      }
      throw error;
    }
    return;
  }
  const host = page(selectedLevel ? `${selectedLevel.lineage} · ${selectedLevel.title}` : `章节关卡 · 第${chapter.order}章`, "level");
  const lifetime = {
    controller: new AbortController(),
    dispose: null,
  };
  activePlugin = lifetime;
  // A plugin may hold an unsaved result outside its JSON state. It marks that
  // result explicitly; changes to ctx.state are also detected automatically.
  const levelState = copy(saved.get(chapterId)?.state || defaultState(chapterId));
  let lastSavedState = JSON.stringify(levelState);
  let unsavedLocalData = false;
  const hasUnsavedChanges = () =>
    unsavedLocalData || JSON.stringify(levelState) !== lastSavedState;
  const leaveWarning = "确认退出吗？未保存的进度将会丢失。";
  let leaving = false;
  let confirmingExit = false;
  async function leaveLevel(destination) {
    if (leaving || confirmingExit) return false;
    // Confirm only genuinely unsaved content. Prevent multiple exit dialogs
    // if two exit buttons are activated while a confirmation is still open.
    if (hasUnsavedChanges()) {
      confirmingExit = true;
      let approved = false;
      try {
        approved = await confirmDialog(leaveWarning);
      } finally {
        confirmingExit = false;
      }
      if (!approved) return false;
    }
    leaving = true;
    try {
      // Declining the dialog leaves both draft and plugin intact.
      if (activePlugin === lifetime) cleanupPlugin();
      await loadGame();
      if (destination === "room") await showRoom(chapterId, levelState.locationId);
      else showHome();
      return true;
    } catch (error) {
      leaving = false;
      throw error;
    }
  }
  let module;
  try {
    module = await import(chapter.entry);
  } catch (error) {
    if (activePlugin === lifetime) {
      cleanupPlugin();
      page("关卡加载失败");
      el("p", error.message || "加载失败", root);
      button("返回小地图", root, () => leaveLevel("room"));
    }
    throw error;
  }
  // 用户在异步加载期间离开时不再挂载旧关卡。
  if (activePlugin !== lifetime || lifetime.controller.signal.aborted) return;
  if (!module.meta || module.meta.id !== chapterId || typeof module.mount !== "function") {
    cleanupPlugin();
    page("关卡加载失败");
    el("p", "章节模块需要导出meta.id与mount(ctx)", root);
    button("返回小地图", root, () => leaveLevel("room"));
    throw new Error("章节插件需导出meta.id与mount(ctx)");
  }
  const ctx = Object.freeze({
    container: host,
    chapter: Object.freeze({ id: chapter.id, title: chapter.title, region: chapter.region }),
    state: levelState,
    signal: lifetime.controller.signal,
    setUnsavedChanges: (dirty) => { unsavedLocalData = Boolean(dirty); },
    startAttempt: async () => {
      const result = await api("POST",
        `/api/chapters/${encodeURIComponent(chapterId)}/attempts/start`, {});
      return result.attemptId;
    },
    saveProgress: async (state, checkpoint) => {
      // Capture the same snapshot that saveChapter will send, *before*
      // awaiting the server. Edits made during the request remain dirty.
      const snapshot = JSON.stringify(state);
      const result = await saveChapter(chapterId, state, checkpoint);
      if (state === levelState) lastSavedState = snapshot;
      return result;
    },
    submitScore: (result) => api("POST", "/api/scores", {
      chapterId, score: result.score, completed: result.completed,
      details: result.details || {}, attemptId: result.attemptId,
    }),
    exit: () => leaveLevel("room"),
    exitToHome: () => leaveLevel("home"),
    // 剧情 Demo 结果入库后开放后续正式实验；不改变成绩与存档规则。
    openFormalLevels: chapterId === "ch1"
      ? async () => {
          if (leaving || confirmingExit) return false;
          if (hasUnsavedChanges()) {
            const approved = await confirmDialog(leaveWarning);
            if (!approved) return false;
          }
          leaving = true;
          try {
            if (activePlugin === lifetime) cleanupPlugin();
            await loadGame();
            const firstLevelId = chapter.levels?.[0]?.id;
            if (!firstLevelId) throw new Error("本章暂无可进入的正式电路关卡");
            await showLevel(chapterId, firstLevelId);
            return true;
          } catch (error) {
            leaving = false;
            throw error;
          }
        }
      : undefined,
  });
  try {
    const returned = await module.mount(ctx);
    const disposer = typeof returned === "function" ? returned :
      (returned && typeof returned.dispose === "function"
        ? () => returned.dispose() : null);
    if (activePlugin !== lifetime || lifetime.controller.signal.aborted) {
      if (disposer) disposer();
      return;
    }
    lifetime.dispose = disposer;
  } catch (error) {
    if (activePlugin === lifetime) {
      cleanupPlugin();
      page("关卡运行失败");
      el("p", error.message || "插件异常", root);
      button("返回小地图", root, () => leaveLevel("room"));
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
  // One request, one render. Date remains available as a cell tooltip.
  const reply = await api("GET", "/api/circuit/results/mine");
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
  try {
    const reply = await api("GET", "/api/auth/me");
    me = reply.user;
    if (me.needsPasswordSetup) {
      clearToken();
      me = null;
      showLanding();
      return;
    }
    await loadGame();
    showLanding();
  } catch (_) {
    clearToken();
    me = null;
    showLanding();
  }
}
boot();
