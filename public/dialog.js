/* 通用页面内对话框：提示、确认和输入；支持键盘与焦点管理。 */
let nextDialogId = 0;
let pending = Promise.resolve();

function openDialog({kind, message, defaultValue="", inputType="text", title}) {
  const cancelValue = kind === "prompt" ? null : false;
  const previousFocus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.setAttribute("data-app-dialog", kind);
  overlay.className = "dialog-overlay";
  const panel = document.createElement("div");
  panel.className = "dialog-panel";
  panel.setAttribute("role", kind === "alert" ? "alertdialog" : "dialog");
  panel.setAttribute("aria-modal", "true");
  const heading = document.createElement("h3");
  const dialogId = `huaxia-dialog-${++nextDialogId}`;
  heading.id = dialogId;
  heading.textContent = title || (
    kind === "alert" ? "提示" : kind === "prompt" ? "请输入" : "确认操作"
  );
  panel.setAttribute("aria-labelledby", dialogId);
  panel.append(heading);
  const description = document.createElement("p");
  description.id = `${dialogId}-description`;
  description.textContent = String(message ?? "");
  description.className = "dialog-description";
  panel.setAttribute("aria-describedby", description.id);
  panel.append(description);
  let entry = null;
  if (kind === "prompt") {
    entry = document.createElement("input");
    entry.type = inputType === "password" ? "password" : "text";
    entry.value = String(defaultValue ?? "");
    entry.className = "dialog-input";
    if (entry.type === "password") entry.autocomplete = "new-password";
    entry.setAttribute("aria-label", String(message || "请输入内容"));
    panel.append(entry);
  }
  const controls = document.createElement("div");
  controls.className = "dialog-actions";
  panel.append(controls);
  overlay.append(panel);

  return new Promise((resolve) => {
    let finished = false;
    function finish(value) {
      if (finished) return;
      finished = true;
      overlay.removeEventListener("keydown", handleKey);
      overlay.remove();
      if (previousFocus?.isConnected) previousFocus.focus?.();
      resolve(value);
    }
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "确定";
    function acceptDialog() {
      finish(kind === "prompt" ? entry.value : true);
    }
    if (kind !== "alert") {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "取消";
      cancel.addEventListener("click", () => finish(cancelValue));
      controls.append(cancel);
    }
    accept.addEventListener("click", acceptDialog);
    controls.append(accept);
    function handleKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(cancelValue);
      } else if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        acceptDialog();
      } else if (event.key === "Tab") {
        // Keep keyboard navigation inside the modal while it is open.
        const tabbable = kind === "prompt"
          ? [entry, ...controls.querySelectorAll("button")]
          : [...controls.querySelectorAll("button")];
        if (!tabbable.length) return;
        const first = tabbable[0], last = tabbable[tabbable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus?.();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus?.();
        }
      }
    }
    overlay.addEventListener("keydown", handleKey);
    document.body.append(overlay);
    (entry || accept).focus?.();
  });
}

/**
 * Serializes dialogs so a failure notification cannot be hidden by another
 * dialog. resolve values: prompt => string|null, confirm => boolean,
 * alert => boolean. Cancellation never submits a server write.
 */
export function showDialog(options) {
  const current = pending.then(() => openDialog(options));
  pending = current.then(() => {}, () => {});
  return current;
}
export function confirmDialog(message) {
  return showDialog({kind:"confirm",message});
}
export function promptDialog(message, defaultValue="", options={}) {
  return showDialog({kind:"prompt",message,defaultValue,...options});
}
export function alertDialog(message) {
  return showDialog({kind:"alert",message});
}
