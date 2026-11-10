/*
 * ZSHXJ UI shell · additive adapter for the existing SPA.
 * No removal of existing click listeners, breadcrumbs, wallet, level title,
 * chapter state, circuit-editor controls, or route code.
 */
(() => {
  "use strict";
  const ROOT_ID = "app";
  const BRAND = "铸算·华夏纪";
  const HOME_EVENT = "zshxj:ui-home-request";
  const SETTINGS_EVENT = "zshxj:ui-settings-request";
  const SKIP_SKINS = ["page--landing", "page--auth", "page--home",
                      "page--settings", "page--placeholder"];

  const text = (node) => (node?.textContent || "").trim();
  const isReturn = (label) => /^返回(?:\s|$|上|主|房|地|大|小|关|班|学)/.test(label);
  const emit = (name) => window.dispatchEvent(new CustomEvent(name));

  function newButton(label, className, handler) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener("click", handler);
    return btn;
  }

  function labelAsBack(btn) {
    if (!btn) return;
    const old = text(btn);
    if (old !== "返回") {
      if (old && !btn.title) btn.title = old;
      btn.textContent = "返回";
    }
    btn.classList.add("ui-shell-action", "ui-shell-back");
  }

  function ensureBrand(header, selector, placement) {
    let brand = header.querySelector(selector);
    if (!brand) {
      brand = newButton(BRAND, "ui-shell-brand", () => emit(HOME_EVENT));
      header.insertBefore(brand, placement || header.firstChild);
    }
    if (text(brand) !== BRAND) brand.textContent = BRAND;
    brand.classList.add("ui-shell-brand");
    return brand;
  }

  function ensureSettings(nav, existing) {
    if (existing) {
      existing.classList.add("ui-shell-action", "ui-shell-settings");
      return existing;
    }
    let button = nav.querySelector(".ui-shell-settings");
    if (!button) {
      button = newButton("设置", "ui-shell-action ui-shell-settings",
                         () => emit(SETTINGS_EVENT));
      nav.append(button);
    }
    return button;
  }

  function markReady(root, header) {
    if (!header.classList.contains("ui-standard-header")) {
      header.classList.add("ui-standard-header");
    }
    if (!root.classList.contains("ui-has-standard-header")) {
      root.classList.add("ui-has-standard-header");
    }
  }

  function setupResults(root, header) {
    const nav = header.querySelector(".results-header-actions");
    if (!nav) return;
    const buttons = [...nav.querySelectorAll("button")];
    // Reuse the original MENU button as the home brand: its original
    // showHome click handler remains attached. Never relabel it "设置"
    // because that would silently retain a home-navigation callback.
    const menu = buttons.find(b => text(b) === "菜单");
    if (menu) {
      menu.classList.remove("results-header-button");
      menu.classList.add("ui-shell-brand");
      menu.textContent = BRAND;
      header.insertBefore(menu, nav);
    }
    ensureBrand(header, ".ui-shell-brand", nav);
    const back = [...nav.querySelectorAll("button")].find(b =>
      isReturn(text(b)) || b.classList.contains("ui-shell-back")
    );
    labelAsBack(back);
    ensureSettings(nav, [...nav.querySelectorAll("button")].find(b => text(b) === "设置"));
    markReady(root, header);
  }

  function setupRoomOrMap(root, header) {
    ensureBrand(header, ".room-brand", header.firstChild);
    const actions = [...header.querySelectorAll(":scope > button.room-top-action")];
    // A room's "小地图" action is its previous-level navigation.
    const back = actions.find(btn =>
      btn.classList.contains("room-mini-map") || isReturn(text(btn))
    );
    if (back) labelAsBack(back);
    const settings = actions.find(btn => text(btn) === "设置");
    if (settings) settings.classList.add("ui-shell-action","ui-shell-settings");
    markReady(root, header);
  }

  function setupCircuit(root, header) {
    // Circuit adapter owns the click-bound buttons. Do not move them.
    ensureBrand(header, ".brand-link", header.firstChild);
    const nav = header.querySelector(".ce-v2-navigation");
    if (!nav) return;
    labelAsBack(nav.querySelector(".ce-v2-nav-back"));
    const settings = nav.querySelector(".ce-v2-nav-settings");
    if (settings) settings.classList.add("ui-shell-action","ui-shell-settings");
    markReady(root, header);
  }

  function locateExistingBack(root) {
    const direct = [...root.children].find(
      element => element.tagName === "BUTTON" && isReturn(text(element))
    );
    if (direct) return direct;
    // Teacher management already provides a "返回主界面" action.
    // Move just that real button, not the rest of the management navigation.
    const nav = root.querySelector(":scope > .management-nav");
    if (nav) {
      return [...nav.children].find(
        element => element.tagName === "BUTTON" && isReturn(text(element))
      ) || null;
    }
    return null;
  }

  function ensureTitleText(header) {
    for (const node of [...header.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const span = document.createElement("span");
      span.className = "ui-shell-page-name";
      span.textContent = node.textContent;
      span.title = span.textContent.trim();
      node.replaceWith(span);
    }
  }

  function setupGeneric(root, header) {
    ensureTitleText(header);
    ensureBrand(header, ".brand-link, .ui-shell-brand", header.firstChild);
    let actions = header.querySelector(":scope > .ui-shell-actions");
    if (!actions) {
      actions = document.createElement("nav");
      actions.className = "ui-shell-actions";
      actions.setAttribute("aria-label", "页面操作");
      header.append(actions);
    }
    if (!actions.querySelector(".ui-shell-back")) {
      const original = locateExistingBack(root);
      if (original) {
        actions.prepend(original);  // preserve original listener / route callback
        labelAsBack(original);
      } else {
        // Do not manufacture a false "back" route from the admin home view.
        const mainRoot = root.classList.contains("page--admin")
          && root.classList.contains("page--admin-overview");
        const back = newButton("返回", "ui-shell-action ui-shell-back",
          () => emit(HOME_EVENT));
        if (mainRoot) {
          back.disabled = true;
          back.title = "当前为管理员首页";
        }
        actions.prepend(back);
      }
    }
    ensureSettings(actions, actions.querySelector(".ui-shell-settings"));
    markReady(root, header);
  }

  function sync() {
    const root = document.getElementById(ROOT_ID);
    if (!root?.classList.contains("page")) return;
    if (SKIP_SKINS.some(s => root.classList.contains(s))) return;

    const room = root.querySelector(":scope > .room-topbar");
    if (room) return setupRoomOrMap(root, room);
    const result = root.querySelector(":scope > .results-header");
    if (result) return setupResults(root, result);
    const header = root.querySelector(":scope > .page-title");
    if (!header) return;
    // The circuit adapter reparents click-bound controls asynchronously.
    // Never touch that heading until it declares itself ready.
    if (root.classList.contains("circuit-level-page")) {
      if (!root.classList.contains("ce-desktop-v2")) return;
      return setupCircuit(root, header);
    }
    setupGeneric(root, header);
  }

  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  let requested = false;
  function schedule() {
    if (requested) return;
    requested = true;
    requestAnimationFrame(() => {
      requested = false;
      sync();
    });
  }
  new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target;
      if (target === root) return true;
      if (!(target instanceof Element)) return false;
      if (record.type === "attributes") return target === root;
      return Boolean(target.closest(
        ".page-title, .room-topbar, .results-header, .management-nav"
      ));
    });
    if (relevant) schedule();
  }).observe(root, {
    subtree: true, childList: true,
    attributes: true, attributeFilter: ["class"]
  });
  schedule();
  window.__ZSHXJ_UI_SHELL__ = Object.freeze({sync, schedule});
})();
