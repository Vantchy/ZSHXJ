/* 铸算·华夏纪 | NPC 五人物 × 六表情资源映射
 * 所有 PNG 位于 public/assets/story/portraits/<id>/<id>_<expression>.png。
 * 图片是 1024×1024 透明 PNG；头像框尺寸由 room-dialogue-centered.css 控制。
 * 默认 serious；其他表情通过 NPCDialogueDisplay.setExpression(...) 切换。
 * 本文件只声明显示资料，不修改 NPC 行走、对话任务和存档逻辑。
 */
(function (global) {
  "use strict";
  const base = "/assets/story/portraits";
  const keys = ["smile", "surprised", "angry", "sad", "thinking", "serious"];

  function makeCharacter(id, name) {
    const expressions = {};
    for (const mood of keys) {
      expressions[mood] = `${base}/${id}/${id}_${mood}.png`;
    }
    return {
      name,
      defaultExpression: "serious",
      expressions,
      objectPosition: "50% 50%"
    };
  }

  global.NPC_DIALOGUE_CHARACTER_CONFIG = {
    characters: {
      hai: makeCharacter("hai", "亥"),
      zi: makeCharacter("zi", "子"),
      chou: makeCharacter("chou", "丑"),
      yin: makeCharacter("yin", "寅"),
      mao: makeCharacter("mao", "卯"),
    },
    // 原第一章测试 NPC 是“人物”：仅在显示层作为亥的样板。
    // 真实 NPC 姓名出现时也能自动找到对应角色，无需改 room.js。
    placeholderNameMap: {
      "人物": "hai",
      "亥": "hai",
      "子": "zi",
      "丑": "chou",
      "寅": "yin",
      "卯": "mao",
    }
  };
})(window);
