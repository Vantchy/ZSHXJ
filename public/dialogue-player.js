/**
 * Linear dialogue/paragraph player. No DOM, navigation, quests or save writes.
 * Paragraphs use story_model.py's id/lines/options contract; this first renderer
 * handles dialogue targets only and fails clearly for unsupported media/actions.
 */
export function createDialoguePlayer({
  dialogues, entryId, characters = {}, onChange = () => {}, onFinish = () => {},
  delay = 30, inputDelay = 160, now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id),
}) {
  const nodes = new Map();
  if (!Array.isArray(dialogues) || !dialogues.length) throw new Error('没有可播放的对白。');
  for (const paragraph of dialogues) {
    if (!paragraph?.id || nodes.has(paragraph.id) || !Array.isArray(paragraph.lines) || !paragraph.lines.length) {
      throw new Error('对白编号重复，或段落没有台词。');
    }
    for (const line of paragraph.lines) {
      const speaker = line?.speaker;
      if (!speaker || Boolean(speaker.characterId) === Boolean(speaker.name) ||
          typeof line.text !== 'string' || !line.text.trim()) throw new Error('对白缺少有效的说话人或台词。');
      if (speaker.characterId && !characters[speaker.characterId]) throw new Error(`角色未登记：${speaker.characterId}`);
      if (line.media) throw new Error('这一版对白播放器尚未接入剧情媒体。');
    }
    if (paragraph.options !== undefined && (!Array.isArray(paragraph.options) || !paragraph.options.length)) {
      throw new Error('对白选项必须是非空数组。');
    }
    nodes.set(paragraph.id, paragraph);
  }
  for (const paragraph of nodes.values()) {
    for (const option of paragraph.options || []) {
      if (!option.text || option.target?.type !== 'dialogue' || !nodes.has(option.target.id)) {
        throw new Error('这一版仅支持跳转到存在的对白段落；任务入口继续使用原有任务面板。');
      }
    }
  }
  if (!nodes.has(entryId)) throw new Error(`对白入口不存在：${entryId}`);

  let current = nodes.get(entryId);
  let index = 0;
  let letters = [];
  let cursor = 0;
  let phase = 'typing';
  let timer = null;
  let disposed = false;
  let finished = false;
  let lastInput = -Infinity;
  let lastBackInput = -Infinity;
  let generation = 0;
  const history = [];
  let historyIndex = -1;

  function snapshot() {
    const line = current.lines[index];
    const record = characters[line.speaker.characterId] || {};
    return {
      paragraphId: current.id, lineIndex: index, phase,
      canGoBack: historyIndex > 0,
      canGoForward: historyIndex < history.length - 1,
      text: letters.slice(0, cursor).join(''), fullText: line.text,
      speaker: {
        id: line.speaker.characterId || '', name: line.speaker.name || record.name,
        expression: line.expression || 'serious', portrait: record.dialoguePortrait || '',
      },
      options: phase === 'choices' ? current.options.map((option) => ({
        text: option.text, target: { ...option.target },
      })) : [],
    };
  }
  function emit() { if (!disposed) onChange(snapshot()); }
  function clearTimer() { if (timer !== null) cancel(timer); timer = null; }
  function complete() {
    clearTimer();
    cursor = letters.length;
    // While reviewing, Continue retraces the selected path instead of asking
    // the same choice again or executing any task/navigation side effect.
    phase = historyIndex < history.length - 1 || index < current.lines.length - 1 ? 'line'
      : current.options?.length ? 'choices' : 'end';
    emit();
  }
  function startLine({remember = true, full = false} = {}) {
    clearTimer();
    const epoch = ++generation;
    if (remember) {
      history.splice(historyIndex + 1);
      history.push({paragraphId: current.id, lineIndex: index});
      historyIndex = history.length - 1;
    }
    letters = Array.from(current.lines[index].text);
    cursor = 0;
    phase = 'typing';
    if (full) { complete(); return; }
    emit();
    if (disposed) return;
    if (delay <= 0) { complete(); return; }
    const tick = () => {
      if (disposed || generation !== epoch || phase !== 'typing') return;
      cursor += 1;
      if (cursor >= letters.length) complete();
      else { emit(); if (!disposed) timer = schedule(tick, delay); }
    };
    timer = schedule(tick, delay);
  }
  function allowInput() {
    if (disposed || finished || now() - lastInput < inputDelay) return false;
    lastInput = now();
    return true;
  }
  function dispose() { disposed = true; generation += 1; clearTimer(); }
  function restoreHistory() {
    const entry = history[historyIndex];
    current = nodes.get(entry.paragraphId);
    index = entry.lineIndex;
    startLine({remember: false, full: true});
  }
  return {
    start() { if (!disposed) startLine(); },
    getState: snapshot,
    advance() {
      if (phase === 'choices' || !allowInput()) return false;
      if (phase === 'typing') complete();
      else if (historyIndex < history.length - 1) { historyIndex += 1; restoreHistory(); }
      else if (phase === 'line') { index += 1; startLine(); }
      else if (phase === 'end') { finished = true; dispose(); onFinish(); }
      return true;
    },
    previous() {
      // Back is independent of the forward/choice input cooldown. Otherwise
      // a quick arrow click immediately after Continue silently does nothing.
      if (disposed || finished || historyIndex <= 0 || now() - lastBackInput < 80) return false;
      lastBackInput = now();
      historyIndex -= 1;
      restoreHistory();
      return true;
    },
    choose(optionIndex) {
      if (phase !== 'choices' || !Number.isInteger(optionIndex) ||
          !current.options[optionIndex] || !allowInput()) return false;
      current = nodes.get(current.options[optionIndex].target.id);
      index = 0;
      startLine();
      return true;
    },
    dispose,
  };
}
