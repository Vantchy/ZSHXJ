/*
 * 铸算·华夏纪 — 关卡介绍弹窗（内容占位版）
 * Uses the LEVEL_INTRO_REQUEST event already emitted by circuit-desktop.js.
 * No changes to circuit saving, assessment, navigation, or editor mechanics.
 */
(() => {
  'use strict';

  const EVENT = 'zshxj:circuit:level-intro-request';
  const CLASS = 'zshxj-level-intro';

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function openIntroduction(levelName, sourceRoot) {
    // Avoid stacking overlays after repeated clicks.
    const existing = document.querySelector(`dialog.${CLASS}`);
    if (existing) {
      if (!existing.open) existing.showModal();
      existing.querySelector(`.${CLASS}__close`)?.focus();
      return;
    }

    const priorFocus = document.activeElement;
    const dialog = create('dialog', CLASS);
    dialog.setAttribute('aria-labelledby', 'zshxj-level-intro-heading');
    dialog.setAttribute('aria-describedby', 'zshxj-level-intro-placeholder');
    const paper = create('section', `${CLASS}__paper`);

    const dismiss = create('button', `${CLASS}__close`, '×');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', '关闭关卡介绍');
    dismiss.title = '关闭关卡介绍';

    const eyebrow = create('p', `${CLASS}__eyebrow`, '关卡介绍');
    const title = create('h2', `${CLASS}__heading`, levelName || '当前关卡');
    title.id = 'zshxj-level-intro-heading';
    const rule = create('div', `${CLASS}__rule`);
    rule.setAttribute('aria-hidden', 'true');

    const placeholder = create('p', `${CLASS}__placeholder`,
      '【关卡介绍内容占位】\n此处将填写关卡背景、学习目标与操作说明。');
    placeholder.id = 'zshxj-level-intro-placeholder';

    const action = create('button', `${CLASS}__action`, '返回电路');
    action.type = 'button';
    dismiss.addEventListener('click', () => dialog.close());
    action.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      // Clicking the native backdrop targets the dialog itself.
      if (event.target === dialog) dialog.close();
    });

    let lifecycleObserver;
    dialog.addEventListener('close', () => {
      lifecycleObserver?.disconnect();
      dialog.remove();
      if (priorFocus?.isConnected && typeof priorFocus.focus === 'function') priorFocus.focus();
    }, { once: true });

    paper.append(dismiss, eyebrow, title, rule, placeholder, action);
    dialog.append(paper);
    document.body.append(dialog);
    dialog.showModal(); // Native modal: center, focus management, Escape key.
    dismiss.focus();

    // A single-page route change must not leave an orphaned modal behind.
    const app = document.getElementById('app');
    if (app && typeof MutationObserver === 'function') {
      lifecycleObserver = new MutationObserver(() => {
        if (!sourceRoot.isConnected || !sourceRoot.classList.contains('circuit-level-page')) {
          if (dialog.open) dialog.close();
        }
      });
      lifecycleObserver.observe(app, { attributes: true, attributeFilter: ['class'], childList: true });
    }
  }

  document.addEventListener(EVENT, (event) => {
    const root = event.target;
    if (!(root instanceof HTMLElement) ||
        !root.matches('#app.circuit-level-page.ce-desktop-v2')) return;
    openIntroduction(String(event.detail?.title || '').trim(), root);
  });
})();
