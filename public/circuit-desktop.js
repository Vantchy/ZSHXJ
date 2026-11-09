/*
 * 铸算·华夏纪 | 正式电路关卡桌面布局适配 (v2)
 * Reparents the REAL, event-bound circuit-editor.js controls. It does not
 * reimplement / replace the circuit, save, routing, undo or evaluation logic.
 * The original style.css, app.js and circuit-editor.js remain unchanged.
 */
(() => {
  'use strict';
  // Public hooks for the later central-modal implementation.
  window.ZSHXJ_CIRCUIT_MODAL_EVENTS = Object.freeze({
    LEVEL_INTRO_REQUEST: 'zshxj:circuit:level-intro-request',
    SUBMISSION_RENDERED: 'zshxj:circuit:submission-rendered'
  });
  const ROOT_SELECTOR = '#app.circuit-level-page.circuit-editor-host';
  const $ = (parent, selector) => parent?.querySelector(selector) || null;
  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const button = (cls, label, title) => {
    const el = make('button', cls, label);
    el.type = 'button';
    if (title) { el.title = title; el.setAttribute('aria-label', title); }
    return el;
  };
  const findNamed = (items, text) => items.find(el => el.textContent.includes(text));
  const safeDispatch = (root, name, detail) => {
    const event = new CustomEvent(name, { bubbles: true, cancelable: true, detail });
    root.dispatchEvent(event);
    return event;
  };

  // Beginner-friendly, display-only warning language.  The simulator's
  // structured results and scoring stay unchanged.  Each visible warning is
  // rendered as "元件/位置：问题", with no internal pin paths or X/Z codes.
  function readableComponent(root, id) {
    const el = [...root.querySelectorAll('.ce-component[data-component]')]
      .find(node => node.getAttribute('data-component') === id);
    const caption = el?.querySelector('.ce-component-caption')?.textContent?.trim() || '';
    const type = (el?.querySelector('.ce-pin title')?.textContent || '').split('·')[0].trim();
    if (el?.querySelector('.ce-lamp')) return { label: `输出灯 ${caption || id}`, outputName: caption || id };
    if (el?.classList.contains('ce-input-component')) return { label: `输入开关 ${caption || id}` };
    const simpleType = type.replace(/^外部/, '');
    if (simpleType) return { label: `${simpleType}${caption && caption !== simpleType ? ` ${caption}` : ` ${id}`}` };
    return { label: `元件 ${caption || id}` };
  }

  function describeWarning(raw, root) {
    const text = String(raw || '').trim();
    let match;
    if ((match = text.match(/^([A-Za-z0-9_:@\/.-]+)\.([A-Za-z0-9_-]+)未接线/))) {
      const [, componentId, pin] = match;
      const component = readableComponent(root, componentId);
      const pinNames = {
        in: '输入端', in1: '输入端1', in2: '输入端2',
        gate: '控制端', source: 'S端', drain: 'D端',
        sel: '选择端', clk: '时钟端', d: 'D端',
        s: 'S端', r: 'R端', a: 'A端', b: 'B端', c: 'C端'
      };
      const part = pinNames[pin] || (pin.startsWith('in') ? `输入端${pin.slice(2)}` : `${pin}端`);
      return { kind: 'unconnected', key: `pin:${componentId}:${pin}`,
        outputName: component.outputName, label: `${component.label}：${part}未接线` };
    }
    if ((match = text.match(/^输出(.+?)为([XZ])，不是有效的0\/1电平/))) {
      const name = match[1].trim();
      const isFloating = match[2] === 'Z';
      return { kind: isFloating ? 'output-floating' : 'output-unknown',
        key: `output:${name}:${match[2]}`, outputName: name,
        label: `输出灯 ${name}：${isFloating ? '没有电平来源（断路）' : '电平不确定'}` };
    }
    // An untouched input switch already visibly reads 0, and the backend also
    // simulates it as 0.  Missing_EXTERNAL_INPUT is not a player fault.
    if (/^输入.+?未提供，按0处理/.test(text)) return { kind: 'default-input', label: '' };
    if (/导通网络出现高低电平短接/.test(text))
      return { kind: 'cause', label: '线路：高低电平直接相连（短路）' };
    if (/同一网络连接了多个主动输出/.test(text))
      return { kind: 'cause', label: '线路：多个输出互相冲突' };
    if (/晶体管栅极电平不确定/.test(text))
      return { kind: 'cause', label: '晶体管：控制端电平不确定' };
    if (/存在非锁存器结构的门电路反馈/.test(text))
      return { kind: 'cause', label: '逻辑门：存在不支持的回接线路' };
    if (/^输出无法稳定[。.]?$/.test(text))
      return { kind: 'unstable', label: '电路：输出不稳定' };
    if ((match = text.match(/有\s*(\d+)\s*条线无法完全自动避让障碍/)))
      return { kind: 'route', label: `导线：有 ${match[1]} 条未避开元件` };
    if ((match = text.match(/^(\d+)\s*条线与其他电气网络存在重叠/)))
      return { kind: 'overlap', label: `导线：有 ${match[1]} 条与其他线路重叠` };
    if (/电源短路|SHORT_CIRCUIT/.test(text))
      return { kind: 'error', label: '电源：发生短路' };
    if (/SR.{0,12}(?:S.{0,5}R|R.{0,5}S).{0,25}(?:同时|冲突)/i.test(text))
      return { kind: 'error', label: 'SR锁存器：S、R不能同时为1' };
    // Future codes still appear instead of being silently dropped.
    if (!text) return { kind: 'empty', label: '' };
    if (/^[^：:]{1,24}[：:]/.test(text)) return { kind: 'other', label: text };
    return { kind: 'other', label: `电路：${text}` };
  }

  function presentWarnings(warnings, root) {
    const nodes = [...warnings.querySelectorAll('.ce-warning')];
    const records = nodes.map(el => ({
      el,
      raw: el.dataset.ceWarningRaw || el.textContent?.trim() || ''
    })).map(item => ({ ...item, ...describeWarning(item.raw, root) }));
    const unconnectedOutputs = new Set(records
      .filter(item => item.kind === 'unconnected' && item.outputName)
      .map(item => item.outputName));
    const hasSpecificCause = records.some(item => item.kind === 'cause' || item.kind === 'output-unknown');
    const seen = new Set();
    let count = 0;
    for (const item of records) {
      const isDuplicate = seen.has(item.key || item.label);
      const redundantZ = item.kind === 'output-floating' && unconnectedOutputs.has(item.outputName);
      const redundantUnstable = item.kind === 'unstable' && hasSpecificCause;
      if (!item.label || isDuplicate || redundantZ || redundantUnstable) {
        item.el.remove();
        continue;
      }
      seen.add(item.key || item.label);
      count++;
      // Keep the raw source for later renders/debugging without displaying it.
      if (item.el.dataset.ceWarningRaw !== item.raw) item.el.dataset.ceWarningRaw = item.raw;
      if (item.el.textContent !== item.label) item.el.textContent = item.label;
    }
    const empty = warnings.querySelector('.ce-muted');
    if (empty) empty.hidden = count > 0;
    return count;
  }

  function showSettingsPlaceholder(root) {
    if ($ (root, '.ce-settings-placeholder')) return;
    const overlay = make('div', 'ce-settings-placeholder');
    const panel = make('section', 'ce-settings-paper');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '设置');
    panel.append(make('h3', '', '设置'), make('p', '', '设置选项暂未开放。'));
    const close = button('ce-settings-close', '关闭', '关闭设置');
    const dismiss = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = event => { if (event.key === 'Escape') dismiss(); };
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', event => { if (event.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey);
    panel.append(close);
    overlay.append(panel);
    root.append(overlay);
    close.focus();
  }

  function enhance(root) {
    if (!root || $(root, ':scope > .ce-top')?.dataset.circuitDesktop === 'v2') return;
    const heading = $(root, ':scope > .page-title');
    const top = $(root, ':scope > .ce-top');
    const layout = $(root, ':scope > .ce-layout');
    const feedback = $(root, ':scope > .ce-feedback');
    const palette = $(layout, ':scope > .ce-palette');
    const stage = $(layout, ':scope > .ce-stage');
    const inspector = $(layout, ':scope > .ce-inspector');
    const actions = $(top, ':scope > .ce-actions');
    const toolbar = $(stage, ':scope > .ce-toolbar');
    const result = $(root, ':scope > .ce-result');
    const nativeButtons = actions ? [...actions.querySelectorAll(':scope > button')] : [];
    const save = findNamed(nativeButtons, '保存');
    const run = findNamed(nativeButtons, '运行');
    const submit = findNamed(nativeButtons, '提交');
    const clear = findNamed(nativeButtons, '清空');
    const back = findNamed(nativeButtons, '返回');
    const reset = inspector && findNamed([...inspector.querySelectorAll('button')], '复位模拟');
    const tools = toolbar ? [...toolbar.querySelectorAll(':scope > button.ce-icon-button')] : [];
    const [undo, redo, direction, removeSelected, minus, plus, fit] = tools;
    const zoomLabel = $(toolbar, '.ce-zoom-label');
    const groups = palette ? [...palette.querySelectorAll(':scope > .ce-palette-group')] : [];
    if (!heading || !top || !layout || !feedback || !palette || !stage || !inspector ||
        !actions || !toolbar || !result || !save || !run || !submit || !clear || !back ||
        !reset || tools.length !== 7 || !zoomLabel || !groups.length) return;

    // Commit the guard before DOM mutations: repeated SPA mounts are supported.
    root.dataset.circuitDesktop = 'v2';
    top.dataset.circuitDesktop = 'v2';
    root.classList.add('ce-desktop-v2');
    const levelName = $(top, '.ce-heading h2')?.textContent?.trim() || '关卡介绍';

    // ----- Real header: brand on the left, clickable level name, existing back -----
    const brand = $(heading, '.brand-link');
    for (const child of [...heading.childNodes]) if (child !== brand) child.remove();
    const titleTrigger = button('ce-v2-level-trigger', `${levelName} ▾`, `查看关卡介绍：${levelName}`);
    titleTrigger.addEventListener('click', () => {
      // Reserved interface. No level-introduction modal in this iteration.
      safeDispatch(root, window.ZSHXJ_CIRCUIT_MODAL_EVENTS.LEVEL_INTRO_REQUEST, {
        title: levelName,
        chapter: $(top, '.ce-kicker')?.textContent?.trim() || '',
        objective: $(top, '.ce-objective')?.textContent?.trim() || ''
      });
    });
    const navigation = make('nav', 'ce-v2-navigation');
    navigation.setAttribute('aria-label', '关卡页面操作');
    back.textContent = '↩ 返回';
    back.classList.add('ce-v2-nav-back');
    back.setAttribute('aria-label', '返回上一个界面');
    const settings = button('ce-v2-nav-settings', '⚙ 设置', '设置');
    settings.addEventListener('click', () => {
      // This is currently the same "not available yet" functionality as app.js.
      // The custom event lets the app router adopt the action in a future step.
      const event = safeDispatch(root, 'zshxj:circuit:settings-request', { title: levelName });
      if (!event.defaultPrevented) showSettingsPlaceholder(root);
    });
    navigation.append(back, settings);
    heading.append(titleTrigger, navigation);

    // ----- Horizontal palette: original component cards and original listeners -----
    const command = make('div', 'ce-v2-commandbar');
    const paletteTitle = $(palette, ':scope > .ce-section-title');
    if (paletteTitle) paletteTitle.textContent = '元件道具';
    const palettePrev = button('ce-v2-palette-arrow', '❮', '向左滚动元件');
    const paletteNext = button('ce-v2-palette-arrow', '❯', '向右滚动元件');
    const paletteViewport = make('div', 'ce-v2-palette-viewport');
    paletteViewport.tabIndex = 0;
    paletteViewport.setAttribute('role', 'region');
    paletteViewport.setAttribute('aria-label', '元件道具横向滚动列表');
    const paletteTrack = make('div', 'ce-v2-palette-track');
    groups.forEach(group => paletteTrack.append(group));
    paletteViewport.append(paletteTrack);
    palette.append(palettePrev, paletteViewport, paletteNext);
    const scrollAmount = () => Math.max(220, Math.round(paletteViewport.clientWidth * .65));
    const updateArrows = () => {
      const maxScroll = Math.max(0, paletteViewport.scrollWidth - paletteViewport.clientWidth);
      palettePrev.disabled = paletteViewport.scrollLeft < 2;
      paletteNext.disabled = paletteViewport.scrollLeft >= maxScroll - 2;
    };
    palettePrev.addEventListener('click', () => paletteViewport.scrollBy({ left: -scrollAmount(), behavior: 'smooth' }));
    paletteNext.addEventListener('click', () => paletteViewport.scrollBy({ left: scrollAmount(), behavior: 'smooth' }));
    paletteViewport.addEventListener('scroll', updateArrows, { passive: true });
    paletteViewport.addEventListener('wheel', event => {
      if (event.ctrlKey || event.metaKey) return;
      const extent = paletteViewport.scrollWidth - paletteViewport.clientWidth;
      if (extent <= 1) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      const before = paletteViewport.scrollLeft;
      paletteViewport.scrollLeft = Math.max(0, Math.min(extent, before + delta));
      if (Math.abs(paletteViewport.scrollLeft - before) > .5) event.preventDefault();
    }, { passive: false });
    if (typeof ResizeObserver === 'function') {
      const resize = new ResizeObserver(updateArrows);
      resize.observe(paletteViewport);
      resize.observe(paletteTrack);
      // Disconnect on route exit without continuous subtree observation.
      const cleanup = new MutationObserver(() => {
        if (!root.contains(palette) || !root.classList.contains('circuit-level-page')) {
          resize.disconnect(); cleanup.disconnect();
        }
      });
      cleanup.observe(root, { childList: true });
    }
    requestAnimationFrame(updateArrows);

    // ----- Five actual wired action buttons; no click proxy / duplicate handlers -----
    save.textContent = '保存';
    run.textContent = '▶ 运行';
    submit.textContent = '提交';
    clear.textContent = '清空';
    reset.textContent = '复位';
    reset.title = '复位模拟状态（不删除电路）';
    clear.title = '清空电路元件和连线（保留必要的输入/输出）';
    actions.replaceChildren(save, run, submit, clear, reset);
    command.append(palette, actions);
    root.insertBefore(command, layout);
    // submit() restores its old caption after each request; keep the short label.
    const submitCaption = new MutationObserver(() => {
      if (submit.textContent === '提交评测') submit.textContent = '提交';
    });
    submitCaption.observe(submit, { childList: true, characterData: true, subtree: true });

    // ----- Canvas tools: original buttons, relocated without touching behavior -----
    const left = make('div', 'ce-v2-tools-left');
    const right = make('div', 'ce-v2-tools-right');
    const retained = make('div', 'ce-v2-retained-controls');
    const hint = $(toolbar, '.ce-toolbar-label');
    const spacer = $(toolbar, '.ce-toolbar-spacer');
    [hint, direction, removeSelected, spacer].filter(Boolean).forEach(el => retained.append(el));
    undo.textContent = '↶'; undo.title = '撤销（Ctrl+Z）'; undo.setAttribute('aria-label', undo.title);
    redo.textContent = '↷'; redo.title = '重做（Ctrl+Y）'; redo.setAttribute('aria-label', redo.title);
    fit.textContent = '⌖'; fit.title = '定位全部元件（F）'; fit.setAttribute('aria-label', fit.title);
    minus.textContent = '−'; minus.title = '缩小'; minus.setAttribute('aria-label', minus.title);
    plus.textContent = '＋'; plus.title = '放大'; plus.setAttribute('aria-label', plus.title);
    left.append(undo, redo);
    right.append(fit, minus, zoomLabel, plus);
    toolbar.replaceChildren(left, right, retained);
    // Keep toolHint/direction in the DOM: original code updates them, and the
    // Space shortcut calls direction.click() during wire editing.

    // Status messages are preserved as a non-obstructive transient toast.
    stage.append(feedback);
    feedback.classList.add('ce-v2-toast');
    let toastTimeout;
    const statusObserver = new MutationObserver(() => {
      feedback.classList.add('is-visible');
      clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => feedback.classList.remove('is-visible'),
        feedback.dataset.kind === 'error' ? 8000 : 4000);
    });
    statusObserver.observe(feedback, { childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['data-kind'] });

    // The original detailed inspector is hidden, not destroyed. Warnings can
    // still be accessed from a compact, on-demand button on the canvas.
    const warnings = $(inspector, '.ce-warnings');
    if (warnings) {
      const warnDock = make('div', 'ce-v2-warn-dock');
      const warnToggle = button('ce-v2-warn-toggle', '⚠ 模拟警告', '查看模拟警告');
      const warnDetails = make('div', 'ce-v2-warn-details');
      warnDetails.hidden = true;
      warnToggle.setAttribute('aria-expanded', 'false');
      warnToggle.addEventListener('click', () => {
        warnDetails.hidden = !warnDetails.hidden;
        warnToggle.setAttribute('aria-expanded', String(!warnDetails.hidden));
      });
      warnDetails.append(warnings);
      warnDock.append(warnToggle, warnDetails);
      stage.append(warnDock);
      const syncWarnings = () => {
        const count = presentWarnings(warnings, root);
        warnToggle.hidden = count === 0;
        warnToggle.textContent = `⚠ 模拟警告 ${count}`;
        if (count === 0) { warnDetails.hidden = true; warnToggle.setAttribute('aria-expanded','false'); }
      };
      const warningObserver = new MutationObserver(syncWarnings);
      warningObserver.observe(warnings, { childList: true, subtree: true, characterData: true });
      syncWarnings();
    }

    // Existing evaluation details remain visible after submit; no new result
    // modal is opened. A DOM snapshot event is offered to future modal UI.
    let lastResult = '';
    const observeResult = () => {
      if (result.hidden || !$(result, '.ce-result-score')) return;
      const description = [...result.childNodes].filter(node => !node.classList?.contains('ce-v2-result-close'))
        .map(node => node.textContent || '').join(' ').trim();
      if (description !== lastResult) {
        lastResult = description;
        safeDispatch(root, window.ZSHXJ_CIRCUIT_MODAL_EVENTS.SUBMISSION_RENDERED, {
          title: levelName,
          text: description,
          score: $(result, '.ce-result-score')?.textContent?.trim() || '',
          resultElement: result
        });
      }
      if (!$(result, '.ce-v2-result-close')) {
        const dismiss = button('ce-v2-result-close', '×', '关闭评测详情');
        dismiss.addEventListener('click', () => { result.hidden = true; });
        result.prepend(dismiss);
      }
    };
    const resultObserver = new MutationObserver(observeResult);
    resultObserver.observe(result, { childList: true, subtree: false,
      attributes: true, attributeFilter: ['hidden'] });
    observeResult();

    // Retain the existing 7200×4500 paper and minZoom=max(1600/7200,
    // 1000/4500)=2/9. SVG 'slice' still covers wide drawing areas at 2/9.
    // The wider viewport would otherwise crop the initial ports near the top;
    // initialize via the editor's OWN fitCircuit() button (not a second algorithm).
    requestAnimationFrame(() => {
      if (root.isConnected && root.dataset.circuitDesktop === 'v2') fit.click();
    });
  }

  function scan() { enhance(document.querySelector(ROOT_SELECTOR)); }
  const start = () => {
    const root = document.getElementById('app');
    if (!root) return;
    // The circuit editor is mounted asynchronously after an API call. Its top,
    // palette, toolbar and inspector are real direct children of #app / layout.
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true });
    scan();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
