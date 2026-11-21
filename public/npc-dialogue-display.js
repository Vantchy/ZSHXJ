/* 铸算·华夏纪 | NPC 对话头像和姓名显示适配器
 *
 * 不修改 room.js：监测其原生 .room-dialogue--open 结构，填充空头像容器，
 * 将测试占位名替换成已登记姓名。仅操作显示层，绝不拦截对话/任务按钮。
 *
 * 稳定接口（供后续剧情组调用）：
 *   NPCDialogueDisplay.registerCharacter("hai", { name: "亥",
 *     expressions: { normal: "/assets/story/portraits/hai.png" } });
 *   NPCDialogueDisplay.setSpeaker({ id: "hai", expression: "normal" });
 *   NPCDialogueDisplay.setExpression("smile");
 *   NPCDialogueDisplay.clearSpeaker();
 *
 * 注意：当前仅有“单 NPC/章节”业务，未来多 NPC 逻辑需在真正改变说话者
 * 时调用 setSpeaker；本适配器不推测玩家靠近的是谁。
 */
(function (global) {
  "use strict";

  const config = global.NPC_DIALOGUE_CHARACTER_CONFIG || {};
  const records = new Map();
  const defaults = config.placeholderNameMap || {};
  const nativeLabels = new WeakMap();

  let app = null;
  let activeStage = null;
  let selected = null;
  let queued = false;
  let observer = null;

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function asText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function recordCharacter(id, data) {
    const key = asText(id);
    if (!key || !isObject(data)) return false;

    const previous = records.get(key) || {};
    const expressions = isObject(data.expressions)
      ? { ...(previous.expressions || {}), ...data.expressions }
      : { ...(previous.expressions || {}) };
    records.set(key, {
      ...previous, ...data,
      name: asText(data.name) || previous.name || key,
      defaultExpression: asText(data.defaultExpression)
        || previous.defaultExpression || "normal",
      expressions
    });
    queueSync();
    return true;
  }

  Object.entries(isObject(config.characters) ? config.characters : {})
    .forEach(([id, data]) => recordCharacter(id, data));

  function safeImagePath(value) {
    const path = asText(value);
    if (!path) return "";
    try {
      const resolved = new URL(path, document.baseURI);
      // 素材仅允许本站地址，避免错误外链和危险协议。
      if (resolved.origin !== global.location.origin ||
          !["http:", "https:"].includes(resolved.protocol)) return "";
      return resolved.href;
    } catch (_) {
      return "";
    }
  }

  function resolvePicture(record, expression, override) {
    const expressions = record.expressions || {};
    const expressionKey = asText(expression) || record.defaultExpression || "normal";
    const specified = asText(override?.portrait);
    const candidate = specified
      || asText(expressions[expressionKey])
      || asText(expressions[record.defaultExpression || "normal"])
      || asText(record.portrait);
    return safeImagePath(candidate);
  }

  function sync() {
    queued = false;
    app = document.getElementById("app");
    if (!app || !app.classList.contains("page--room")) {
      activeStage = null;
      selected = null;
      return;
    }

    const stage = app.querySelector(".room-stage");
    if (!stage) return;
    if (activeStage && activeStage !== stage) selected = null;
    activeStage = stage;

    const dialogue = stage.querySelector(".room-dialogue.room-dialogue--open");
    const layout = dialogue?.querySelector(".npc-dialogue-layout");
    const frame = layout?.querySelector(".npc-dialogue-portrait");
    const nameplate = layout?.querySelector(".npc-dialogue-speaker");
    if (!frame || !nameplate) return;

    if (!nativeLabels.has(layout)) {
      nativeLabels.set(layout, asText(nameplate.textContent));
    }
    const originalName = nativeLabels.get(layout) || "";

    // 有明确选择时优先使用剧情接口；否则用测试占位名映射。
    const id = selected?.id || asText(defaults[originalName]);
    const record = records.get(id) || {};
    const name = asText(selected?.name) || asText(record.name) || originalName;
    const expression = selected?.expression || record.defaultExpression || "normal";

    if (nameplate.textContent !== name) nameplate.textContent = name;
    const desiredAria = `与${name || "人物"}对话`;
    if (dialogue.getAttribute("aria-label") !== desiredAria) {
      dialogue.setAttribute("aria-label", desiredAria);
    }
    frame.setAttribute("aria-label", `${name || "人物"}头像`);

    const imageSrc = resolvePicture(record, expression, selected);
    let img = frame.querySelector("img.npc-dialogue-portrait-image");

    if (!imageSrc) {
      if (img) img.remove();
      frame.classList.remove("npc-dialogue-portrait--has-image");
      frame.classList.add("npc-dialogue-portrait--empty");
      return;
    }

    if (!img) {
      img = document.createElement("img");
      img.className = "npc-dialogue-portrait-image";
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.draggable = false;
      img.decoding = "async";
      img.addEventListener("error", () => {
        img.hidden = true;
        frame.classList.remove("npc-dialogue-portrait--has-image");
        frame.classList.add("npc-dialogue-portrait--empty");
      });
      img.addEventListener("load", () => {
        img.hidden = false;
        frame.classList.add("npc-dialogue-portrait--has-image");
        frame.classList.remove("npc-dialogue-portrait--empty");
      });
      frame.appendChild(img);
    }

    img.style.objectPosition = asText(selected?.objectPosition)
      || asText(record.objectPosition) || "50% 22%";

    // 只有路径变化时才重置图片，不因打字机更新而反复加载。
    if (img.dataset.portraitSrc !== imageSrc) {
      img.dataset.portraitSrc = imageSrc;
      img.hidden = false;
      img.src = imageSrc;
    }
    if (!img.hidden) {
      frame.classList.add("npc-dialogue-portrait--has-image");
      frame.classList.remove("npc-dialogue-portrait--empty");
    }
  }

  function queueSync() {
    if (queued) return;
    queued = true;
    Promise.resolve().then(sync);
  }

  function setSpeaker(value) {
    const next = typeof value === "string" ? { id: value } : value;
    if (!isObject(next)) return false;
    const id = asText(next.id);
    const name = asText(next.name);
    if (!id && !name) return false;
    selected = {
      id,
      name,
      expression: asText(next.expression),
      portrait: asText(next.portrait),
      objectPosition: asText(next.objectPosition)
    };
    queueSync();
    return true;
  }

  function setExpression(value) {
    const expression = asText(value);
    if (!expression) return false;
    if (!selected) {
      const nameplate = document.querySelector(
        "#app.page--room .room-dialogue--open .npc-dialogue-speaker"
      );
      const label = nameplate ? asText(nameplate.textContent) : "";
      const id = Object.keys(defaults).includes(label)
        ? asText(defaults[label])
        : [...records].find(([, item]) => item.name === label)?.[0] || "";
      if (!id) return false;
      selected = { id, expression: "" };
    }
    selected.expression = expression;
    queueSync();
    return true;
  }

  function clearSpeaker() {
    selected = null;
    queueSync();
  }

  function relevantMutation(change) {
    const target = change.target;
    if (target === app) return true;
    if (!target || target.nodeType !== 1) return false;
    if (change.type === "attributes") {
      return target.classList.contains("room-dialogue");
    }
    return target.classList.contains("room-dialogue") ||
      target.classList.contains("room-stage");
  }

  function start() {
    app = document.getElementById("app");
    if (!app || observer) return;
    observer = new MutationObserver((changes) => {
      if (changes.some(relevantMutation)) queueSync();
    });
    observer.observe(app, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"]
    });
    queueSync();
  }

  global.NPCDialogueDisplay = Object.freeze({
    registerCharacter: recordCharacter,
    registerCharacters(list) {
      if (!isObject(list)) return false;
      for (const [id, data] of Object.entries(list)) recordCharacter(id, data);
      return true;
    },
    setSpeaker,
    setExpression,
    clearSpeaker,
    refresh: queueSync,
    getCurrentSpeaker() {
      return selected ? { ...selected } : null;
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})(window);
