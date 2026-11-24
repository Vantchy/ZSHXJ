/** 桃林超前进位玉版：可作答或明确跳过；正式电路成绩另行评测。 */
const REFERENCE = Object.freeze({
  C2: 'G1+P1*G0+P1*P0*C0',
  C3: 'G2+P2*G1+P2*P1*G0+P2*P1*P0*C0',
  C4: 'G3+P3*G2+P3*P2*G1+P3*P2*P1*G0+P3*P2*P1*P0*C0',
});
const SKIP_EVIDENCE = Object.freeze({completionMode: 'skipped', reason: 'user-requested'});

export function mountYinCarryBoard({host, onSolved, onClose, readonly=false}) {
  const panel = document.createElement('section');
  panel.className = 'mj-story-modal mj-board-modal';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '进位展开');
  host.append(panel);
  const shade = document.createElement('div');
  shade.className = 'mj-story-shade'; panel.append(shade);
  const shell = document.createElement('div');
  shell.className = 'mj-story-shell'; panel.append(shell);
  function el(tag, text, parent, cls) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    parent.append(n);
    return n;
  }
  el('h2', '进位展开', shell);
  el('p', '参考答案已经填写，可修改或直接跳过本题。正式电路仍需自行搭建。', shell, 'mj-story-hint');
  const inputs = {};
  const labels = {C2: 'C₂', C3: 'C₃', C4: 'C₄'};
  const form = el('form', null, shell, 'yin-carry-form');
  const status = el('p', '', shell, 'mj-story-status');
  status.setAttribute('role', 'status');
  let busy = false;

  function note(text) { status.textContent = text; }
  function close() { panel.remove(); onClose?.(); }

  async function copyField(field) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(field.value);
        note('已复制，可粘贴到输入框。');
        return;
      }
    } catch (_) { /* fall through to legacy selection */ }
    field.focus(); field.select();
    if (typeof document.execCommand === 'function' && document.execCommand('copy')) {
      note('已复制。');
    } else {
      note('已选中内容，可按 Ctrl+C 复制。');
    }
  }

  async function pasteField(field) {
    let clipboardText = null;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        clipboardText = await navigator.clipboard.readText();
      }
    } catch (_) { /* Some browsers restrict reading the clipboard. */ }
    if (clipboardText === null && typeof window !== 'undefined' && typeof window.prompt === 'function') {
      clipboardText = window.prompt('请粘贴公式（Ctrl+V）并确定：', '');
    }
    if (typeof clipboardText !== 'string' || !clipboardText.trim()) {
      field.focus(); note('请点入输入框，按 Ctrl+V 粘贴。'); return;
    }
    field.value = clipboardText.trim().slice(0, field.maxLength);
    field.focus();
    field.dispatchEvent(new Event('input', {bubbles:true}));
    note('已粘贴。');
  }

  for (const name of Object.keys(labels)) {
    const line = el('div', null, form);
    line.style.margin = '10px 0';
    const label = el('label', labels[name], line);
    label.style.display = 'block'; label.style.fontSize = '15px';
    const field = el('input', null, label);
    field.type = 'text'; field.maxLength = 240;
    field.autocomplete = 'off'; field.spellcheck = false;
    field.setAttribute('aria-label', labels[name] + ' 进位展开式');
    field.value = REFERENCE[name]; // Also works when the user cannot use clipboard.
    field.style.width = '100%'; field.style.fontSize = '15px'; field.style.padding = '7px';
    // The room's keyboard shortcuts must not swallow text-entry shortcuts.
    for (const eventName of ['keydown', 'keyup', 'paste', 'copy', 'cut']) {
      field.addEventListener(eventName, event => event.stopPropagation());
    }
    inputs[name] = field;
    const actions = el('div', null, line);
    actions.style.display = 'flex'; actions.style.gap = '7px';
    actions.style.marginTop = '4px';
    const copy = el('button', '复制', actions, 'mj-story-quiet');
    copy.type = 'button'; copy.style.fontSize = '13px'; copy.style.padding = '4px 10px';
    copy.setAttribute('aria-label', '复制 ' + labels[name]);
    copy.addEventListener('click', () => copyField(field));
    const paste = el('button', '粘贴', actions, 'mj-story-quiet');
    paste.type = 'button'; paste.style.fontSize = '13px'; paste.style.padding = '4px 10px';
    paste.setAttribute('aria-label', '粘贴 ' + labels[name]);
    paste.addEventListener('click', () => pasteField(field));
  }

  const buttons = el('div', null, shell, 'mj-story-footer');
  const cancel = el('button', readonly ? '结束回顾' : '关闭', buttons, 'mj-story-quiet');
  cancel.type = 'button'; cancel.addEventListener('click', close);
  const confirm = el('button', readonly ? '核对式子' : '提交答案', buttons, 'mj-story-primary');
  confirm.type = 'button';
  let skip;
  if (!readonly) {
    skip = el('button', '跳过此题', buttons, 'mj-story-quiet');
    skip.type = 'button';
    skip.setAttribute('aria-label', '跳过进位展开玉版，继续正式电路关卡');
  }
  const submit = async (answers, skipping=false) => {
    if (busy) return;
    busy = true; confirm.disabled = true;
    if (skip) skip.disabled = true;
    note(skipping ? '正在记录跳过…' : '正在核对并保存…');
    try {
      await onSolved?.(answers);
      panel.remove();
    } catch(error) {
      busy = false; confirm.disabled = false;
      if (skip) skip.disabled = false;
      note(error?.message || '保存失败，请重试。');
    }
  };
  confirm.addEventListener('click', () => {
    const answers = Object.fromEntries(Object.keys(inputs).map(name => [name, inputs[name].value.trim()]));
    if (Object.values(answers).some(value => !value)) { note('请填好三个式子，或选择跳过此题。'); return; }
    void submit(answers);
  });
  skip?.addEventListener('click', () => { void submit({...SKIP_EVIDENCE}, true); });
  form.addEventListener('submit', event => { event.preventDefault(); confirm.click(); });
  shade.addEventListener('click', close);
  return {close};
}
