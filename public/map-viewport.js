/**
 * Full-bleed map camera. One image coordinate system owns both artwork and
 * hotspots. Mouse/touch drag and arrow keys alter only the camera offset.
 * The return value disposes listeners and the resize observer on navigation.
 */
const DIRECTION_KEYS = Object.freeze({
  ArrowLeft: [1, 0], ArrowRight: [-1, 0],
  ArrowUp: [0, 1], ArrowDown: [0, -1],
  KeyA: [1, 0], KeyD: [-1, 0], KeyW: [0, 1], KeyS: [0, -1],
});
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function createPannableMap({host, imageUrl, width, height,
  alt = '地图', focus = {x: .5, y: .5}, markers = []}) {
  const viewport = document.createElement('section');
  viewport.className = 'map-viewport';
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', `${alt}，可拖拽或用方向键移动`);
  viewport.tabIndex = 0;
  const scene = document.createElement('div');
  scene.className = 'map-camera-scene';
  const art = document.createElement('img');
  art.className = 'map-camera-image';
  art.src = imageUrl;
  art.alt = alt;
  art.draggable = false;
  scene.append(art);
  for (const marker of markers) {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = marker.label;
    trigger.className = `scene-gate ${marker.className || ''}`.trim();
    // Marker offsets are local to the image layer, not to the fixed viewport.
    // They therefore pan and resize together with the city under the marker.
    trigger.style.left = `calc(${clamp(marker.x, 0, 1) * 100}% + ${marker.offsetX || 0}px)`;
    trigger.style.top = `calc(${clamp(marker.y, 0, 1) * 100}% + ${marker.offsetY || 0}px)`;
    trigger.setAttribute('aria-label', marker.ariaLabel || marker.label);
    trigger.addEventListener('click', () => marker.onActivate());
    scene.append(trigger);
  }
  viewport.append(scene);
  host.append(viewport);

  const ratio = width / height;
  const overscan = 1.22;
  let sceneWidth = 0;
  let sceneHeight = 0;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let x = 0, y = 0;
  let disposed = false;
  let dragging = null;
  let initialized = false;
  let centerX = clamp(focus.x, 0, 1);
  let centerY = clamp(focus.y, 0, 1);
  const heldKeys = new Set();
  const keyboardSpeed = 360; // CSS pixels per second, independent of keyboard repeat.
  let animationFrame = null;
  let previousFrameTime = null;

  function paint() {
    scene.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  function setCamera(nextX, nextY) {
    x = clamp(nextX, Math.min(0, viewportWidth - sceneWidth), 0);
    y = clamp(nextY, Math.min(0, viewportHeight - sceneHeight), 0);
    paint();
  }
  function layout() {
    if (disposed) return;
    if (initialized && sceneWidth && sceneHeight) {
      centerX = clamp((viewportWidth / 2 - x) / sceneWidth, 0, 1);
      centerY = clamp((viewportHeight / 2 - y) / sceneHeight, 0, 1);
    }
    viewportWidth = viewport.clientWidth || window.innerWidth || 1440;
    viewportHeight = viewport.clientHeight || window.innerHeight || 900;
    const coverHeight = Math.max(viewportHeight, viewportWidth / ratio) * overscan;
    sceneWidth = coverHeight * ratio;
    sceneHeight = coverHeight;
    scene.style.width = `${sceneWidth}px`;
    scene.style.height = `${sceneHeight}px`;
    setCamera(viewportWidth / 2 - centerX * sceneWidth,
              viewportHeight / 2 - centerY * sceneHeight);
    initialized = true;
  }
  function stopKeyboardPan() {
    heldKeys.clear();
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    previousFrameTime = null;
  }
  function animateKeyboardPan(timestamp) {
    animationFrame = null;
    if (disposed || !heldKeys.size) {
      previousFrameTime = null;
      return;
    }
    if (previousFrameTime !== null) {
      // Clamp delta after tab throttling; diagonal travel must have the same
      // speed as horizontal/vertical travel.
      const elapsed = clamp((timestamp - previousFrameTime) / 1000, 0, .05);
      let dx = 0, dy = 0;
      for (const key of heldKeys) {
        dx += DIRECTION_KEYS[key][0];
        dy += DIRECTION_KEYS[key][1];
      }
      const length = Math.hypot(dx, dy);
      if (length > 0 && elapsed > 0) {
        setCamera(x + dx / length * keyboardSpeed * elapsed,
                  y + dy / length * keyboardSpeed * elapsed);
      }
    }
    previousFrameTime = timestamp;
    animationFrame = requestAnimationFrame(animateKeyboardPan);
  }
  function onKeyDown(event) {
    if (disposed || !DIRECTION_KEYS[event.code]) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    heldKeys.add(event.code);
    if (animationFrame === null) {
      previousFrameTime = null;
      animationFrame = requestAnimationFrame(animateKeyboardPan);
    }
  }
  function onKeyUp(event) {
    if (!DIRECTION_KEYS[event.code]) return;
    heldKeys.delete(event.code);
    if (!heldKeys.size) stopKeyboardPan();
  }
  function onWindowBlur() {
    stopKeyboardPan();
  }
  function onPointerDown(event) {
    if (disposed || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.target?.closest?.('button')) return;
    dragging = {id: event.pointerId, x: event.clientX, y: event.clientY};
    viewport.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    if (!dragging || event.pointerId !== dragging.id) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    setCamera(x + dx, y + dy);
    if (Math.abs(dx) + Math.abs(dy) > 0) viewport.classList?.add('is-panning');
  }
  function stopPointer(event) {
    if (!dragging || event.pointerId !== dragging.id) return;
    dragging = null;
    viewport.classList?.remove('is-panning');
    if (viewport.hasPointerCapture?.(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  }
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', stopPointer);
  viewport.addEventListener('pointercancel', stopPointer);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('resize', layout);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layout) : null;
  observer?.observe(viewport);
  layout();
  viewport.focus?.({preventScroll: true});
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      dragging = null;
      observer?.disconnect();
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', stopPointer);
      viewport.removeEventListener('pointercancel', stopPointer);
      stopKeyboardPan();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', layout);
    },
  };
}
