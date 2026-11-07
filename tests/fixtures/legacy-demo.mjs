/*
 * 演示关卡仅演示记录组数，不计算学生用时，不使用百分制。
 * mount返回清理函数；退出时清理按钮事件，并可返回主菜单。
 */
export const meta = { id: "ch1", title: "从逻辑门到存算器件" };

export async function mount(ctx) {
  const { container, state, startAttempt, saveProgress, submitScore, exit } = ctx;
  let disposed = false;
  const listeners = [];
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (ctx.signal) ctx.signal.removeEventListener("abort", dispose);
    for (const [button, event, listener] of listeners) {
      button.removeEventListener(event, listener);
    }
  }
  const heading = document.createElement("h3");
  heading.textContent = "演示关卡（占位）";
  heading.className = "level-heading";
  container.append(heading);
  const resultLine = document.createElement("p");
  resultLine.className = "level-summary";
  container.append(resultLine);
  const statusLine = document.createElement("p");
  statusLine.setAttribute("role", "status");
  statusLine.className = "notice notice--info";
  container.append(statusLine);
  const actions = document.createElement("div");
  actions.className = "level-actions";
  container.append(actions);
  let retries = 0;
  let pending = state.flags?.demoPending || null;
  let draft = pending?.draft || null;
  let busy = false;
  let done = false;

  if (ctx.signal) ctx.signal.addEventListener("abort", dispose, { once: true });
  function addButton(label, action) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", action);
    listeners.push([b, "click", action]);
    actions.append(b);
    return b;
  }
  async function goToMainMenu() {
    if (disposed || busy) return;
    try {
      await ctx.exitToHome();
    } catch (error) {
      statusLine.className = "notice notice--error";
      statusLine.textContent = error.message || "退出失败";
    }
  }
  function showDraft() {
    for (const [button, event, listener] of listeners) {
      button.removeEventListener(event, listener);
    }
    listeners.length = 0;
    actions.replaceChildren();
    if (done) {
      resultLine.textContent = "本次演示成绩已成功保存。";
      // 剧情演示成绩已入库，才展示正式电路实验入口；不会伪造正式关卡结果。
      if (typeof ctx.openFormalLevels === "function") {
        addButton("继续正式电路实验", async () => {
          if (disposed || busy) return;
          try { await ctx.openFormalLevels(); } catch (error) {
            statusLine.className = "notice notice--error";
            statusLine.textContent = error.message || "进入正式实验失败";
          }
        });
      }
      addButton("返回小地图", async () => {
        try { await exit(); } catch (error) {
          statusLine.className = "notice notice--error";
          statusLine.textContent = error.message;
        }
      });
      addButton("返回主界面", goToMainMenu);
      return;
    }
    resultLine.textContent = draft
      ? `模拟成绩：4组中通过${draft.passedCount ?? 4}组；` +
        `当前状态：${draft.completed?"已完成":"未完成"}；重试次数：${retries}。` +
        "（非正式电路评测）"
      : "尚未生成演示结果。";
    if (!draft) {
      addButton("生成随机演示结果", generate);
    } else {
      addButton("保存结果", save);
      if (!pending) addButton("重试（重新生成）", retry);
    }
    addButton("返回小地图", async () => {
      if (busy) return;
      try { await exit(); } catch (error) {
          statusLine.className = "notice notice--error";
          statusLine.textContent = error.message;
        }
    });
    addButton("返回主界面", goToMainMenu);
  }

  function generate() {
    if (disposed || busy || pending) return;
    draft = {
      // 旧演示无真实电路，只用于验证可重试的存档和成绩流程；
      // 真正的通过组数必须由正式关卡后端运行测试得到。
      passedCount: 4,
      totalCount: 4,
      completed: true,
    };
    ctx.setUnsavedChanges(true);
    statusLine.className = "notice notice--info";
    statusLine.textContent = "结果未保存。";
    showDraft();
  }

  function retry() {
    if (disposed || busy || pending) return;
    retries += 1;
    draft = null;
    generate();
  }

  async function save() {
    if (disposed || busy || done || !draft) return;
    busy = true;
    actions.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    statusLine.className = "notice notice--info";
    statusLine.textContent = "正在保存...";
    try {
      state.flags ??= {};
      if (!pending) {
        pending = {
          attemptId: await startAttempt(),
          draft: { ...draft },
          retries,
        };
      }
      state.flags.demoPending = pending;
      // 先保存待提交状态：断网后再次打开关卡会恢复同一 attemptId。
      await saveProgress(state, "demo_pending");
      // 待提交演示草稿恢复后沿用原请求格式和attemptId。
      const isPersistedNumericDraft = Object.hasOwn(pending.draft, "score");
      const details = isPersistedNumericDraft
        ? { attempts:pending.draft.attempts,
            durationSeconds:pending.draft.durationSeconds,
            retries:pending.retries, mock:true }
        : { passedCount:pending.draft.passedCount,
            totalCount:pending.draft.totalCount, unit:"组", mock:true };
      await submitScore({
        score:isPersistedNumericDraft ? pending.draft.score : 0,
        completed:pending.draft.completed,
        attemptId:pending.attemptId, details,
      });
      state.tasks ??= {};
      state.tasks.main ??= {};
      if (state.tasks.main.status !== "submitted") {
        state.tasks.main.status = "completed";
      }
      state.flags.demoLastSaved = { ...pending.draft, retries: pending.retries };
      delete state.flags.demoPending;
      try {
        await saveProgress(state, "demo_result_saved");
      } catch (error) {
        // 成绩已入库；保存恢复标识失败，恢复时可用同一 attemptId 幂等提交。
        state.flags.demoPending = pending;
        statusLine.className = "notice notice--error";
        statusLine.textContent = `成绩已入库，但进度同步失败：${error.message}；请重试保存。`;
        return;
      }
      done = true;
      ctx.setUnsavedChanges(false);
      statusLine.className = "notice notice--success";
      statusLine.textContent = "演示结果已入库，正式电路成绩请查看各关通过组数。";
      resultLine.textContent = `已保存：4组中通过${pending.draft.passedCount ?? 4}组；` +
        `重试${pending.retries}次。`;
      pending = null;
      draft = null;
    } catch (error) {
      statusLine.className = "notice notice--error";
      statusLine.textContent = `保存失败：${error.message}。保留本次结果，可再次点击保存。`;
    } finally {
      busy = false;
      showDraft();
      if (done) {
        resultLine.textContent = "成绩已保存；如需再模拟一次，可返回房间重新进入。";
      }
    }
  }

  if (pending) {
    retries = pending.retries;
    statusLine.textContent = "检测到上次未确认的提交，点击保存可安全重试。";
  }
  showDraft();
  return dispose;
}
