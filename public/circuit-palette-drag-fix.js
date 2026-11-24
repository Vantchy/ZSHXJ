/* ZSHXJ V9.1: reliable palette->canvas drop for Chromium/Edge.
 * Additive adapter; the circuit editor remains the sole owner of the graph,
 * undo history, wires, simulation, save and server-side grading.
 * Some native HTML5 drags lose custom MIME data when the source contains SVG;
 * capture the source type and deliver it to the editor's existing drop handler.
 */
(() => {
  'use strict';
  const ROOT = '#app.circuit-level-page.circuit-editor-host';
  const CUSTOM_MIME = 'text/circuit-type';
  let session = null;
  let pointer = null;
  let nextPointerId = 50000;

  const cardFrom = target => target instanceof Element
    ? target.closest('.ce-palette-item[data-type]') : null;
  const rootFrom = target => target instanceof Element
    ? target.closest(ROOT) : null;
  const insideBox = (rect, x, y) => Number.isFinite(x) && Number.isFinite(y)
    && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  const canvasAt = (root, x, y) => {
    const canvas = root?.querySelector('.ce-canvas-wrap');
    return canvas && insideBox(canvas.getBoundingClientRect(), x, y) ? canvas : null;
  };
  const validCard = (card, root) => Boolean(card && root && card.dataset.type && root.contains(card));
  const originalType = source => source?.card?.dataset.type || source?.type || null;
  const activeRoot = source => source?.root?.isConnected && source.root.matches(ROOT)
    ? source.root : null;

  // Reuse the editor's native drop listener. Never create, score, or persist a
  // component here: only the existing canvas handler may alter circuit state.
  function deliver(source, x, y) {
    const root = activeRoot(source);
    const canvas = canvasAt(root, x, y);
    const type = originalType(source);
    if (!canvas || !type || !root.querySelector(`.ce-palette-item[data-type="${CSS.escape(type)}"]`)) return false;
    const transfer = new DataTransfer();
    transfer.setData(CUSTOM_MIME, type);
    transfer.setData('text/plain', type);
    transfer.effectAllowed = 'copy';
    canvas.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, dataTransfer: transfer,
    }));
    return true;
  }

  document.addEventListener('dragstart', event => {
    const card = cardFrom(event.target);
    const root = rootFrom(card);
    if (!validCard(card, root) || !event.dataTransfer) return;
    session = { root, card, type: card.dataset.type, delivered: false };
    try {
      event.dataTransfer.setData(CUSTOM_MIME, session.type);
      // A standard text entry also lets browsers and accessibility bridges
      // preserve this drag even when custom MIME types are discarded.
      event.dataTransfer.setData('text/plain', session.type);
      event.dataTransfer.effectAllowed = 'copy';
    } catch (_) { /* pointer fallback still has the source card */ }
  }, true);

  document.addEventListener('dragover', event => {
    const source = session || pointer;
    if (!source || !canvasAt(activeRoot(source), event.clientX, event.clientY)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }, true);

  document.addEventListener('drop', event => {
    if (!event.isTrusted && event.dataTransfer?.getData(CUSTOM_MIME)) return;
    const source = session || pointer;
    if (!source || !canvasAt(activeRoot(source), event.clientX, event.clientY)) return;
    // Stop the empty native drop from reaching the editor. Its normal listener
    // then receives ONE synthetic, complete DragEvent with the exact same point.
    event.preventDefault();
    event.stopImmediatePropagation();
    const success = deliver(source, event.clientX, event.clientY);
    if (success) source.delivered = true;
    session = null;
    pointer = null;
  }, true);

  document.addEventListener('dragend', event => {
    if (!session) return;
    const source = session;
    session = null;
    if (!source.delivered && deliver(source, event.clientX, event.clientY)) {
      source.delivered = true;
    }
    pointer = null;
  }, true);

  // Some Edge/Chrome environments start a pointer gesture but never emit the
  // HTML5 dragstart event for an SVG-backed palette item. In that case a move
  // and release into the real canvas can still use the same editor drop route.
  document.addEventListener('pointerdown', event => {
    const card = cardFrom(event.target);
    const root = rootFrom(card);
    if (!validCard(card, root) || event.button !== 0 || !event.isPrimary) return;
    pointer = { root, card, type: card.dataset.type, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, moved: false, delivered: false };
  }, true);
  document.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.pointerId) return;
    if (Math.hypot(event.clientX-pointer.x, event.clientY-pointer.y) > 9) pointer.moved = true;
  }, true);
  document.addEventListener('pointerup', event => {
    if (!pointer || event.pointerId !== pointer.pointerId) return;
    const source = pointer;
    pointer = null;
    if (!session && source.moved && !source.delivered) {
      deliver(source, event.clientX, event.clientY);
    }
  }, true);
  document.addEventListener('pointercancel', () => { pointer = null; }, true);
  window.addEventListener('blur', () => { pointer = null; session = null; });

  const style = document.createElement('style');
  style.id = 'zshxj-palette-drag-fix-v91';
  style.textContent = `
    ${ROOT} .ce-palette-item .ce-palette-symbol,
    ${ROOT} .ce-palette-item .ce-palette-symbol * {
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
    }
    ${ROOT} .ce-palette-item { -webkit-user-select: none; user-select: none; }
  `;
  document.head.append(style);
})();
