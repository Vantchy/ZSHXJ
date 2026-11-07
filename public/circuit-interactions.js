/**
 * 电路编辑器的唯一交互模式转换器。纯函数，无 DOM / 网络 / 存档副作用。
 * 插入态、连线态互斥；第二次引脚点击在确认合法前保留起点。
 */
export const emptyMode = () => ({ palette: null, pin: null, selection: null });

const samePin = (a, b) => Boolean(a && b && a.comp === b.comp && a.pin === b.pin);

export function transitionEditorMode(previous, intent) {
  const state = { ...previous };
  let effect = "none";
  switch (intent.type) {
    case "PALETTE":
      state.palette = state.palette === intent.value ? null : intent.value;
      state.pin = null;
      state.selection = null;
      effect = state.palette ? "armed-placement" : "cancel-placement";
      break;
    case "PIN":
      state.palette = null; // 点接线柱，无条件退出元件连续放置模式
      state.selection = null;
      if (!state.pin) {
        state.pin = { comp: intent.value.comp, pin: intent.value.pin };
        effect = "wire-start";
      } else if (samePin(state.pin, intent.value)) {
        state.pin = null;
        effect = "wire-cancel";
      } else {
        // 校验失败仍保留原起点，下一次可以选择正确引脚。
        effect = { type: "wire-attempt", from: state.pin, to: intent.value };
      }
      break;
    case "WIRE_DONE":
      state.pin = null;
      state.selection = null;
      effect = "wire-complete";
      break;
    case "SELECT":
      state.palette = null;
      state.pin = null;
      state.selection = intent.value;
      effect = "select";
      break;
    case "EMPTY":
      if (state.pin) {
        state.pin = null;
        effect = "wire-cancel"; // 优先取消接线，不放置道具
      } else if (state.palette) {
        effect = { type: "place", componentType: state.palette };
      } else {
        state.selection = null;
        effect = "pan";
      }
      break;
    case "PLACED":
      state.selection = intent.value;
      effect = "placed"; // 连续放置，直到手动退出或点击引脚
      break;
    case "DROP":
      state.palette = null;
      state.pin = null;
      state.selection = null;
      effect = "drop"; // 拖入一次不会意外开启连续放置
      break;
    case "ESCAPE":
      if (state.pin) { state.pin = null; effect = "wire-cancel"; }
      else if (state.palette) { state.palette = null; effect = "cancel-placement"; }
      else { state.selection = null; effect = "deselect"; }
      break;
    case "CANCEL":
      state.pin = null;
      state.palette = null;
      effect = "cancel";
      break;
    case "RESET":
      return { state: emptyMode(), effect: "reset" };
    default:
      throw new Error(`Unknown editor intent: ${intent.type}`);
  }
  return { state, effect };
}

/**
 * A wire is copper, not a directed software dataflow edge. Direction indicates
 * whether the terminal drives the net; both outputs and multiple sink wires
 * are physically drawable. Driver contention is diagnosed by the backend ERC.
 */
export function checkConnection(start, end, pinLookup) {
  const fromPin = pinLookup(start), toPin = pinLookup(end);
  if (!fromPin || !toPin) return {valid:false,message:"引脚不存在，请重新选择"};
  if (start.comp === end.comp && start.pin === end.pin) {
    return {valid:false,message:"不能把引脚接到自身"};
  }
  if (fromPin.width !== toPin.width) {
    return {valid:false,message:"引脚位宽不一致，无法连线"};
  }
  // Prefer traditional out→in for readability and old saved circuit shape.
  if (fromPin.direction === "in" && toPin.direction === "out") {
    return {valid:true,from:{...end},to:{...start}};
  }
  return {valid:true,from:{...start},to:{...end}};
}
