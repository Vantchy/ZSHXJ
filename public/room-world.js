/**
 * Room scene: one coordinate system for the background, actors and hit testing.
 * Game-save x remains 0..1024, so old saves and the backend format need no migration.
 * Visual layers (background / actors / nameplate / UI) are independent elements.
 */
export const ROOM_WORLD_WIDTH = 1024;
export const ROOM_NPC_X = 583;
export const ROOM_OBJECT_X = 960;
const ART_ASPECT = 1942 / 809;
const TRACK_RATE = 3.1; // Low-frequency camera easing, frame-rate independent.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function element(tag, className, parent) {
  const e = document.createElement(tag);
  e.className = className;
  parent.append(e);
  return e;
}

export function createRoomWorld({stage, background, npcName, getPlayerX, onNpcClick}) {
  const world = element('div', 'room-world', stage);
  const picture = element('img', 'room-world-picture', world);
  picture.src = typeof background === 'string' && /^\/assets\/scenes\/[\w.-]+\.(png|webp|jpg)$/i.test(background)
    ? background : '/assets/scenes/workshop-background.png';
  picture.alt = ''; picture.draggable = false;
  picture.setAttribute('aria-hidden', 'true');

  const npc = element('button', 'room-actor room-actor--npc', world);
  npc.type = 'button'; npc.title = `与${npcName || '工匠'}交谈`;
  npc.setAttribute('aria-label', `靠近${npcName || '工匠'}并交谈`);
  element('span', 'room-actor-shadow', npc).setAttribute('aria-hidden', 'true');
  const npcBody = element('span', 'room-actor-body', npc);
  npcBody.setAttribute('aria-hidden', 'true');
  const sign = element('span', 'room-actor-nameplate', npc);
  const plaque = element('img', 'room-actor-nameplate-art', sign);
  plaque.src = '/assets/room/npc-nameplate.png';
  plaque.alt = ''; plaque.setAttribute('aria-hidden', 'true');
  const letters = element('span', 'room-actor-nameplate-letters', sign);
  letters.textContent = npcName || '工匠';

  const player = element('div', 'room-actor room-actor--player', world);
  player.setAttribute('aria-label', '可移动角色');
  element('span', 'room-actor-shadow', player).setAttribute('aria-hidden', 'true');
  element('span', 'room-actor-body', player).setAttribute('aria-hidden', 'true');

  // NPC button is the ONLY actor hit target; image and text never share a baked sprite.
  npc.addEventListener('click', (event) => {
    event.stopPropagation?.();
    onNpcClick();
  });

  let w = 0, h = 0, sceneW = 0, units = 1, cameraX = 0;
  let artAspect = ART_ASPECT;
  let observer;
  function layout(force = false) {
    const nextW = stage.clientWidth || 1600;
    const nextH = stage.clientHeight || 850;
    if (!force && w === nextW && h === nextH) return;
    w = nextW; h = nextH;
    // Preserve the original panorama without stretching the backdrop vertically.
    sceneW = Math.max(w * 1.12, h * artAspect);
    units = sceneW / ROOM_WORLD_WIDTH;
    if (world.style) {
      world.style.width = `${sceneW}px`;
      world.style.height = `${h}px`;
      world.style.setProperty('--room-actor-scale', String(clamp(h / 886, .48, 1.45)));
    }
    if (npc.style) npc.style.left = `${ROOM_NPC_X * units}px`;
    if (player.style) player.style.left = `${getPlayerX() * units}px`;
    cameraX = cameraGoal(getPlayerX(), false);
    translate();
  }
  function cameraGoal(playerX, inDialogue) {
    const playerPx = playerX * units;
    const npcPx = ROOM_NPC_X * units;
    // When talking on a narrow portrait screen, frame player AND craftsman together.
    const focus = inDialogue && w < 730
      ? (playerPx + npcPx) / 2 - w * .50
      : playerPx - w * (w < 730 ? .42 : .436);
    return clamp(focus, 0, Math.max(0, sceneW - w));
  }
  function translate() {
    if (world.style) world.style.transform = `translate3d(${-cameraX}px,0,0)`;
  }
  function update(playerX, inDialogue, delta = .016) {
    layout();
    const target = cameraGoal(playerX, inDialogue);
    if (player.style) player.style.left = `${playerX * units}px`;
    const factor = 1 - Math.exp(-TRACK_RATE * clamp(delta, 0, .06));
    cameraX += (target - cameraX) * factor;
    if (Math.abs(target - cameraX) < .1) cameraX = target;
    translate();
  }
  function toWorld(clientX, bounds) {
    layout();
    return clamp((clientX - bounds.left + cameraX) / units, 35, ROOM_WORLD_WIDTH - 35);
  }
  function screenX(worldX) { return worldX * units - cameraX; }
  function resize() { layout(true); }
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(resize);
    observer.observe(stage);
  } else window.addEventListener('resize', resize);
  picture.addEventListener('load', () => {
    if (picture.naturalWidth && picture.naturalHeight) {
      artAspect = picture.naturalWidth / picture.naturalHeight;
      layout(true);
    }
  });
  layout(true);
  return {
    update, toWorld, screenX,
    metrics: () => ({viewportWidth:w, viewportHeight:h, sceneWidth:sceneW, cameraX, units}),
    dispose() { observer?.disconnect(); if (!observer) window.removeEventListener('resize', resize); },
  };
}
