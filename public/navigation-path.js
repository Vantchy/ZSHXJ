/**
 * 唯一的场景路径模型与顶栏路径渲染器。
 * 视图只传当前阶段与导航回调；不再根据章节名称拼接临时文本。
 * “大地图 → 小地图 → 房间”是当前可用的完整导航层级。
 */
const STAGES = Object.freeze([
  Object.freeze({key: "world", label: "大地图"}),
  Object.freeze({key: "chapter", label: "小地图"}),
  Object.freeze({key: "room", label: "房间"}),
]);

export function getNavigationPath(stage) {
  const index = STAGES.findIndex((entry) => entry.key === stage);
  if (index < 0) throw new TypeError(`未知导航阶段：${String(stage)}`);
  return STAGES.slice(0, index + 1).map((entry, position) => ({
    key: entry.key, label: entry.label, current: position === index,
  }));
}

export function mountNavigationPath(parent, stage, onNavigate = () => {}) {
  const navigation = document.createElement("nav");
  navigation.className = "room-place-name room-navigation-path";
  navigation.setAttribute("aria-label", "地图导航路径");
  const segments = getNavigationPath(stage);
  segments.forEach((segment, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "room-path-separator";
      separator.textContent = "›";
      separator.setAttribute("aria-hidden", "true");
      navigation.append(separator);
    }
    const item = document.createElement(segment.current ? "span" : "button");
    item.className = "room-path-segment" + (segment.current ? " is-current" : "");
    item.textContent = segment.label;
    if (segment.current) {
      item.setAttribute("aria-current", "page");
    } else {
      item.type = "button";
      item.addEventListener("click", () => onNavigate(segment.key));
    }
    navigation.append(item);
  });
  parent.append(navigation);
  return navigation;
}
