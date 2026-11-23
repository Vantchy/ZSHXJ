/* ZSHXJ QUEST NAVIGATION V2 */
/* 房间交互、任务与对话状态由页面协调；镜头及调查物分别由独立模块负责。 */
import { createRoomWorld, ROOM_WORLD_WIDTH } from "./room-world.js";
import {createRoomActors, closestActor, actorForQuest, sceneQuestsAtLocation} from "./room-actors.js";
import { findRoomObject, createItemInspector } from "./room-interactions.js";
import { mountNavigationPath } from "./navigation-path.js";
import { createDialoguePlayer } from "./dialogue-player.js";
import {normalizeQuestCollection, changeQuestStatus, advanceTestStep,
        currentTestStep, questPrerequisitesSatisfied} from "./task-model.js";
import {prepareQuestDialogueFinish} from './quest-dialogue-event.js';
import {normalizeFlowProgress, syncFlowOfficialPass} from './quest-flow.js';
import {sceneConfig, sceneProgress, activeSceneStep,
        sceneHint, sceneCheckpoint, sceneDialogueContext, sceneEndActions,
        sceneLevelStep, sceneReviewTarget} from './quest-scene.js';
import {resolveQuestDestination} from './quest-navigation.js';
import {mountMengjinBoard, boardStationForLocation, ensureMengjinStylesheet} from './mengjin-board.js';
import {visibleTaskEntries, selectVisibleTaskKey} from './story-task-presentation.js';
import {reviewScenesAtSpot,reviewEntryRoute} from './story-spot-review.js';
const WIDTH = ROOM_WORLD_WIDTH;
const DISTANCE = 145;
const TYPEWRITER_DELAY = 30;
const MOVE_SPEED = 86; // World units per second; calmer than the old 185.
const ROOM_ART = '/assets/room/';


