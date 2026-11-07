/**
 * 房间可调查物：保存标识、交互位置和说明都集中维护。
 * 详情浮层复用同一实例，避免多次按 E 产生堆叠面板。
 */
import { ROOM_OBJECT_X } from "./room-world.js";

const OBJECTS_BY_LOCATION = Object.freeze({
  "gate-road": Object.freeze({
    id: "clay-mold",
    x: ROOM_OBJECT_X,
    flag: "investigatedMold",
    checkpoint: "investigate_mold",
    title: "陶范",
    description: "陶范用于塑造铜器外形。范体合缝处须严密，方能使铜液成形。",
  }),
});

export function findRoomObject(locationId) {
  return OBJECTS_BY_LOCATION[locationId] || null;
}

export function createItemInspector(stage) {
  let panel = null;
  let currentId = null;

  function close() {
    panel?.remove?.();
    panel = null;
    currentId = null;
  }

  function open({ id, title, description }) {
    if (panel && currentId === id) return panel;
    close();

    panel = document.createElement("aside");
    panel.className = "item-detail scroll-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `${title}介绍`);

    const heading = document.createElement("strong");
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = description;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "收起";
    dismiss.addEventListener("click", close);

    panel.append(heading, paragraph, dismiss);
    stage.append(panel);
    currentId = id;
    return panel;
  }

  return { open, close, isOpen: () => Boolean(panel), dispose: close };
}
