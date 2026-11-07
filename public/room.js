/* 房间交互、任务与对话状态由页面协调；镜头及调查物分别由独立模块负责。 */
import { createRoomWorld, ROOM_NPC_X, ROOM_WORLD_WIDTH } from "./room-world.js";
import { findRoomObject, createItemInspector } from "./room-interactions.js";
import { mountNavigationPath } from "./navigation-path.js";
import {normalizeQuestCollection, changeQuestStatus, advanceTestStep,
        currentTestStep} from "./task-model.js";
const WIDTH = ROOM_WORLD_WIDTH;
const NPC_X = ROOM_NPC_X;
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
  host, chapter, state, location = {}, wallet = 0, inventory = [],
  onProfileChange = () => {}, onHome = () => {}, onSettings = () => {},
  onAchievements = () => {}, onShop = () => {}, onLeaderboard = () => {},
  onSave, onStartLevel, onExit, onWorldMap = onExit, onError,
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

  const stage = node('main', undefined, host); stage.className = 'room-stage';
  stage.setAttribute('aria-label', `${location.name || chapter.room} · 房间场景`);
  const canvas = node('canvas', undefined, stage);
  canvas.width = 1600; canvas.height = 900;
  canvas.className = 'room-canvas';
  canvas.setAttribute('aria-label', '点击地面寻路，WASD 或方向键移动，E 与人物交谈');
  const scene = createRoomWorld({
    stage, background: location.background, npcName: chapter.npc,
    getPlayerX: () => state.position.x,
    onNpcClick: () => {
      if (near()) interact();
      else { tapTarget = NPC_X; tapInteract = 'npc'; }
    },
  });

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
  node('strong', '主线任务', taskHeading);
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
  let selectedQuestKey = 'main';
  let chapterExpanded = true;

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
  itemInspector.close();
  closeTaskPanel();
  inventoryBar.hidden = false;
  stage.inert = true;
  topbar.inert = true;
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
  let optionButtons = [];
  let focusIndex = -1;
  let actionBusy = false;
  const keys = new Set();
  let tapTarget = null;
  let tapInteract = null;


  async function saveAndRefresh(checkpoint) {
    const previousBalance = Number(walletValue.textContent) || 0;
    const reply = await onSave(checkpoint);
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
  function near() {
    return Math.abs(state.position.x - NPC_X) <= DISTANCE;
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
    itemInspector.close();
    closeBagPanel();
    keys.clear();
    tapTarget = null;
    tapInteract = null;
    renderTaskPanel();
    taskPanel.hidden = false;
    stage.inert = true;
    topbar.inert = true;
    taskToggle.setAttribute('aria-expanded', 'true');
    taskPanel.querySelector('.room-quest-close')?.focus();
  }
  function renderTaskPanel() {
    const main = chapter.quests?.main;
    const side = chapter.quests?.side || [];
    // Keep identity stable through quest updates and changes in task count.
    const tasks = [
      ...(main ? [{key:'main', quest:main, progress:state.tasks.main, category:'main'}] : []),
      ...side.map((quest, i) => ({
        key:'side:' + (quest.id ?? i), quest,
        progress:state.tasks.side[quest.id], category:'side'
      })),
    ];
    if (!tasks.some(t => t.key === selectedQuestKey)) {
      selectedQuestKey = tasks[0]?.key || '';
    }
    const current = tasks.find(t => t.key === selectedQuestKey);
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
      for (const type of ['main', 'side']) {
        const group = tasks.filter(t => t.category === type);
        const block = node('section', undefined, sections);
        block.className = 'room-quest-group';
        const heading = node('div', undefined, block);
        heading.className = 'room-quest-group-heading';
        img(heading, 'quest-group-marker.png', 'room-quest-group-icon');
        node('strong', type === 'main' ? '主线任务' : '支线任务', heading);
        if (!group.length) {
          node('p', '暂无任务', block).className = 'room-quest-empty';
        }
        for (const entry of group) {
          const button = control(label(entry.quest), block, () => {
            selectedQuestKey = entry.key;
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
    node('h2', current ? label(current.quest) : '暂无任务', header);
    node('p', current ? (current.quest.description || '') : '', header);

    // The ornament remains in layout flow: long introductions push it down.
    img(right, 'intro-divider.png', 'room-quest-ornament');

    const objectives = node('div', undefined, right);
    objectives.className = 'room-quest-objectives';
    node('h3', '任务目标', objectives);
    if (current) {
      // Only defined steps are displayed. Test data uses plain 步骤一/步骤二;
      // no story text or completed steps are inferred from the quest status.
      for (const step of current.quest.steps || []) {
        const progress = current.progress?.steps?.[step.id];
        const row = node('div', undefined, objectives);
        const active = progress?.status === 'current';
        row.className = 'room-quest-objective' + (active ? ' is-current' : '');
        node('span', step.title, row).className = 'room-quest-objective-text';
        if (active) img(row, 'current-step-marker.png', 'room-quest-current');
      }
    }

    const footer = node('div', undefined, right);
    footer.className = 'room-quest-footer';
    const note = node('span', '“前往”功能将在后续版本接入', footer);
    note.className = 'room-quest-go-note';
    note.hidden = true;
    const go = control('前往', footer, () => { note.hidden = false; });
    go.className = 'room-quest-go';
    go.disabled = !current;
  }
  function refreshTaskbar() {
    const main = chapter.quests?.main;
    const mainStatus = state.tasks.main?.status || 'not-accepted';
    const name = main?.title || '主线任务';
    taskText.textContent = name;
    const hint = taskName(mainStatus);
    taskHint.textContent = hint;
    taskbar.hidden = !main && !(chapter.quests?.side || []).length;
    taskRows.replaceChildren();
    const entries = [];
    for (const quest of chapter.quests?.side || []) {
      const status = state.tasks.side?.[quest.id]?.status || 'not-accepted';
      if (status === 'not-accepted' || status === 'submitted') continue;
      let detail = quest.hint || taskName(status);
      entries.push({title: quest.title.replace(/^支线[：:]\s*/, ''), detail});
    }
    // A single rule separates the main quest group from the visible side quests.
    // No line is needed between side quests, or when the side-quest list is empty.
    if (main && entries.length) {
      const divider = node('img', undefined, taskRows);
      divider.className = 'room-task-divider';
      divider.src = ROOM_ART + 'task-divider.png';
      divider.alt = ''; divider.setAttribute('aria-hidden', 'true');
    }
    for (const entry of entries) {
      const item = node('div', undefined, taskRows);
      item.className = 'room-taskbar-row';
      node('span', `支线任务：${entry.detail}`, item).className = 'room-taskbar-row-detail';
    }
  }
  function draw(delta = .016) {
    if (!running) return;
    scene.update(state.position.x, dialogOpen, delta);
    const hint = near() || nearObject()
      ? '按 E 交谈 / 调查' : 'WASD / 方向键移动，E 交谈；触屏点击地面行走';
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
    await onLeaderboard();
  });

  function cancelDialogueTimers() {
    clearTimeout(typingTimer);
    typingTimer = null;
  }
  function closeDialogue() {
    if (!dialogOpen) return;
    dialogOpen = false;
    dialogueGeneration += 1; // 使尚未执行的旧定时回调失效。
    cancelDialogueTimers();
    keys.clear();
    actionBusy = false;
    optionButtons = [];
    focusIndex = -1;
    optionsHost = null;
    lineNode = null;
    dialogue.className = "room-dialogue";
    dialogue.replaceChildren();
  }

  function dialogueAction(label, handler) {
    const visible = label.startsWith('接取主线') ? '接取任务' :
      label.startsWith('接取支线：') ? label.replace(/^接取支线：/, '') :
      label.startsWith('交付主线') ? '交付任务' :
      label.startsWith('交付支线：') ? label.replace('交付支线：', '交付 · ') : label;
    const item = control(visible, optionsHost, () => {
      if (!running || !dialogOpen || actionBusy) return;
      actionBusy = true;
      for (const button of optionButtons) button.disabled = true;
      return perform(handler).finally(() => {
        actionBusy = false;
        if (dialogOpen) {
          for (const button of optionButtons) button.disabled = false;
        }
      });
    });
    item.className = 'npc-dialogue-option';
    item.setAttribute('aria-label', label);
    item.title = label;
    if (label.startsWith('接取主线') || label.startsWith('交付主线')) item.className += ' npc-dialogue-option--primary';
    optionButtons.push(item);
  }

  async function persistQuestProgress(progress, updated, checkpoint) {
    const previous = JSON.parse(JSON.stringify(progress));
    Object.assign(progress, updated);
    try {
      await saveAndRefresh(checkpoint);
    } catch (error) {
      for (const field of Object.keys(progress)) delete progress[field];
      Object.assign(progress, previous);
      refreshTaskbar();
      renderTaskPanel();
      throw error;
    }
  }
  async function persistQuestStatus(progress, status, checkpoint) {
    return persistQuestProgress(progress, changeQuestStatus(progress, status), checkpoint);
  }

  async function openFormalLevels() {
    clearTimeout(saveTimer);
    closeDialogue();
    await onStartLevel();
  }

  function questOption(quest, object, main) {
    if (!quest || !object || object.status === "submitted" && !main) return;
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
    optionButtons[focusIndex]?.focus?.();
  }

  function finishTyping() {
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
  function openDialogue() {
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
    actionBusy = false;
    optionButtons = [];
    focusIndex = -1;
    lineCharacters = Array.from(typeof chapter.npcLine === "string" ? chapter.npcLine : "");
    lineIndex = 0;
    lineComplete = lineCharacters.length === 0;
    dialogue.className = "room-dialogue room-dialogue--open";
    dialogue.replaceChildren();
    const layout = node('div', undefined, dialogue);
    layout.className = 'npc-dialogue-layout';
    const portrait = node('div', undefined, layout);
    portrait.className = 'npc-dialogue-portrait';
    portrait.setAttribute('aria-label', '预留角色立绘区域');
    const speaker = node('span', chapter.npc, layout);
    speaker.className = 'npc-dialogue-speaker';
    const body = node('div', undefined, layout);
    body.className = 'npc-dialogue-body';
    if (!lineComplete) {
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
    renderDialogueOptions();
    if (!lineComplete) startTyping();
  }

  function interact() {
    if (!running) return;
    if (dialogOpen) {
      if (!lineComplete) finishTyping();
      return;
    }
    if (nearObject()) {
      perform(inspectRoomObject);
      return;
    }
    if (!near()) {
      dialogue.className = "room-dialogue room-dialogue--notice";
      dialogue.replaceChildren();
      node("p", "请靠近 NPC 再交互。", dialogue);
      return;
    }
    if (!state.dialogues.includes("npc_first_interaction")) {
      state.dialogues.push("npc_first_interaction");
      perform(() => onSave("npc_first_dialogue"));
    }
    openDialogue();
  }

  function onDialogueClick(event) {
    if (!dialogOpen) return;
    if (!lineComplete) {
      // 冒泡到面板上的点击补完台词，不会误触发任务。
      event?.preventDefault?.();
      finishTyping();
    }
  }
  function onCanvasClick(event) {
    if (!running || dialogOpen || !canvas.getBoundingClientRect) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const cssX = event.clientX - bounds.left;
    const cssY = event.clientY - bounds.top;
    const worldX = scene.toWorld(event.clientX, bounds);
    if (Math.abs(cssX - scene.screenX(NPC_X)) < 42 && cssY > bounds.height * .45 && cssY < bounds.height * .85) {
      if (near()) interact();
      else { tapTarget = NPC_X; tapInteract = 'npc'; }
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
    if (dir && !dialogOpen && taskPanel.hidden) move(dir * MOVE_SPEED * dt);
    if (!dir && tapTarget != null && !dialogOpen && taskPanel.hidden) {
      const distance = tapTarget - state.position.x;
      if (Math.abs(distance) <= Math.max(1, MOVE_SPEED * dt)) {
        state.position.x = tapTarget;
        tapTarget = null;
        const action = tapInteract;
        tapInteract = null;
        if ((action === 'npc' && near()) || (action === 'object' && nearObject())) interact();
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
  renderTaskPanel(); refreshTaskbar();
  frameHandle = requestAnimationFrame(frame);
  return function dispose() {
    running = false;
    stage.inert = false;
    topbar.inert = false;
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
  };
}