function node(tag, text, parent) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (parent) parent.append(item);
  return item;
}
function control(label, parent, handler) {
  const b = node("button", label, parent);
  b.type = "button";
  b.addEventListener("click", handler);
  return b;
}
function taskName(status) {
  return {
    "not-accepted": "未接取",
    accepted: "已接取",
    completed: "已完成待交付",
    submitted: "已交付",
  }[status] || status;
}
export function createRoom({
  returnContext = null,
  host, chapter, state, location = {}, characters = {}, wallet = 0, inventory = [],
  onProfileChange = () => {}, onHome = () => {}, onSettings = () => {},
  onAchievements = () => {}, onShop = () => {}, onLeaderboard = () => {},
  onSave: saveDirect, onStartLevel: startLevelDirect,
  onVisitStoryAct = null,
  onGoToLevel: goToLevelDirect = null, onGetLevelResults = async () => [],
  onExit: exitDirect, onWorldMap: worldDirect = exitDirect, onError,
}) {
  state.schemaVersion = Math.max(Number(state.schemaVersion) || 0, 2);
  state.roomId = `${chapter.id}-room`;
  if (!state.position || !Number.isFinite(state.position.x)) {
    state.position = { x: 445 };
  }
  // 主干旧版房间曾使用 1400 宽坐标，同学版房间使用 1024。
  // 对明显越界的旧存档按比例迁移；在 0..1024 范围内的存档不作猜测性转换。
  if (state.position.x > WIDTH) {
    state.position.x = state.position.x * WIDTH / 1400;
  }
  state.position.x = Math.min(WIDTH - 35, Math.max(35, state.position.x));
  // Old or manually edited saves may contain malformed optional fields.
  // Normalize each collection to the expected shape before using push/map.
  const asRecord = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  state.inventory = Array.isArray(state.inventory) ? state.inventory : [];
  state.dialogues = Array.isArray(state.dialogues) ? state.dialogues : [];
  state.flags = asRecord(state.flags);
  state.circuits = asRecord(state.circuits);
  state.code = typeof state.code === "string" ? state.code : "";
  state.tasks = normalizeQuestCollection(state.tasks, chapter.quests);
  // Script-only previews are authored dialogue, not released assessments.
  // Keep the legacy demo quests in the save, but do not offer or mutate them
  // while viewing a distinct, not-yet-graded chapter scene.
  const storyPreview = location.roomType === 'story-preview';
  let boardOpen = false;
  let boardDispose = null;
  // A location can opt an ordered quest into the shared narrative scene
  // controller through its authored questTargets.scene. No quest ID is special.
  const soloNarration = location.soloNarration === true;
  const soloNarratorName = location.soloPlayerName || '子';
  // Army stories have a playable protagonist AND real, distinct NPC actors.
  // An unbound supporting actor may speak in the same authored event, but may
  // never register a second task owner on the server.
  const armyDialogue = /^yangcheng-(valley|camp|watch)-/.test(location.id) ||
    location.id === 'yangcheng-watch-night';
  const sceneQuests = sceneQuestsAtLocation(chapter, location.id);
  // For solo recollections, use virtual owners for the *existing* quest flow,
  // but never place an NPC on the canvas. The player is the speaking character.
  const soloDeskX = Number.isFinite(location.soloStationX) ? location.soloStationX : 446;
  const actors = soloNarration ? sceneQuests.map((quest,index)=>({
    id:`solo-${quest.id}`,name:'案上算稿',x:soloDeskX,questId:quest.id,
    dialogueId:null,npcLine:'',
  })) : createRoomActors(chapter, location, characters);
  const questForActor = actor => sceneQuests.find(q => q.id === actor?.questId) ||
    (armyDialogue && actor && sceneQuests.length === 1 ? sceneQuests[0] : null);
  const activeQuest = sceneQuests.find(quest =>
    questPrerequisitesSatisfied(chapter,state,quest) &&
    (quest === chapter.quests?.main ? state.tasks.main : state.tasks.side?.[quest.id])?.status !== 'submitted');
  let activeActor = actorForQuest(actors, returnContext?.questId) ||
    actorForQuest(actors, activeQuest?.id) || actors[0];
  let sceneQuest = questForActor(activeActor);
  let sceneHere = Boolean(sceneQuest);
  // Each character-bound quest has independent state; never normalize only the
  // first NPC's quest and accidentally mutate a second NPC's progress later.
  for (const quest of sceneQuests) {
    const progress = sceneProgress(state, chapter, quest);
    const normalized = normalizeFlowProgress(progress, quest);
    if (quest === chapter.quests?.main) state.tasks.main = normalized;
    else state.tasks.side[quest.id] = normalized;
  }

  // Real-world operation is still keyboard/canvas; the four lower buttons
  // are navigation controls, not movement/interaction surrogates.
  const topbar = node('header', undefined, host); topbar.className = 'room-topbar';
  control('铸算 · 华夏纪', topbar, () => perform(async () => {
    clearTimeout(saveTimer);
    await onSave('room_return_home');
    onHome();
  })).className = 'room-brand';
  mountNavigationPath(topbar, 'room', (destination) => {
    if (destination === 'world') return perform(onWorldMap);
    if (destination === 'chapter') return perform(onExit);
    return undefined;
  });
  const walletNode = node('strong', undefined, topbar); walletNode.className = 'room-wallet';
  const walletCoin = node('img', undefined, walletNode);
  walletCoin.className = 'room-wallet-coin';
  walletCoin.src = ROOM_ART + 'bronze-coin.png';
  walletCoin.alt = '';
  walletCoin.setAttribute('aria-hidden', 'true');
  node('span', '铜钱', walletNode).className = 'room-wallet-sr';
  const walletValue = node('span', String(wallet), walletNode);
  control('小地图', topbar, () => perform(onExit)).className = 'room-top-action room-mini-map';
  control('设置', topbar, () => perform(async () => {
    clearTimeout(saveTimer);
    await onSave('room_open_settings');
    onSettings();
  })).className = 'room-top-action';

  const stage = node('main', undefined, host);
  stage.className = 'room-stage' + (storyPreview ? ' room-stage--story-preview' : '') +
    (soloNarration ? ' room-stage--solo-narration' : '') +
    (armyDialogue ? ' room-stage--army-dialogue' : '');
  if (armyDialogue && !document.querySelector('link[data-yangcheng-scene]')) {
    const css=document.createElement('link');css.rel='stylesheet';
    css.href='/yangcheng-scene.css?v=1';css.dataset.yangchengScene='true';
    document.head.append(css);
  }
  if (soloNarration && !document.querySelector('link[data-taosi-scene]')) {
    const css=document.createElement('link');css.rel='stylesheet';
    css.href='/taosi-scene.css?v=1';css.dataset.taosiScene='true';
    document.head.append(css);
  }
  if (storyPreview) {
    const note = node('div', '第一场 · 玉匠铺　｜　剧情对白预览', stage);
    note.className = 'room-story-preview-note';
    note.setAttribute('aria-label', '剧情预览，教学题板尚未制作，不产生通关成绩');
  }
  stage.setAttribute('aria-label', `${location.name || chapter.room} · 房间场景`);
  const canvas = node('canvas', undefined, stage);
  canvas.width = 1600; canvas.height = 900;
  canvas.className = 'room-canvas';
  canvas.setAttribute('aria-label', '点击地面寻路，WASD 或方向键移动，E 与人物交谈');
  const scene = createRoomWorld({
    stage, background: location.background, npcName: location.npc || chapter.npc,
    npcPlacements:actors, getPlayerX: () => state.position.x,
    onNpcClick: actorId => {
      if (boardOpen || dialogOpen || sceneBusy || actionBusy || questMutationPending) return;
      const actor = actors.find(item => item.id === actorId);
      if (!actor) return;
      if (near(actor)) return interact(actor.id);
      else { setActiveActor(actor.id); tapTarget = actor.x;
        tapInteract = {type:'npc', actorId:actor.id}; }
    },
  });
  if (soloNarration) {
    // Hide synthetic owners; keep their step identity for the task book.
    stage.querySelectorAll('.room-actor--npc').forEach(element=>{
      element.hidden=true;element.tabIndex=-1;element.setAttribute('aria-hidden','true');
    });
    const playerElement=stage.querySelector('.room-actor--player');
    if (playerElement) {
      playerElement.setAttribute('aria-label',`玩家角色：${location.soloPlayerName || '子'}`);
      const badge=node('span',location.soloPlayerName || '子',playerElement);
      badge.className='taosi-player-name';
    }
  }
  if (armyDialogue) {
    const playerElement=stage.querySelector('.room-actor--player');
    if (playerElement) {
      playerElement.setAttribute('aria-label','玩家角色：丑');
      const badge=node('span','丑',playerElement);
      badge.className='yangcheng-player-name';
    }
  }
  scene.setActiveNpc(activeActor.id);
  // A real world-space teaching station, not a permanently visible mock panel.
  // All task state continues to come from the shared ordered-quest controller.
  const teachingStationX = boardStationForLocation(location.id);
  if (teachingStationX != null) ensureMengjinStylesheet();
  const stationButton = teachingStationX == null ? null :
    node('button', '查看教学玉版', stage.querySelector('.room-world'));
  if (stationButton) {
    stationButton.type = 'button';
    stationButton.className = 'mj-board-hotspot' +
      (location.id === 'mengjin-jade-courtyard' ? ' mj-board-hotspot--jade' : '');
    stationButton.title = '走近此处查看本场教学题板';
    stationButton.setAttribute('aria-label', '走近题板并互动');
    stationButton.hidden = true;
    stationButton.addEventListener('click', event => {
      event.stopPropagation();
      approachTeachingStation();
    });
  }

  const soloDeskButton = soloNarration ?
    node('button','翻阅案上算稿',stage.querySelector('.room-world')) : null;
  if (soloDeskButton) {
    soloDeskButton.type='button';soloDeskButton.className='taosi-desk-hotspot';
    soloDeskButton.setAttribute('aria-label',`走近书案并翻阅算稿，听${soloNarratorName}自述`);
    soloDeskButton.addEventListener('click',event=>{
      event.stopPropagation();
      if (boardOpen || dialogOpen || sceneBusy || actionBusy || questMutationPending) return;
      if (near()) perform(startSceneConversation);
      else {tapTarget=soloDeskX;tapInteract={type:'npc',actorId:activeActor.id};
        notify('正走向书案，准备整理算稿。');}
    });
  }
  const itemInspector = createItemInspector(stage);
  const roomObject = findRoomObject(location.id);
  let objectSavePending = false;

  const toastRack = node('div', undefined, stage);
  toastRack.className = 'room-toast-rack';
  toastRack.setAttribute('aria-live', 'polite');

  // Task HUD is composed from live text and independent ornaments.
  // Its height follows the number of visible task rows; no fixed-size panel image.
  const taskbar = node('section', undefined, stage);
  taskbar.className = 'room-taskbar';
  const taskToggle = control('', taskbar, () => {
    if (taskPanel.hidden) openTaskPanel();
    else closeTaskPanel();
  });
  taskToggle.className = 'room-taskbar-toggle';
  taskToggle.setAttribute('aria-expanded', 'false');
  taskToggle.setAttribute('aria-controls', 'room-task-panel');
  const taskHeading = node('span', undefined, taskToggle);
  taskHeading.className = 'room-taskbar-heading';
  const headingLabel = node('strong', sceneHere ? '当前任务' : '主线任务', taskHeading);
  const taskOrnament = node('img', undefined, taskToggle);
  taskOrnament.src = ROOM_ART + 'quest-heading-rule.png';
  taskOrnament.alt = ''; taskOrnament.setAttribute('aria-hidden', 'true');
  const taskContent = node('div', undefined, taskbar);
  taskContent.className = 'room-taskbar-content';
  const taskText = node('strong', '', taskContent);
  taskText.className = 'room-taskbar-quest-title';
  const taskHint = node('p', '', taskContent);
  taskHint.className = 'room-taskbar-hint';
  const taskRows = node('div', undefined, taskContent);
  taskRows.className = 'room-taskbar-rows';
  // A full-viewport modal belongs to the room root, not the clipped world stage.
  // This puts one flat dark backdrop behind the central parchment book, never on it.
  const taskPanel = node('section', undefined, host);
  taskPanel.id = 'room-task-panel'; taskPanel.className = 'room-task-panel'; taskPanel.hidden = true;
  taskPanel.setAttribute('role', 'dialog');
  taskPanel.setAttribute('aria-label', '任务总览');
  taskPanel.setAttribute('aria-modal', 'true');
  let selectedQuestKey = sceneHere && sceneQuest !== chapter.quests?.main ? `side:${sceneQuest.id}` : 'main';
  // After a task-linked circuit, reopen the same task when the book is opened.
  if (returnContext?.questId === chapter.quests?.main?.id) selectedQuestKey = 'main';
  else if ((chapter.quests?.side || []).some(q => q.id === returnContext?.questId)) {
    selectedQuestKey = `side:${returnContext.questId}`;
  }
  let chapterExpanded = true;
  let selectedSpotReviewQuestId = (returnContext?.catalogEntryId || returnContext?.catalogBoardId ||
      returnContext?.catalogLevelId)
    ? (returnContext?.questId || null) : null;

const inventoryBar = node('section', undefined, host);
inventoryBar.className = 'room-bag-panel'; inventoryBar.hidden = true;
inventoryBar.setAttribute('role', 'dialog');
inventoryBar.setAttribute('aria-label', '行囊');
inventoryBar.setAttribute('aria-modal', 'true');

const bagShell = node('div', undefined, inventoryBar);
bagShell.className = 'room-bag-shell';

const bagClose = control('', bagShell, () => {
  closeBagPanel();
  itemInspector.close();
});
bagClose.className = 'room-bag-close';
const bagCloseIcon = node('img', undefined, bagClose);
bagCloseIcon.src = '/assets/quests/close-icon.png';
bagCloseIcon.alt = '关闭行囊';
bagCloseIcon.className = 'room-bag-close-icon';

const bagContent = node('div', undefined, bagShell);
bagContent.className = 'room-bag-content';

// Tabs live beside (not inside) the inset panel so their lower edges can
// touch its upper border without clipping or covering the first item row.
const bagTabs = node('div', undefined, bagShell);
bagTabs.className = 'room-bag-tabs';
bagTabs.setAttribute('role', 'tablist');
bagTabs.setAttribute('aria-label', '物品分类');
let selectedBagTab = 0;
const bagTabButtons = [];
const bagCategories = ['分类栏', '分类栏', '分类栏', '分类栏'];
bagCategories.forEach((label, tabIndex) => {
  const tab = control(label, bagTabs, () => {
    selectedBagTab = tabIndex;
    renderBagTabs();
  });
  tab.className = 'room-bag-tab';
  tab.setAttribute('role', 'tab');
  bagTabButtons.push(tab);
});

const bagGrid = node('div', undefined, bagContent);
bagGrid.className = 'room-bag-grid';

const inventorySlots = [];
let selectedBagSlot = -1;
const bagDescription = node('p', undefined, bagContent);
bagDescription.className = 'room-bag-description';
bagDescription.hidden = true;
bagDescription.setAttribute('aria-live', 'polite');
function addBagSlot(index) {
  const slot = control('', bagGrid, () => {
    const item = inventory[index];
    if (!item) return;
    selectedBagSlot = index;
    bagDescription.textContent = `${item.name} · ${item.note || '暂无说明'}`;
    bagDescription.hidden = false;
    renderBagSlots();
  });
  inventorySlots.push(slot);
}
function renderBagSlots() {
  // Reserve twelve slots as a visual baseline, but never hide new inventory.
  while (inventorySlots.length < Math.max(12, inventory.length)) {
    addBagSlot(inventorySlots.length);
  }
  inventorySlots.forEach((slot, index) => {
    const item = inventory[index];
    slot.textContent = item?.name || '空位';
    slot.className = 'room-bag-slot' + (item ? ' has-item' : ' is-empty') +
      (item && selectedBagSlot === index ? ' is-selected' : '');
    slot.title = item?.note || (item?.name || '空位');
    slot.disabled = !item;
    slot.setAttribute('aria-pressed', String(Boolean(item && selectedBagSlot === index)));
  });
}
function renderBagTabs() {
  bagTabButtons.forEach((button, idx) => {
    const selected = idx === selectedBagTab;
    button.className = 'room-bag-tab' + (selected ? ' is-selected' : ' is-unselected');
    button.setAttribute('aria-selected', String(selected));
  });
}
renderBagSlots();
renderBagTabs();

function closeBagPanel() {
  if (inventoryBar.hidden) return;
  inventoryBar.hidden = true;
  stage.inert = false;
  topbar.inert = false;
  keys.clear();
  bagButton?.focus();
}
function openBagPanel() {
  closeDialogue();
  itemInspector.close();
  closeTaskPanel();
  inventoryBar.hidden = false;
  stage.inert = true;
  topbar.inert = false; // The fixed header stays clickable above either overlay.
  bagDescription.hidden = true;
  selectedBagSlot = -1;
  renderBagSlots();
  renderBagTabs();
  bagClose.focus?.();
}

  const line = node('p', '', stage); line.className = 'room-status';
  line.setAttribute('aria-live', 'polite');
  const commands = node('nav', undefined, stage);
  commands.className = 'room-commands room-control-pad';
  commands.setAttribute('aria-label', '房间快捷入口');
  const dialogue = node('section', undefined, stage);
  dialogue.className = 'room-dialogue';
  dialogue.setAttribute('role', 'dialog');
  dialogue.setAttribute('aria-label', `与${chapter.npc}对话`);
  dialogue.setAttribute('aria-modal', 'false');

  let running = true;
  let dialogOpen = false;
  let saveTimer = null;
  let walletTimer = null;
  const toastTimers = new Set();
  let lastFrame = 0;
  let frameHandle = 0;
  let typingTimer = null;
  let dialogueGeneration = 0;
  let lineComplete = true;
  let lineCharacters = [];
  let lineIndex = 0;
  let lineNode = null;
  let optionsHost = null;
  let storyBackButton = null;
  let optionButtons = [];
  const unavailableOptions = new WeakSet();
  let focusIndex = -1;
  let actionBusy = false;
  // A task mutation optimistically updates shared chapter state. All unrelated
  // saves must wait until its PUT succeeds or the rollback has finished,
  // BEFORE their own save queue snapshots are captured.
  let questMutationPending = null;
  let questNavigationBusy = false;
  let pendingDialogueTarget = null;
  let storyPlayer = null;
  let speakerNode = null;
  let storyRenderKey = '';
  let storyContext = null;
  let sceneBusy = false;
  let shortcutReservedWidth = 0;
  const keys = new Set();
  let tapTarget = null;
  let tapInteract = null;


  function afterQuestStability(action) {
    // In the common idle case, invoke immediately: an unnecessary await
    // would allow a new optimistic task change before the save snapshot.
    if (!questMutationPending) return running ? action() : null;
    return (async () => {
      while (questMutationPending) await questMutationPending;
      return running ? action() : null;
    })();
  }
  function onSave(checkpoint) {
    return afterQuestStability(() => saveDirect(checkpoint));
  }
  function onExit() {
    return afterQuestStability(() => exitDirect?.());
  }
  function onWorldMap() {
    return afterQuestStability(() => worldDirect?.());
  }
  async function onStartLevel() {
    if (!running || questMutationPending) {
      if (running) notify('任务保存中，请稍后再进入关卡。');
      return;
    }
    return startLevelDirect?.();
  }
  async function onGoToLevel(levelId, options) {
    if (!running || questMutationPending) {
      if (running) notify('任务保存中，请稍后再前往。');
      return;
    }
    return goToLevelDirect?.(levelId, options);
  }

  async function saveAndRefresh(checkpoint, {questMutation = false} = {}) {
    const previousBalance = Number(walletValue.textContent) || 0;
    // The owning task transaction calls saveDirect to avoid self-deadlock;
    // all other entry points wait on its barrier before taking a snapshot.
    const reply = questMutation ? await saveDirect(checkpoint) : await onSave(checkpoint);
    refreshTaskbar();
    const profile = reply?.profile;
    if (profile) {
      walletValue.textContent = String(profile.balance || 0);
      if ((profile.balance || 0) > previousBalance) {
        walletNode.className = "room-wallet wallet-bump";
        clearTimeout(walletTimer);
        walletTimer = setTimeout(() => { walletNode.className = "room-wallet"; }, 420);
        notify(`获得铜钱 +${(profile.balance || 0) - previousBalance}`);
      }
      onProfileChange(profile);
      const items = profile.inventory?.[chapter.id] || [];
      inventory = items;
      selectedBagSlot = -1;
      bagDescription.hidden = true;
      renderBagSlots();
      renderTaskPanel();
      refreshBagBadge();
    }
    return reply;
  }
  function notify(message) {
    if (!running) return;
    const isReward = /铜钱|獲得铜钱|获得铜钱|\+\s*\d+\s*铜钱/.test(message);
    const tip = node('div', undefined, toastRack);
    tip.className = 'room-paper-toast' + (isReward ? ' room-paper-toast--reward' : ' room-paper-toast--plain');
    tip.setAttribute('role', 'status');
    const text = node('span', message, tip);
    text.className = 'room-reward-text';
    const flourish = node('span', undefined, tip);
    flourish.className = 'room-toast-flourish';
    const rule = node('img', undefined, flourish);
    rule.src = ROOM_ART + 'toast-rule.png';
    // Reserve the original ornament's intrinsic aspect ratio before image load.
    // The intact image is sized by the text-width toast, never clipped.
    rule.width = 2106;
    rule.height = 232;
    rule.alt = '';
    rule.setAttribute('aria-hidden', 'true');
    const timer = setTimeout(() => {
      tip.remove?.();
      toastTimers.delete(timer);
    }, 3200);
    toastTimers.add(timer);
  }
  async function perform(fn) {
    try { return await fn(); } catch (error) { return onError(error); }
  }
  function pendingSave(checkpoint = "room_moved") {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (running) perform(() => onSave(checkpoint));
    }, 850);
  }
  function near(actor = activeActor) {
    return Boolean(actor) && Math.abs(state.position.x - actor.x) <= DISTANCE;
  }
  function setActiveActor(actorId, {focusTask = true, allowSubmittedTransition = false} = {}) {
    const actor = actors.find(item => item.id === actorId);
    // Only the trusted post-submit transition may swap scene owners while the
    // dialogue action is still busy. Ordinary player input stays locked.
    if (!actor || (activeActor?.id !== actorId && !allowSubmittedTransition &&
        (sceneBusy || actionBusy || questMutationPending))) return false;
    activeActor = actor;
    sceneQuest = questForActor(actor);
    sceneHere = Boolean(sceneQuest);
    scene.setActiveNpc(actor.id);
    headingLabel.textContent = sceneHere ? '当前任务' : '主线任务';
    if (focusTask && sceneQuest) {
      selectedQuestKey = sceneQuest === chapter.quests?.main
        ? 'main' : `side:${sceneQuest.id}`;
    }
    refreshTaskbar();
    if (!taskPanel.hidden) renderTaskPanel();
    return true;
  }
  function nearObject() {
    return Boolean(roomObject && Math.abs(state.position.x - roomObject.x) <= DISTANCE);
  }

  async function inspectRoomObject() {
    if (!roomObject) return;
    itemInspector.open({
      id: roomObject.id,
      title: roomObject.title,
      description: roomObject.description,
    });
    // Repeated clicks may reopen the description, but never create another
    // save for an already-investigated object.
    if (objectSavePending || state.flags[roomObject.flag] === true) return;

    objectSavePending = true;
    state.flags[roomObject.flag] = true;
    try {
      await saveAndRefresh(roomObject.checkpoint);
      if (running) notify(`已调查：${roomObject.title}`);
    } catch (error) {
      state.flags[roomObject.flag] = false;
      refreshTaskbar();
      throw error;
    } finally {
      objectSavePending = false;
    }
  }
  function closeTaskPanel() {
    if (taskPanel.hidden) return;
    taskPanel.hidden = true;
    stage.inert = false;
    topbar.inert = false;
    taskToggle.setAttribute('aria-expanded', 'false');
    keys.clear();
    taskToggle.focus();
  }
  function openTaskPanel() {
    pendingDialogueTarget = null;
    closeDialogue();
    itemInspector.close();
    closeBagPanel();
    keys.clear();
    tapTarget = null;
    tapInteract = null;
    renderTaskPanel();
    taskPanel.hidden = false;
    stage.inert = true;
    topbar.inert = false; // Task book never disables the independent header.
    taskToggle.setAttribute('aria-expanded', 'true');
    taskPanel.querySelector('.room-quest-close')?.focus();
  }
  // One review entry point for this physical map spot. NPC interactions,
  // the completed quest's '重温本场' button and review-dialogue return all open
  // the SAME task-book page; none creates a second modal or writes quest state.
  function openSpotReviewInTaskBook(preferredQuestId = sceneQuest?.id) {
    if (!running || boardOpen) return;
    const available=reviewScenesAtSpot(chapter,state,location.id);
    const chosen=available.find(item=>item.questId===preferredQuestId) || available[0];
    if (!chosen) {
      notify('本光点暂无已完成的可回顾内容。');
      openTaskPanel();
      return;
    }
    chapterExpanded=true;
    selectedSpotReviewQuestId=chosen.questId;
    openTaskPanel();
    taskPanel.querySelector('.room-quest-review-scene.is-selected')?.focus();
  }
  function taskDestination(entry) {
    return resolveQuestDestination({
      entry, chapter, state, locationId:location.id,
      canGoToLevel:Boolean(goToLevelDirect),
      reviewTarget:sceneReviewTarget(chapter, entry?.quest, location.id),
    });
  }
  function renderTaskPanel() {
    // Narrative quests remain stored in tasks.side for historical compatibility,
    // but are displayed as the chapter's genuine story mainline. Old placeholder
    // tasks exist in saved data but never clutter this task book.
    const tasks = visibleTaskEntries(chapter,state);
    selectedQuestKey = selectVisibleTaskKey(tasks, selectedQuestKey, state, chapter, location.id);
    const current = tasks.find(t => t.key === selectedQuestKey);
    const spotReviews = reviewScenesAtSpot(chapter,state,location.id);
    const chosenReview = spotReviews.find(item=>item.questId===selectedSpotReviewQuestId) || null;
    if (!chosenReview) selectedSpotReviewQuestId=null;
    const label = (quest) => String(quest?.title || '未命名任务')
      .replace(/^(?:主线|支线)[：:]\s*/, '');
    const img = (parent, name, className) => {
      const pic = node('img', undefined, parent);
      pic.className = className;
      pic.src = '/assets/quests/' + name;
      pic.alt = '';
      pic.setAttribute('aria-hidden', 'true');
      return pic;
    };

    taskPanel.replaceChildren();
    const dim = node('div', undefined, taskPanel);
    dim.className = 'room-quest-dim';
    dim.addEventListener('click', closeTaskPanel);

    // A neutral positioning shell lets the close symbol live OUTSIDE the
    // clipped book artwork while keeping the book centered responsively.
    const shell = node('div', undefined, taskPanel);
    shell.className = 'room-quest-shell';
    const book = node('div', undefined, shell);
    book.className = 'room-quest-book';
    node('span', '任务', book).className = 'room-quest-spine-title';

    const close = control('', shell, closeTaskPanel);
    close.className = 'room-quest-close';
    close.setAttribute('aria-label', '关闭任务');
    img(close, 'close-icon.png', 'room-quest-close-icon');

    const left = node('nav', undefined, book);
    left.className = 'room-quest-left';
    left.setAttribute('aria-label', '章节与任务列表');
    const chapterButton = control('', left, () => {
      chapterExpanded = !chapterExpanded;
      renderTaskPanel();
      taskPanel.querySelector('.room-quest-chapter')?.focus();
    });
    chapterButton.className = 'room-quest-chapter';
    chapterButton.setAttribute('aria-expanded', String(chapterExpanded));
    node('span', `第${chapter.order || 1}章 · ${chapter.spaceTitle || chapter.room || '当前章节'}`, chapterButton)
      .className = 'room-quest-chapter-name';
    img(chapterButton, 'chapter-chevron.png', 'room-quest-chapter-chevron');

    const sections = node('div', undefined, left);
    sections.className = 'room-quest-sections';
    sections.hidden = !chapterExpanded;
    if (chapterExpanded) {
      if (spotReviews.length && typeof onVisitStoryAct==='function') {
        const block=node('section',undefined,sections);
        block.className='room-quest-group';
        const heading=node('div',undefined,block);
        heading.className='room-quest-group-heading';
        img(heading,'quest-group-marker.png','room-quest-group-icon');
        node('strong','本光点回顾',heading);
        for (const sceneReview of spotReviews) {
          const button=control(sceneReview.title,block,()=>{
            selectedSpotReviewQuestId=sceneReview.questId;
            renderTaskPanel();
            taskPanel.querySelector('.room-quest-review-scene.is-selected')?.focus();
          });
          button.className='room-quest-task room-quest-review-scene'+
            (sceneReview.questId===selectedSpotReviewQuestId?' is-selected':'');
          button.title=sceneReview.title;
          button.setAttribute('aria-current',String(sceneReview.questId===selectedSpotReviewQuestId));
        }
      }
      for (const type of ['story', 'practice']) {
        const group = tasks.filter(t => t.category === type);
        if (!group.length) continue;
        const block = node('section', undefined, sections);
        block.className = 'room-quest-group';
        const heading = node('div', undefined, block);
        heading.className = 'room-quest-group-heading';
        img(heading, 'quest-group-marker.png', 'room-quest-group-icon');
        node('strong', type === 'story' ? '剧情主线' : '教学练习', heading);
        for (const entry of group) {
          const button = control(label(entry.quest), block, () => {
            selectedQuestKey = entry.key;
            selectedSpotReviewQuestId = null;
            renderTaskPanel();
            // Keyboard users stay on the corresponding selected task.
            taskPanel.querySelector('.room-quest-task.is-selected')?.focus();
          });
          button.className = 'room-quest-task' + (entry.key === selectedQuestKey ? ' is-selected' : '');
          button.setAttribute('aria-current', String(entry.key === selectedQuestKey));
          button.title = label(entry.quest);
        }
      }
    }

    const right = node('article', undefined, book);
    right.className = 'room-quest-right';
    const header = node('div', undefined, right);
    header.className = 'room-quest-detail-header';
    node('h2', chosenReview ? `回顾 · ${chosenReview.title}` :
      current ? label(current.quest) : '暂无任务', header);
    node('p', chosenReview ? '选择已完成的对白或题板。' :
      current ? (current.quest.description || '') : '', header);

    // The ornament remains in layout flow: long introductions push it down.
    img(right, 'intro-divider.png', 'room-quest-ornament');

    const objectives = node('div', undefined, right);
    objectives.className = 'room-quest-objectives';
    node('h3', chosenReview ? '已完成内容' : '任务目标', objectives);
    if (chosenReview) {
      for (const entry of chosenReview.entries) {
        const stepButton=control('',objectives,()=>perform(async()=>{
          if (!running || questMutationPending || questNavigationBusy ||
              sceneBusy || actionBusy || boardOpen || typeof onVisitStoryAct!=='function') return;
          // Recompute after every render: progress can change while the book is open.
          const fresh=reviewScenesAtSpot(chapter,state,location.id)
            .find(item=>item.questId===chosenReview.questId);
          const allowed=fresh?.entries.find(item=>item.stepId===entry.stepId &&
            item.kind===entry.kind && item.targetId===entry.targetId);
          const route=reviewEntryRoute(fresh,allowed);
          if (!route) {notify('本段尚未完成，不能回顾。');return;}
          questNavigationBusy=true;
          try {
            closeTaskPanel();
            clearTimeout(saveTimer);
            // Save only normal room position before changing backgrounds;
            // no story progress, evidence or grade is modified for a review.
            await onSave('room_spot_review_switch');
            if (running) await onVisitStoryAct(route);
          } finally {questNavigationBusy=false;}
        }));
        stepButton.className='room-quest-review-step';
        node('span',entry.title,stepButton).className='room-quest-objective-text';
        node('small',entry.kind==='board'?'题板':entry.kind==='level'?'重做电路':'对白',stepButton);
      }
    } else if (current) {
      // Only defined steps are displayed. Test data uses plain 步骤一/步骤二;
      // no story text or completed steps are inferred from the quest status.
      for (const step of current.quest.steps || []) {
        const progress = current.progress?.steps?.[step.id];
        const row = node('div', undefined, objectives);
        const active = progress?.status === 'current';
        row.className = 'room-quest-objective' + (active ? ' is-current' : '');
        const done = progress?.status === 'done';
        const prefix = sceneConfig(chapter, current.quest) ? (done ? '✓ ' : active ? '当前 · ' : '') : '';
        node('span', prefix + step.title, row).className = 'room-quest-objective-text';
        if (done) row.className += ' is-done';
        if (active) img(row, 'current-step-marker.png', 'room-quest-current');
      }
    }

    const footer = node('div', undefined, right);
    footer.className = 'room-quest-footer';
    if (chosenReview) {
      const back=control('返回任务',footer,()=>{
        selectedSpotReviewQuestId=null;
        renderTaskPanel();
      });
      back.className='room-quest-go';
      return;
    }
    const destination = taskDestination(current);
    const status = current?.progress?.status || 'not-accepted';
    const note = node('span', destination.reason || destination.target.title || destination.level.title, footer);
    note.className = 'room-quest-go-note';
    note.hidden = false;
    const replayThisScene=Boolean(current &&
      sceneConfig(chapter,current.quest,location.id) &&
      status === 'submitted' &&
      !activeSceneStep(current.quest,current.progress) &&
      spotReviews.some(item=>item.questId===current.quest.id));
    const labelGo = replayThisScene ? '重温本场'
      : sceneConfig(chapter,current?.quest,location.id) ? '前往'
      : status === 'not-accepted' && !destination.reason ? '接取并前往'
      : ['completed', 'submitted'].includes(status) && !destination.reason ? '重做关卡' : '前往';
    const go = control(labelGo, footer, () => {
      if (!running || questMutationPending || questNavigationBusy ||
          sceneBusy || actionBusy || !current) return;
      if (replayThisScene) {
        openSpotReviewInTaskBook(current.quest.id);
        return;
      }
      if (destination.reason) return;
      questNavigationBusy = true;
      renderTaskPanel();
      return perform(async () => {
        // The selected quest determines its NPC, not whichever actor the
        // player last spoke with. Other NPCs cannot hijack this route.
        const owner = actorForQuest(actors, current.quest.id);
        if (owner) setActiveActor(owner.id, {focusTask:false});
        if (sceneHere && current.quest.id === sceneQuest.id) {
          if (!activeSceneStep(sceneQuest, currentSceneProgress())) {
            openSpotReviewInTaskBook(sceneQuest.id);
            return;
          }
          if (activeSceneStep(sceneQuest, currentSceneProgress())?.condition?.boardId) {
            closeTaskPanel();
            approachTeachingStation();
            return;
          }
          if (destination.target.type === 'level') await beginSceneExercise();
          else {
            closeTaskPanel();
            if (near(owner || activeActor)) await startSceneConversation();
            else { tapTarget = (owner || activeActor).x;
              tapInteract = {type:'npc',actorId:(owner || activeActor).id};
              notify('正前往任务人物处。'); }
          }
          return;
        }
        if (current.progress.status === 'not-accepted') {
          await persistQuestStatus(current.progress, 'accepted', `quest_${current.quest.id}_accepted`);
        }
        if (!running || taskPanel.hidden) return;
        const fresh = taskDestination(current);
        if (fresh.reason || fresh.target?.id !== destination.target.id ||
            fresh.stepId !== destination.stepId) return;
        if (destination.target.type === 'dialogue') {
          closeTaskPanel();
          const owner = actorForQuest(actors, current.quest.id) || activeActor;
          setActiveActor(owner.id, {focusTask:false});
          if (near(owner)) {
            openDialogue(false, {entryId:destination.target.id, kind:'quest-target',
              questId:current.quest.id, stepId:destination.stepId});
          } else {
            pendingDialogueTarget = {
              entryId:destination.target.id, kind:'quest-target',
              questId:current.quest.id, stepId:destination.stepId,
              actorId:owner.id,
            };
            tapTarget = owner.x;
            tapInteract = {type:'npc', actorId:owner.id};
            notify('正前往任务人物处。');
          }
          return;
        }
        clearTimeout(saveTimer);
        await onGoToLevel(destination.target.id, {
          questId:current.quest.id, stepId:destination.stepId, locationId:location.id,
        });
        if (running) closeTaskPanel();
      }).finally(() => {
        questNavigationBusy = false;
        if (running) renderTaskPanel();
      });
    });
    go.className = 'room-quest-go';
    go.disabled = (!replayThisScene && Boolean(destination.reason)) ||
      Boolean(questMutationPending) || questNavigationBusy;
  }
  function refreshTaskbar() {
    // Do not show the legacy 'main' demonstration quest or label an authored
    // historical scene as a side quest. The current room owns the HUD.
    const entries = visibleTaskEntries(chapter,state);
    const local = entries.find(item => item.category === 'story' &&
      item.quest.locationId === location.id && item.progress?.status !== 'submitted');
    const current = sceneHere ? {quest:sceneQuest,progress:currentSceneProgress()} : local;
    headingLabel.textContent = current ? '当前任务' : '任务';
    taskbar.hidden = storyPreview || !current;
    taskText.textContent = current?.quest?.title || '';
    taskHint.textContent = '';
    taskHint.hidden = true;
    taskRows.replaceChildren();
    // The task book contains the complete history. The HUD only shows the
    // current step rather than every unrelated accepted quest from the chapter.
  }
  function draw(delta = .016) {
    if (!running) return;
    scene.update(state.position.x, dialogOpen, delta, activeActor?.x);
    const teachingX = currentTeachingStation();
    if (stationButton) {
      stationButton.hidden = teachingX == null;
      stationButton.style.left = `${teachingStationX * scene.metrics().units}px`;
    }
    if (soloDeskButton) {
      soloDeskButton.hidden = teachingX != null || !sceneHere;
      soloDeskButton.style.left = `${soloDeskX * scene.metrics().units}px`;
    }
    const nearTeaching = teachingX != null && Math.abs(state.position.x - teachingX) <= 110;
    const hint = nearTeaching ? '按 E 查看教学玉版；也可从任务书前往'
      : soloNarration && near() ? `按 E 翻阅算稿，听${soloNarratorName}自述`
      : near() || nearObject() ? '按 E 交谈 / 调查'
      : 'WASD / 方向键移动，E 交谈；触屏点击地面行走';
    if (line.textContent !== hint) line.textContent = hint;
  }
  function move(delta) {
    if (!running || dialogOpen) return;
    const previous = state.position.x;
    state.position.x = Math.min(WIDTH - 35, Math.max(35, state.position.x + delta));
    if (previous !== state.position.x) {
      itemInspector.close();
      pendingSave();
    }
    draw();
  }

  function addShortcut(label, id, asset, handler) {
    const b = control('', commands, () => perform(handler));
    b.className = `room-pad-key room-shortcut room-shortcut--${id}`;
    b.title = label;
    b.setAttribute('aria-label', label);
    const icon = node('img', undefined, b); icon.src = ROOM_ART + asset;
    icon.alt = ''; icon.setAttribute('aria-hidden', 'true');
    node('span', label, b).className = 'room-shortcut-label';
    return b;
  }
  const bagButton = addShortcut('行囊', 'bag', 'shortcut-inventory.png', async () => {
    itemInspector.close();
    closeTaskPanel();
    if (inventoryBar.hidden) openBagPanel(); else closeBagPanel();
  });
  const bagBadge = node('span', '', bagButton); bagBadge.className = 'room-bag-badge';
  function refreshBagBadge() {
    const count = inventory.filter(Boolean).length;
    bagBadge.textContent = String(count);
    bagBadge.hidden = count === 0;
  }
  refreshBagBadge();
  addShortcut('成就', 'achievement', 'shortcut-achievements.png', async () => {
    clearTimeout(saveTimer);
    closeDialogue();
    await onSave('room_open_achievements');
    await onAchievements();
  });
  addShortcut('商店', 'shop', 'shortcut-shop.png', async () => {
    clearTimeout(saveTimer);
    closeDialogue();
    await onSave('room_open_shop');
    await onShop();
  });
  addShortcut('排行', 'ranking', 'shortcut-ranking.png', async () => {
    clearTimeout(saveTimer);
    closeDialogue();
    await onSave('room_open_ranking');
    // A pending quest acceptance can start while the profile GET is waiting.
    // Do not switch pages until its optimistic state is committed or reverted.
    await afterQuestStability(() => onLeaderboard());
  });

  function cancelDialogueTimers() {
    clearTimeout(typingTimer);
    typingTimer = null;
  }
  function closeDialogue() {
    if (!dialogOpen) return;
    storyPlayer?.dispose();
    storyPlayer = null;
    storyRenderKey = '';
    storyContext = null;
    dialogOpen = false;
    dialogueGeneration += 1; // 使尚未执行的旧定时回调失效。
    cancelDialogueTimers();
    keys.clear();
    // Visibility changes must not cancel the in-flight task save lock.
    optionButtons = [];
    focusIndex = -1;
    optionsHost = null;
    storyBackButton = null;
    lineNode = null;
    dialogue.className = "room-dialogue";
    dialogue.replaceChildren();
    if (dialogue.style) dialogue.style.left = '';
    window.NPCDialogueDisplay?.clearSpeaker();
    scene.update(state.position.x, false);
  }

  function dialogueAction(label, handler, {duringTyping = false, disabled = false} = {}) {
    const visible = label.startsWith('接取主线') ? '接取任务' :
      label.startsWith('接取支线：') ? label.replace(/^接取支线：/, '') :
      label.startsWith('交付主线') ? '交付任务' :
      label.startsWith('交付支线：') ? label.replace('交付支线：', '交付 · ') : label;
    const item = control(visible, optionsHost, () => {
      if (!running || !dialogOpen || actionBusy || questMutationPending || disabled ||
          (storyPlayer && !lineComplete && !duringTyping)) return;
      actionBusy = true;
      for (const button of optionButtons) button.disabled = true;
      return perform(handler).finally(() => {
        actionBusy = false;
        if (dialogOpen) {
          for (const button of optionButtons) button.disabled = unavailableOptions.has(button);
        }
      });
    });
    item.className = 'npc-dialogue-option';
    item.setAttribute('aria-label', label);
    item.title = label;
    if (label.startsWith('接取主线') || label.startsWith('交付主线')) item.className += ' npc-dialogue-option--primary';
    optionButtons.push(item);
    item.disabled = disabled || actionBusy;
    if (disabled) unavailableOptions.add(item);
    return item;
  }

  async function persistQuestProgress(progress, updated, checkpoint) {
    if (questMutationPending) {
      throw new Error('任务正在保存中，请在当前操作结束后重试。');
    }
    let release;
    // Resolve this barrier only after success OR rollback has finished, so a
    // movement timer, exit button, inventory action or task-book navigation
    // cannot snapshot a failed optimistic state into the next queued PUT.
    questMutationPending = new Promise(resolve => { release = resolve; });
    const previous = JSON.parse(JSON.stringify(progress));
    try {
      Object.assign(progress, updated);
      await saveAndRefresh(checkpoint, {questMutation:true});
    } catch (error) {
      for (const field of Object.keys(progress)) delete progress[field];
      Object.assign(progress, previous);
      refreshTaskbar();
      renderTaskPanel();
      throw error;
    } finally {
      questMutationPending = null;
      release();
      // Task-book actions were intentionally disabled while the save was
      // pending. Re-render now so the player can proceed or retry immediately.
      if (running) renderTaskPanel();
    }
  }
  async function persistQuestStatus(progress, status, checkpoint) {
    return persistQuestProgress(progress, changeQuestStatus(progress, status), checkpoint);
  }

  // Ordered-quest scene controller. The authored scene policy chooses button
  // labels, dialogue entry, checkpoint names and replay; quest-flow plus the
  // standard dialogue event adapter own every state transition.
  const currentSceneProgress = () => sceneProgress(state, chapter, sceneQuest);
  function currentTeachingStation() {
    if (!sceneHere || teachingStationX == null) return null;
    return activeSceneStep(sceneQuest, currentSceneProgress())?.condition?.boardId
      ? teachingStationX : null;
  }
  function approachTeachingStation() {
    const x = currentTeachingStation();
    if (!running || x == null || dialogOpen || boardOpen || sceneBusy ||
        actionBusy || questMutationPending) return;
    closeTaskPanel();
    if (Math.abs(state.position.x - x) <= 110) {
      perform(() => openCurrentTeachingBoard());
    } else {
      tapTarget = x;
      tapInteract = {type:'teaching-board'};
      notify('正前往教学玉版处。');
    }
  }

  async function acceptSceneQuest() {
    const progress = currentSceneProgress();
    if (sceneConfig(chapter, sceneQuest)?.autoAccept &&
        progress.status === 'not-accepted') {
      clearTimeout(saveTimer);
      await persistQuestStatus(progress, 'accepted',
        sceneCheckpoint(chapter, sceneQuest, 'accept'));
    }
  }

  async function refreshScenePass() {
    const resultRows = await onGetLevelResults();
    if (!running) return;
    const progress = currentSceneProgress();
    const updated = syncFlowOfficialPass(progress, sceneQuest, resultRows);
    if (JSON.stringify(progress) !== JSON.stringify(updated)) {
      await persistQuestProgress(progress, updated,
        sceneCheckpoint(chapter, sceneQuest, 'officialPass'));
    }
  }

  async function openCurrentTeachingBoard({catalogBoardId = null} = {}) {
    if (!running || boardOpen) return;
    const progress = currentSceneProgress();
    const step = activeSceneStep(sceneQuest, progress);
    if (!catalogBoardId && !questPrerequisitesSatisfied(chapter,state,sceneQuest)) {
      notify('请先完成前一场正式剧情，再进行本次教学。'); return;
    }
    const boardId = catalogBoardId || step?.condition?.boardId;
    if (!boardId) return;
    if (!catalogBoardId) await acceptSceneQuest();
    closeDialogue();
    closeTaskPanel();
    boardOpen = true;
    try {
      const mounted = await mountMengjinBoard({
        host, boardId, readonly: Boolean(catalogBoardId),
        onSolved: async (answers) => {
          if (!running) return;
          boardOpen = false;
          boardDispose = null;
          if (catalogBoardId) {
            notify('题板回顾完成，不改变原有任务进度。');
            return;
          }
          const context = sceneDialogueContext(chapter, sceneQuest, currentSceneProgress());
          if (!context || context.stepId !== step.id) {
            throw new Error('当前任务已经变化，请从任务书重新打开题板。');
          }
          openDialogue(false, {...context, boardAnswers:answers});
        },
        onClose: () => {
          boardOpen = false; boardDispose = null;
        },
      });
      if (!running) mounted.close();
      else if (boardOpen) boardDispose = mounted.close;
    } catch (error) {
      boardOpen = false;
      boardDispose = null;
      throw error;
    }
  }

  function showSceneConversation({review = false} = {}) {
    if (!running || !sceneHere) return;
    if (!review && activeSceneStep(sceneQuest, currentSceneProgress())?.condition?.boardId) {
      approachTeachingStation(); return;
    }
    const context = sceneDialogueContext(chapter, sceneQuest,
      currentSceneProgress(), {review});
    if (!context) { notify('此任务暂未配置当前阶段的对白。'); return; }
    closeTaskPanel();
    closeDialogue();
    openDialogue(false, context);
  }

  async function enterSceneLevel({replay = false} = {}) {
    await acceptSceneQuest();
    // Previous official grades may satisfy a level step, including a historic
    // score. Never overwrite or issue a replacement grade in order to move on.
    if (!replay) await refreshScenePass();
    if (!running) return;
    const progress = currentSceneProgress();
    const step = sceneLevelStep(sceneQuest, progress, {replay});
    if (!step) {
      closeTaskPanel();
      closeDialogue();
      if (near()) showSceneConversation();
      else { tapTarget = activeActor.x; tapInteract = {type:'npc', actorId:activeActor.id};
        notify('已核对通关记录，请向任务人物回报。'); }
      return;
    }
    if (replay && !sceneConfig(chapter, sceneQuest)?.allowReplay) return;
    await onGoToLevel(step.condition.levelId, {
      questId:sceneQuest.id, stepId:step.id, locationId:location.id, replay,
    });
    if (running) { closeDialogue(); closeTaskPanel(); }
  }

  async function beginSceneExercise({replay = false} = {}) {
    if (sceneBusy || !running || !sceneHere) return;
    sceneBusy = true;
    try {
      clearTimeout(saveTimer);
      await enterSceneLevel({replay});
    } finally {
      sceneBusy = false;
    }
  }

  async function startSceneConversation() {
    if (sceneBusy || !running || !sceneHere) return;
    if (!questPrerequisitesSatisfied(chapter,state,sceneQuest)) {
      notify('本段授业尚未解锁，请先完成上一段并交付任务。'); return;
    }
    sceneBusy = true;
    try {
      await acceptSceneQuest();
      const progress = currentSceneProgress();
      if (!activeSceneStep(sceneQuest, progress) && progress.status === 'completed' &&
          sceneConfig(chapter, sceneQuest)?.autoSubmit) {
        await persistQuestStatus(progress, 'submitted',
          sceneCheckpoint(chapter, sceneQuest, 'submit'));
      }
      if (running) {
        if (!activeSceneStep(sceneQuest,currentSceneProgress())) {
          openSpotReviewInTaskBook(sceneQuest.id);
        } else if (activeSceneStep(sceneQuest, currentSceneProgress())?.condition?.boardId) {
          // The NPC points the player toward the physical station.
          sceneBusy = false;
          approachTeachingStation();
        } else showSceneConversation();
      }
    } finally {
      sceneBusy = false;
    }
  }

  async function finishSceneDialogue(action) {
    if (sceneBusy || !running || !dialogOpen || storyContext?.kind !== 'scene-flow') return;
    const generation = dialogueGeneration;
    const context = storyContext;
    sceneBusy = true;
    try {
      clearTimeout(saveTimer);
      const finalParagraphId = storyPlayer?.getState()?.paragraphId;
      const event = prepareQuestDialogueFinish({
        chapter, state, locationId:location.id,
        context:{...context, kind:'quest-target'},
        finalParagraphId,
        allowHistorical:true,
      });
      // A report can have TWO server writes: record its final dialogue step,
      // then submit the completed quest. If the second PUT fails, keep the
      // dialogue's "完成本场" button usable without replaying the first write.
      // This is generic for any authored final dialogue + autoSubmit scene.
      const lastStep = sceneQuest.steps.at(-1);
      const progressBefore = currentSceneProgress();
      const retryPendingSubmit = action === 'complete-and-submit' && !event &&
        lastStep?.id === context.stepId &&
        lastStep.condition?.type === 'dialogue-finished' &&
        lastStep.condition.dialogueId === finalParagraphId &&
        progressBefore.steps?.[lastStep.id]?.status === 'done' &&
        progressBefore.status === 'completed' &&
        sceneConfig(chapter, sceneQuest)?.autoSubmit;
      if (!event && !retryPendingSubmit) {
        notify('对白进度已经变化，请重新打开当前任务。');
        return;
      }
      // All newly finished scene steps use the SAME evidence-producing path
      // as a newly authored quest; only a failed second PUT retries submission.
      if (event) {
        const finishedStep = sceneQuest.steps.find(step => step.id === event.stepId);
        const boardId = finishedStep?.condition?.boardId;
        if (boardId) {
          if (!context.boardAnswers) {notify('请先完成题板操作，才能记录这一步。');return;}
          event.updated.steps[event.stepId].evidence = {
            ...event.updated.steps[event.stepId].evidence,
            boardId, boardAnswers:context.boardAnswers,
          };
        }
        await persistQuestProgress(event.progress, event.updated,
          sceneCheckpoint(chapter, sceneQuest, 'step', event.stepId));
      }
      const finishedCondition = event && sceneQuest.steps.find(step => step.id === event.stepId)?.condition;
      if (finishedCondition?.type === 'dialogue-finished' &&
          activeSceneStep(sceneQuest, currentSceneProgress())?.condition?.type === 'level-completed') {
        try { await refreshScenePass(); }
        catch (error) {
          if (error.code === 'REVISION_CONFLICT') throw error;
          notify('说明已保存，成绩核对暂未成功；可稍后从任务书重试。');
        }
      }
      const progress = currentSceneProgress();
      if (action === 'complete-and-submit' &&
          progress.status === 'completed' && sceneConfig(chapter, sceneQuest)?.autoSubmit) {
        await persistQuestStatus(progress, 'submitted',
          sceneCheckpoint(chapter, sceneQuest, 'submit'));
      }
      if (!running || !dialogOpen || generation !== dialogueGeneration) return;
      closeDialogue();
      renderTaskPanel();
      if (action === 'complete-and-submit') {
        const finishedTitle = sceneQuest.title;
        const nextQuest = sceneQuests.find(q => q.id !== sceneQuest.id &&
          questPrerequisitesSatisfied(chapter,state,q) &&
          sceneProgress(state,chapter,q)?.status !== 'submitted');
        const nextActor = actorForQuest(actors,nextQuest?.id);
        // This is the sole post-submit NPC switch; dialogueAction still holds
        // actionBusy until this async handler completes, so explicitly permit it.
        if (nextActor) setActiveActor(nextActor.id, {allowSubmittedTransition:true});
        notify(nextActor ? (soloNarration
          ? `${finishedTitle}已完成，继续在书案整理下一页算稿。`
          : `${finishedTitle}已完成，请走向${nextActor.name}继续。`) :
          `${finishedTitle}：本场已完成。`);
        openTaskPanel();
      } else if (action === 'complete-and-level') {
        // The current dialogue's save and score checks are finished. Navigate
        // using the next authored step, never a fixed workshop level ID.
        sceneBusy = false;
        await beginSceneExercise();
      } else notify(sceneHint(chapter, sceneQuest, progress));
    } finally {
      sceneBusy = false;
    }
  }

  function sceneEndOptions() {
    const progress = currentSceneProgress();
    const actions = sceneEndActions(chapter, sceneQuest, progress, storyContext);
    for (const entry of actions) {
      const operation = entry.action;
      const handler = {
        complete: () => finishSceneDialogue(operation),
        'complete-and-level': () => finishSceneDialogue(operation),
        'complete-and-submit': () => finishSceneDialogue(operation),
        level: () => beginSceneExercise(),
        review: () => openSpotReviewInTaskBook(sceneQuest.id),
        'replay-level': () => beginSceneExercise({replay:true}),
        current: () => activeSceneStep(sceneQuest,currentSceneProgress())
          ? showSceneConversation() : openSpotReviewInTaskBook(sceneQuest.id),
        exit: async () => { closeDialogue(); await onExit(); },
        close: closeDialogue,
      }[operation];
      if (handler) dialogueAction(entry.label, handler);
    }
    if (!actions.length) dialogueAction('结束对话', closeDialogue);
  }

  async function openFormalLevels() {
    clearTimeout(saveTimer);
    closeDialogue();
    await onStartLevel();
  }

  function questOption(quest, object, main) {
    // In a multi-actor room, an NPC only exposes its OWN configured scene.
    if (actors.length > 1 && sceneConfig(chapter, quest, location.id) &&
        quest?.id !== activeActor.questId) return;
    if (sceneHere && quest?.id === sceneQuest.id) {
      dialogueAction(sceneHint(chapter, sceneQuest, currentSceneProgress()),
        () => startSceneConversation());
      return;
    }
    if (!quest || !object || (object.status === "submitted" && !main)) return;
    // The retired scaffolding quests remain in the save and server registry;
    // story NPCs must not advertise their unrelated circuit/sample actions.
    if (location.roomType === 'story' &&
        (quest.id === 'main' || quest.id === 'side-test' || quest.id === 'binary-decoder')) return;
    // NPC must not expose an acceptance or submission path that the task book
    // and the server would reject for unmet prerequisites.
    if (!questPrerequisitesSatisfied(chapter, state, quest)) return;
    if (object.status === "not-accepted") {
      dialogueAction("接取" + quest.title, async () => {
        await persistQuestStatus(object, "accepted", `quest_${quest.id}_accepted`);
        renderDialogueOptions(); renderTaskPanel(); notify(`已接取任务：${quest.title}`);
      });
    } else if (object.status === "accepted") {
      if (main) {
        dialogueAction("进入电路关卡", openFormalLevels);
      } else if (quest.completion?.mode === 'test-only') {
        // Explicit test-only step progression. Never treats a placeholder as a
        // formal achievement or grants an undeveloped story reward.
        const step = currentTestStep(quest, object);
        if (step) {
          dialogueAction(step.title + '（测试）', async () => {
            const next = advanceTestStep(object, quest);
            await persistQuestProgress(object, next, `test_step_${quest.id}_${step.id}`);
            renderDialogueOptions();
            renderTaskPanel();
          });
        }
      }
    } else if (object.status === "completed") {
      dialogueAction("交付" + quest.title, async () => {
        await persistQuestStatus(object, "submitted", `quest_${quest.id}_submitted`);
        renderDialogueOptions(); renderTaskPanel(); notify(`任务交付：${quest.title}`);
      });
      if (main) {
        dialogueAction("进入电路关卡", openFormalLevels);
      }
    } else if (object.status === "submitted" && main) {
      dialogueAction("进入电路关卡", openFormalLevels);
    }
  }

  function renderDialogueOptions() {
    if (!running || !dialogOpen || !optionsHost) return;
    const oldFocus = optionButtons.indexOf(document.activeElement);
    const desiredFocus = oldFocus >= 0 ? oldFocus : focusIndex;
    optionsHost.replaceChildren();
    optionButtons = [];
    questOption(chapter.quests?.main, state.tasks.main, true);
    for (const quest of chapter.quests?.side ?? []) {
      questOption(quest, state.tasks.side[quest.id], false);
    }
    dialogueAction("结束对话", closeDialogue);
    focusIndex = Math.max(0, Math.min(desiredFocus < 0 ? 0 : desiredFocus, optionButtons.length - 1));
    optionsHost.className = "npc-dialogue-options" + (lineComplete ? " npc-dialogue-options--ready" : "");
    optionsHost.style?.setProperty?.("--room-option-columns", String(Math.min(4, Math.max(1, optionButtons.length))));
    if (lineComplete) optionButtons[focusIndex]?.focus?.();
  }

  function finishTyping() {
    if (storyPlayer) { storyPlayer.advance(); return; }
    if (!dialogOpen || lineComplete) return;
    clearTimeout(typingTimer);
    typingTimer = null;
    lineIndex = lineCharacters.length;
    if (lineNode) lineNode.textContent = lineCharacters.join("");
    lineComplete = true;
    if (optionsHost) optionsHost.className += " npc-dialogue-options--ready";
  }
  function startTyping() {
    const generation = dialogueGeneration;
    function tick() {
      if (!running || !dialogOpen || generation !== dialogueGeneration || lineComplete) return;
      lineIndex += 1;
      lineNode.textContent = lineCharacters.slice(0, lineIndex).join("");
      if (lineIndex < lineCharacters.length) {
        typingTimer = setTimeout(tick, TYPEWRITER_DELAY);
      } else {
        finishTyping();
      }
    }
    typingTimer = setTimeout(tick, TYPEWRITER_DELAY);
  }
  function alignStoryDialogue() {
    if (!dialogOpen || !storyPlayer || !dialogue.style) return;
    const width = document.documentElement?.clientWidth || window.innerWidth || stage.getBoundingClientRect().width;
    if (!Number.isFinite(width) || width <= 0) return;
    // Narrow screens already put the shortcuts below the dialogue.
    if (width <= 950) { dialogue.style.left = '50%'; return; }
    const buttons = commands.getBoundingClientRect();
    const panelWidth = dialogue.getBoundingClientRect().width;
    if (!Number.isFinite(panelWidth) || panelWidth <= 0) return;
    // Center in the SPACE TO THE LEFT of the right-hand shortcuts. When the
    // shortcuts are hidden, retain their usual reserved strip rather than
    // jumping back to the center of the whole screen.
    const measured = buttons.width > 0 && buttons.left > width * .3 && buttons.left < width;
    if (measured) shortcutReservedWidth = width - buttons.left;
    const buttonsLeft = measured ? buttons.left
      : width - (shortcutReservedWidth || Math.min(420, Math.max(280, width * .2)));
    const freeRight = buttonsLeft - 24;
    const minimum = panelWidth / 2 + 12;
    const maximum = width - panelWidth / 2 - 12;
    const center = Math.max(minimum, Math.min(maximum, freeRight / 2));
    dialogue.style.left = `${center}px`;
  }
  function renderStory(snapshot) {
    lineComplete = snapshot.phase !== 'typing';
    const oldText = lineNode.textContent;
    lineNode.textContent = snapshot.text;
    // Keep new lines visible; do not fight a reader scrolling an already complete line.
    if (oldText !== snapshot.text && !lineComplete) lineNode.scrollTop = lineNode.scrollHeight;
    const renderKey = `${snapshot.paragraphId}:${snapshot.lineIndex}:${snapshot.phase}:${snapshot.canGoBack}:${snapshot.canGoForward}`;
    if (renderKey === storyRenderKey) return;
    storyRenderKey = renderKey;
    if (storyBackButton) storyBackButton.disabled = !snapshot.canGoBack || actionBusy || Boolean(questMutationPending);
    speakerNode.textContent = snapshot.speaker.name;
    dialogue.setAttribute('aria-label', `与${snapshot.speaker.name}对话`);
    lineNode.setAttribute('aria-label', `${snapshot.speaker.name}：${snapshot.fullText}`);
    window.NPCDialogueDisplay?.setSpeaker({
      ...snapshot.speaker, hidePortrait: !snapshot.speaker.id && !snapshot.speaker.portrait,
    });
    optionsHost.replaceChildren();
    optionButtons = [];
    focusIndex = 0;
    optionsHost.className = 'npc-dialogue-options npc-dialogue-options--ready';
    if (snapshot.phase === 'typing' || snapshot.phase === 'line') {
      dialogueAction('继续', () => storyPlayer?.advance(), {duringTyping: true});
    } else if (snapshot.phase === 'choices') {
      snapshot.options.forEach((option, index) => {
        dialogueAction(option.text, () => storyPlayer?.choose(index));
      });
    } else if (storyContext?.kind === 'scene-flow' ||
               storyContext?.kind === 'scene-review') {
      sceneEndOptions();
    } else {
      dialogueAction('关闭', () => storyPlayer?.advance());
      if (!storyContext && !storyPreview &&
          (chapter.quests?.main || chapter.quests?.side?.length)) {
        dialogueAction('任务', () => { closeDialogue(); openTaskPanel(); });
      }
    }
    // Always offer a pointer/touch exit, including halfway through typing.
    if (snapshot.phase !== 'end') {
      const leave = control('关闭', optionsHost, closeDialogue);
      leave.className = 'npc-dialogue-option npc-dialogue-option--leave';
    }
    lineNode.tabIndex = 0;
    if (snapshot.phase === 'choices') optionButtons[0]?.focus?.();
  }
  function finishActiveStory() {
    // Capture before disposing the player. '上一句', replay and early Escape
    // never invoke the player's terminal onFinish callback.
    const finalParagraphId = storyPlayer?.getState()?.paragraphId;
    const context = storyContext;
    const event = prepareQuestDialogueFinish({
      chapter, state, locationId:location.id, context, finalParagraphId,
    });
    // Start the mutation BEFORE closing the dialogue: its room-level barrier
    // must protect an immediate move/exit auto-save from optimistic state.
    const save = event
      ? persistQuestProgress(event.progress, event.updated, event.checkpoint)
      : null;
    closeDialogue();
    if (save) perform(async () => {
      await save;
      if (!running) return;
      notify('剧情步骤已记录，可从任务书前往下一步。');
      renderTaskPanel();
    });
  }

  function openDialogue(legacy = false, context = null) {
    storyContext = context;
    const paragraphId = legacy ? null : context?.entryId || activeActor?.dialogueId ||
      (actors.length === 1 ? location.dialogueId : null);
    const scripted = Boolean(paragraphId);
    itemInspector.close();
    closeBagPanel();
    tapTarget = null;
    tapInteract = null;
    taskPanel.hidden = true;
    inventoryBar.hidden = true;
    taskToggle.setAttribute('aria-expanded', 'false');
    dialogOpen = true;
    dialogueGeneration += 1;
    cancelDialogueTimers();
    keys.clear();
    // Visibility changes must not cancel the in-flight task save lock.
    optionButtons = [];
    focusIndex = -1;
    lineCharacters = Array.from(activeActor?.npcLine ||
      (actors.length === 1 ? (location.npcLine || chapter.npcLine || '') : ''));
    lineIndex = 0;
    lineComplete = lineCharacters.length === 0;
    dialogue.className = "room-dialogue room-dialogue--open" + (scripted ? ' room-dialogue--story' : '');
    dialogue.replaceChildren();
    const layout = node('div', undefined, dialogue);
    layout.className = 'npc-dialogue-layout';
    const portrait = node('div', undefined, layout);
    portrait.className = 'npc-dialogue-portrait';
    portrait.setAttribute('aria-label', '预留角色立绘区域');
    const speaker = node('span', activeActor?.name || chapter.npc, layout);
    speaker.className = 'npc-dialogue-speaker';
    speakerNode = speaker;
    const body = node('div', undefined, layout);
    body.className = 'npc-dialogue-body';
    if (!lineComplete || scripted) {
      lineNode = node('p', '', body);
      lineNode.className = 'npc-dialogue-line';
      lineNode.setAttribute('aria-label', 'NPC 台词');
    } else {
      lineNode = null;
      layout.className += ' npc-dialogue-layout--no-line';
    }
    optionsHost = node('div', undefined, body);
    optionsHost.className = "npc-dialogue-options";
    optionsHost.setAttribute("aria-label", "对话选项");
    if (scripted) {
      // A separate art-only control on the dialogue sheet's text-side edge.
      // It does not consume a choice slot or overlap the portrait/nameplate.
      storyBackButton = control('', layout, () => {
        if (!dialogOpen || !storyPlayer || actionBusy || questMutationPending || sceneBusy) return;
        storyPlayer.previous();
      });
      storyBackButton.className = 'npc-dialogue-back-arrow';
      storyBackButton.setAttribute('aria-label','回到上一句');
      storyBackButton.title = '回到上一句';
      const backArtwork = node('img',undefined,storyBackButton);
      backArtwork.src = '/assets/room/dialogue-back-arrow.png';
      backArtwork.alt = '';backArtwork.setAttribute('aria-hidden','true');
      storyBackButton.disabled = true;
      try {
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        storyPlayer = createDialoguePlayer({
          dialogues: chapter.dialogues, entryId: paragraphId, characters,
          delay: reducedMotion ? 0 : TYPEWRITER_DELAY,
          onChange: renderStory, onFinish: finishActiveStory,
        });
        storyPlayer.start();
        alignStoryDialogue();
        lineNode.focus?.();
      } catch (error) {
        closeDialogue();
        perform(() => { throw error; });
      }
    } else {
      renderDialogueOptions();
      if (!lineComplete) startTyping();
    }
  }

  function interact(actorId = null) {
    if (!running || sceneBusy || actionBusy || questMutationPending) return;
    if (dialogOpen) {
      if (storyPlayer) {
        if (storyContext && storyPlayer.getState().phase === 'end') optionButtons[0]?.click();
        else storyPlayer.advance();
        return;
      }
      if (!lineComplete) finishTyping();
      return;
    }
    if (!actorId && currentTeachingStation() != null &&
        Math.abs(state.position.x - currentTeachingStation()) <= 110) {
      approachTeachingStation();
      return;
    }
    if (!actorId && nearObject()) {
      perform(inspectRoomObject);
      return;
    }
    const actor = actorId ? actors.find(item => item.id === actorId)
      : soloNarration ? activeActor : closestActor(actors, state.position.x, DISTANCE);
    if (!actor || !near(actor)) {
      dialogue.className = "room-dialogue room-dialogue--notice";
      dialogue.replaceChildren();
      node("p", soloNarration ? "请靠近书案，再翻阅算稿。" : "请靠近 NPC 再交互。", dialogue);
      return;
    }
    setActiveActor(actor.id);
    if (pendingDialogueTarget && pendingDialogueTarget.actorId &&
        pendingDialogueTarget.actorId !== actor.id) {
      pendingDialogueTarget = null; // Never show another NPC's task dialogue.
    }
    if (pendingDialogueTarget) {
      const context = pendingDialogueTarget;
      pendingDialogueTarget = null;
      const quest = [chapter.quests?.main, ...(chapter.quests?.side || [])]
        .find(item => item?.id === context.questId);
      const progress = quest === chapter.quests?.main
        ? state.tasks?.main : state.tasks?.side?.[context.questId];
      const currentTarget = taskDestination({quest,progress});
      if (currentTarget.reason || currentTarget.target?.type !== 'dialogue' ||
          currentTarget.target.id !== context.entryId ||
          currentTarget.stepId !== context.stepId) {
        notify('任务目标已更新，请从任务书重新选择前往。');
        return;
      }
      openDialogue(false, context);
      return;
    }
    if (sceneHere) { return perform(startSceneConversation); }
    if (!storyPreview && actors.length === 1 && !state.dialogues.includes("npc_first_interaction")) {
      state.dialogues.push("npc_first_interaction");
      perform(() => onSave("npc_first_dialogue"));
    }
    openDialogue();
  }

  function onDialogueClick(event) {
    if (!dialogOpen || sceneBusy || actionBusy || questMutationPending) return;
    if (storyPlayer) {
      // Button handlers own their click; bubbling must not advance the next line.
      if (event?.target?.closest?.('button')) return;
      if (storyPlayer.getState().phase === 'choices') return;
      event?.preventDefault?.();
      if (storyContext && storyPlayer.getState().phase === 'end') optionButtons[0]?.click();
      else storyPlayer.advance();
      return;
    }
    if (!lineComplete) {
      // 冒泡到面板上的点击补完台词，不会误触发任务。
      event?.preventDefault?.();
      finishTyping();
    }
  }
  function onCanvasClick(event) {
    if (boardOpen || !running || dialogOpen || !canvas.getBoundingClientRect) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const cssX = event.clientX - bounds.left;
    const cssY = event.clientY - bounds.top;
    const worldX = scene.toWorld(event.clientX, bounds);
    const clickedActor = !soloNarration && actors.find(actor =>
      Math.abs(cssX - scene.screenX(actor.x)) < 42 &&
      cssY > bounds.height * .45 && cssY < bounds.height * .85);
    if (clickedActor) {
      if (sceneBusy || actionBusy || questMutationPending) return;
      if (near(clickedActor)) interact(clickedActor.id);
      else { setActiveActor(clickedActor.id); tapTarget = clickedActor.x;
        tapInteract = {type:'npc', actorId:clickedActor.id}; }
      return;
    }
    const teachingX = currentTeachingStation();
    if (teachingX != null && Math.abs(cssX - scene.screenX(teachingX)) < 50 &&
        cssY > bounds.height * .40 && cssY < bounds.height * .82) {
      approachTeachingStation();
      return;
    }
    if (soloNarration && currentTeachingStation() == null &&
        Math.abs(cssX - scene.screenX(soloDeskX)) < 76 &&
        cssY > bounds.height*.44 && cssY < bounds.height*.82) {
      if (near(activeActor)) interact(activeActor.id);
      else {tapTarget=soloDeskX;tapInteract={type:'npc',actorId:activeActor.id};}
      return;
    }
    if (roomObject && Math.abs(cssX - scene.screenX(roomObject.x)) < 34 && cssY > bounds.height * .45) {
      if (nearObject()) interact();
      else { tapTarget = roomObject.x; tapInteract = 'object'; }
      return;
    }
    // Pointer coordinates are mapped through the very same camera as the scene and NPC.
    if (cssY > bounds.height * .30) {
      tapTarget = worldX;
      tapInteract = null;
    }
  }
  function onKeyDown(event) {
    if (boardOpen) {
      if (event.code === 'Escape') {
        event.preventDefault();
        host.querySelector('.mj-board-modal .mj-story-quiet')?.click();
      }
      return;
    }
    const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (!running || (!dialogOpen && isInput)) return;
    const code = event.code;
    if (code === "Escape" && itemInspector.isOpen() && taskPanel.hidden && inventoryBar.hidden && !dialogOpen) {
      event.preventDefault();
      itemInspector.close();
      return;
    }
    if (!inventoryBar.hidden) {
      if (code === 'Escape') { event.preventDefault(); closeBagPanel(); return; }
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyA','KeyD','KeyE','Space'].includes(code)) {
        event.preventDefault();
      }
      return;
    }
    if (!taskPanel.hidden) {
      if (code === 'Escape') { event.preventDefault(); closeTaskPanel(); return; }
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyA','KeyD','KeyE','Space'].includes(code)) {
        event.preventDefault();
      }
      return;
    }
    if (dialogOpen) {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyA", "KeyD", "KeyE", "Escape"].includes(code)) {
        event.preventDefault();
      }
      if (code === "Escape") { closeDialogue(); return; }
      if (storyPlayer) {
        if (['KeyE', 'Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(code)) event.preventDefault();
        if (event.repeat) return;
        if (['Enter', 'Space'].includes(code) && document.activeElement?.classList?.contains('npc-dialogue-option--leave')) {
          closeDialogue(); return;
        }
        const phase = storyPlayer.getState().phase;
        if (sceneBusy || actionBusy || questMutationPending) return;
        if (['KeyE', 'Space', 'Enter'].includes(code)) {
          const focused = optionButtons.includes(document.activeElement) ? document.activeElement : null;
          if (phase === 'choices' || (phase === 'end' && storyContext) || (code !== 'KeyE' && focused)) {
            const target = focused && !focused.disabled ? focused : optionButtons.find(button => !button.disabled);
            target?.click();
          } else storyPlayer.advance();
        } else if (['ArrowUp', 'ArrowDown'].includes(code) && lineComplete && optionButtons.length) {
          const enabled = optionButtons.filter(button => !button.disabled);
          const current = enabled.indexOf(document.activeElement);
          const step = code === 'ArrowDown' ? 1 : -1;
          const base = current >= 0 ? current : (step === 1 ? -1 : 0);
          const next = enabled[(base + step + enabled.length) % enabled.length];
          focusIndex = optionButtons.indexOf(next);
          next?.focus?.();
        }
        return;
      }
      if (event.repeat) return;
      if (code === 'Enter' && !lineComplete) { event.preventDefault(); finishTyping(); return; }
      if ((code === "KeyE" || code === "Space") && !lineComplete) {
        event.preventDefault();
        finishTyping();
        return;
      }
      if (code === "KeyE" || code === "Space") return;
      if ((code === "ArrowUp" || code === "ArrowDown") && optionButtons.length) {
        const step = code === "ArrowDown" ? 1 : -1;
        const current = optionButtons.indexOf(document.activeElement);
        const index = current >= 0 ? current : focusIndex;
        focusIndex = (index + step + optionButtons.length) % optionButtons.length;
        optionButtons[focusIndex].focus?.();
        return;
      }
      if (code === "Enter" && optionButtons.length) {
        event.preventDefault();
        const current = optionButtons.indexOf(document.activeElement);
        optionButtons[current >= 0 ? current : Math.max(focusIndex, 0)].click();
      }
      return; // 交谈中不再把左右键加入移动按键集合。
    }
    if (["ArrowLeft", "ArrowRight", "KeyA", "KeyD", "KeyE"].includes(code)) {
      event.preventDefault();
    }
    if (code === "KeyE" && !event.repeat) { interact(); return; }
    if (["ArrowLeft", "KeyA"].includes(code)) { keys.add('left'); tapTarget = null; tapInteract = null; }
    if (["ArrowRight", "KeyD"].includes(code)) { keys.add('right'); tapTarget = null; tapInteract = null; }
  }
  function onKeyUp(event) {
    if (["ArrowLeft", "KeyA"].includes(event.code)) keys.delete("left");
    if (["ArrowRight", "KeyD"].includes(event.code)) keys.delete("right");
  }
  function onBlur() { keys.clear(); }
  function frame(time) {
    if (!running) return;
    const dt = lastFrame ? Math.min(0.05, (time - lastFrame) / 1000) : 0;
    lastFrame = time;
    const dir = Number(keys.has("right")) - Number(keys.has("left"));
    if (dir && !boardOpen && !dialogOpen && taskPanel.hidden) move(dir * MOVE_SPEED * dt);
    if (!dir && tapTarget != null && !boardOpen && !dialogOpen && taskPanel.hidden) {
      const distance = tapTarget - state.position.x;
      if (Math.abs(distance) <= Math.max(1, MOVE_SPEED * dt)) {
        state.position.x = tapTarget;
        tapTarget = null;
        const action = tapInteract;
        tapInteract = null;
        if (action?.type === 'npc') {
          const npc = actors.find(item => item.id === action.actorId);
          if (near(npc)) interact(npc.id);
        } else if (action === 'object' && nearObject()) interact();
        else if (action?.type === 'teaching-board' && currentTeachingStation() != null) {
          approachTeachingStation();
        }
      } else move(Math.sign(distance) * MOVE_SPEED * dt);
    }
    draw(dt);
    frameHandle = requestAnimationFrame(frame);
  }

  const touchControls = node('nav', undefined, stage);
  touchControls.className = 'room-touch-controls';
  touchControls.setAttribute('aria-label', '移动与交互');
  control('向左', touchControls, () => move(-45)).className = 'room-touch-move';
  control('向右', touchControls, () => move(45)).className = 'room-touch-move';
  control('与 NPC 交互', touchControls, () => interact()).className = 'room-touch-interact';

  dialogue.addEventListener("click", onDialogueClick);
  canvas.addEventListener("click", onCanvasClick);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener('resize', alignStoryDialogue);
  const dialogueAlignmentObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(alignStoryDialogue);
  dialogueAlignmentObserver?.observe(stage);
  dialogueAlignmentObserver?.observe(commands);
  renderTaskPanel(); refreshTaskbar();
  frameHandle = requestAnimationFrame(frame);
  // A chapter-directory visit is read-only: no quest progress or scores change.
  if (returnContext?.catalogEntryId || returnContext?.catalogBoardId ||
      returnContext?.catalogLevelId) {
    queueMicrotask(() => {
      if (!running) return;
      if (returnContext.catalogLevelId && sceneQuest?.id===returnContext.questId) {
        // Completed formal scene: open the existing circuit editor in replay
        // mode. This may create a new attempt, but never completes a story step.
        perform(() => beginSceneExercise({replay:true}));
      } else if (returnContext.catalogBoardId) {
        perform(() => openCurrentTeachingBoard({catalogBoardId:returnContext.catalogBoardId}));
      } else if (chapter.dialogues?.some(item => item.id === returnContext.catalogEntryId)) {
        openDialogue(false, {kind:'catalog-review', entryId:returnContext.catalogEntryId});
      }
    });
  }
  function dispose() {
    running = false;
    stage.inert = false;
    topbar.inert = false;
    boardDispose?.(); boardDispose = null; boardOpen = false;
    closeDialogue();
    cancelDialogueTimers();
    cancelAnimationFrame(frameHandle);
    clearTimeout(saveTimer);
    clearTimeout(walletTimer);
    for (const timer of toastTimers) clearTimeout(timer);
    toastTimers.clear();
    keys.clear();
    itemInspector.dispose();
    scene.dispose();
    dialogue.removeEventListener("click", onDialogueClick);
    canvas.removeEventListener("click", onCanvasClick);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener('resize', alignStoryDialogue);
    dialogueAlignmentObserver?.disconnect();
  }
  // Keep this callback on the existing disposer instead of changing
  // createRoom's public return type or introducing a new UI dependency.
  dispose.refreshTaskView = () => {
    if (running) { renderTaskPanel(); refreshTaskbar(); }
  };
  return dispose;
}
