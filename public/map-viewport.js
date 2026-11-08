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
  // This is an interactive pan surface, not selectable HTML. Without this,
  // Chromium can begin dragging a DOM selection on a later mouse gesture,
  // dispatching dragstart + pointercancel and showing the red "no-drop" cursor.
  viewport.style.userSelect = 'none';
  viewport.style.webkitUserSelect = 'none';
  const scene = document.createElement('div');
  scene.className = 'map-camera-scene';
  scene.style.userSelect = 'none';
  scene.style.webkitUserSelect = 'none';
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
  let suppressDragClick = false;
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
  // Native HTML dragging and text selection are NOT map panning. Blocking
  // both is crucial: otherwise a later gesture can become "dragstart" and
  // the browser cancels the Pointer Events stream (pointercancel).
  function onNativeDragStart(event) {
    event.preventDefault();
  }
  function onNativeSelectStart(event) {
    event.preventDefault();
  }
  function capture(id) {
    try {
      viewport.setPointerCapture?.(id);
      return Boolean(viewport.hasPointerCapture?.(id));
    } catch (_) {
      return false;
    }
  }
  function release(id) {
    try {
      if(viewport.hasPointerCapture?.(id)) viewport.releasePointerCapture(id);
    } catch (_) {
      // A capture may already have been revoked (window blur / pointercancel).
    }
  }
  function clearDrag(event=null, cancelled=false) {
    if(!dragging || (event?.pointerId != null && event.pointerId!==dragging.id))return;
    const active=dragging;
    dragging=null; // Clear FIRST: release() may fire a late lostpointercapture.
    viewport.classList.remove('is-panning');
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    if(active.fallbackMove)window.removeEventListener('pointermove', onPointerMove);
    release(active.id);
    if(!cancelled && active.moved)suppressDragClick=true;
  }
  function onWindowBlur() {
    stopKeyboardPan();
    clearDrag(null,true);
  }
  function onVisibilityChange() {
    if(document.hidden)onWindowBlur();
  }
  function onPointerDown(event) {
    if(disposed || event.isPrimary===false ||
      (event.pointerType==='mouse' && event.button!==0))return;
    // A missing pointerup must never permanently disable the next gesture.
    if(dragging)clearDrag(null,true);
    suppressDragClick=false;
    const onButton=Boolean(event.target?.closest?.('button'));
    // Cancel default selection BEFORE the browser's HTML5 drag machinery
    // takes control. Do not cancel ordinary landmark button clicks.
    if(!onButton)event.preventDefault?.();
    dragging={
      id:event.pointerId,originX:event.clientX,originY:event.clientY,
      x:event.clientX,y:event.clientY,
      fromButton:onButton,moved:false,captured:false,fallbackMove:false,
    };
    if(!onButton)dragging.captured=capture(event.pointerId);
    // Window release listeners only; the viewport normally owns pointermove.
    // A global pointermove fallback is installed ONLY if capture fails.
    if(!onButton && !dragging.captured){
      dragging.fallbackMove=true;
      window.addEventListener('pointermove',onPointerMove);
    }
    window.addEventListener('pointerup',onPointerUp);
    window.addEventListener('pointercancel',onPointerCancel);
  }
  function onPointerMove(event) {
    if(disposed || !dragging || event.pointerId!==dragging.id)return;
    const active=dragging;
    const dx=event.clientX-active.x;
    const dy=event.clientY-active.y;
    if(!active.moved){
      if(Math.hypot(event.clientX-active.originX,event.clientY-active.originY)<5)return;
      active.moved=true;
      viewport.classList.add('is-panning');
      if(active.fromButton){
        // A landmark remains clickable unless it becomes an intentional drag.
        active.captured=capture(active.id);
        if(!active.captured){
          active.fallbackMove=true;
          window.addEventListener('pointermove',onPointerMove);
        }
      }
    }
    if(!dx && !dy)return; // Ignore a window fallback's bubbled duplicate.
    active.x=event.clientX;
    active.y=event.clientY;
    setCamera(x+dx,y+dy); // Incremental movement allows immediate edge reversal.
    event.preventDefault?.();
  }
  function onPointerUp(event) {clearDrag(event,false);}
  function onPointerCancel(event) {clearDrag(event,true);}
  function onLostPointerCapture(event) {
    // The mouse pointerId is often reused. Ignore a delayed loss belonging to
    // the prior drag if the NEW gesture already owns a capture for this id.
    if(!dragging || dragging.id!==event.pointerId || !dragging.captured ||
       viewport.hasPointerCapture?.(event.pointerId))return;
    clearDrag(event,true);
  }
  function onClickCapture(event) {
    if(!suppressDragClick)return;
    if(event.detail===0)return; // Keyboard activation still works.
    suppressDragClick=false;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
  }
  viewport.addEventListener('dragstart', onNativeDragStart, true);
  viewport.addEventListener('selectstart', onNativeSelectStart, true);
  viewport.addEventListener('click', onClickCapture, true);
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerCancel);
  viewport.addEventListener('lostpointercapture', onLostPointerCapture);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('resize', layout);
  document.addEventListener?.('visibilitychange', onVisibilityChange);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layout) : null;
  observer?.observe(viewport);
  layout();
  viewport.focus?.({preventScroll: true});
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      clearDrag(null,true);
      observer?.disconnect();
      viewport.removeEventListener('dragstart', onNativeDragStart, true);
      viewport.removeEventListener('selectstart', onNativeSelectStart, true);
      viewport.removeEventListener('click', onClickCapture, true);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerCancel);
      viewport.removeEventListener('lostpointercapture', onLostPointerCapture);
      stopKeyboardPan();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', layout);
      document.removeEventListener?.('visibilitychange', onVisibilityChange);
    },
  };
}
