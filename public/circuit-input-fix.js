/*
 * 铸算·华夏纪 — 输入开关数字区点击修复
 *
 * The editor's normal pointerdown immediately selects/drags and rebuilds its
 * SVG, then pointerup toggles and rebuilds it again. On some Chromium/Edge
 * renderers this makes the digital switch flash or leave a transient ghost.
 * Treat a deliberate tap on the 0/1 display as a toggle, not a drag. The
 * original editor's keyboard handler performs the actual state change and
 * simulation, so scoring and electrical behavior remain untouched.
 *
 * Only the display of a real canvas input is affected. Its output pin and
 * blank-area dragging, plus every other component, keep native interactions.
 */
(() => {
  'use strict';
  let pressed = null;
  const MAX_TAP_MOVEMENT = 8;
  const ROOT_SELECTOR = '#app.circuit-level-page.circuit-editor-host';

  function isInputDisplay(target) {
    if (!(target instanceof Element)) return null;
    if (!target.closest('.ce-digital-display, .ce-symbol-value')) return null;
    const input = target.closest('.ce-input-component[data-component]');
    if (!input || target.closest('.ce-pin')) return null;
    const root = input.closest(ROOT_SELECTOR);
    const svg = input.closest('svg.ce-canvas');
    const stage = input.closest('.ce-stage');
    if (!root || !svg || !stage) return null;
    // Keep wire construction, junction insertion and palette placement intact.
    if (['wire', 'junction', 'place'].includes(stage.dataset.mode)) return null;
    return { root, svg, id: input.dataset.component };
  }

  // Capture before the editor's SVG handler starts a drag and rebuilds the
  // component under the pointer. This is limited to the digit display area.
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || pressed) return;
    const hit = isInputDisplay(event.target);
    if (!hit) return;
    pressed = { ...hit, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.preventDefault();
    event.stopPropagation();
    try { hit.svg.setPointerCapture(event.pointerId); } catch (_) { /* pointer may have ended */ }
  }, true);

  document.addEventListener('pointerup', event => {
    if (!pressed || event.pointerId !== pressed.pointerId) return;
    const tap = pressed;
    pressed = null;
    event.preventDefault();
    event.stopPropagation();
    try { if (tap.svg.hasPointerCapture(event.pointerId)) tap.svg.releasePointerCapture(event.pointerId); } catch (_) {}
    const distance = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);
    if (distance > MAX_TAP_MOVEMENT || !tap.root.isConnected || !tap.svg.isConnected) return;
    // The old SVG <g> may have been replaced by an unrelated simulation result.
    const input = [...tap.svg.querySelectorAll('.ce-input-component[data-component]')]
      .find(node => node.dataset.component === tap.id);
    if (!input) return;
    // Reuse the editor's existing Enter-to-toggle handler. One release equals
    // exactly one toggle; no duplicate pointerup, click or simulation logic.
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true
    }));
  }, true);

  const cancel = event => {
    if (pressed && event.pointerId === pressed.pointerId) pressed = null;
  };
  document.addEventListener('pointercancel', cancel, true);
  window.addEventListener('blur', () => { pressed = null; });
})();
