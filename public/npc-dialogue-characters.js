/* 铸算·华夏纪 | NPC 人物显示资料（独立配置；尚未配置具体表情图片）
 *
 * 编辑此文件中的 expressions 路径即可使用后续从六宫格素材裁切出的 PNG。
 * 当前 main 的第一章章节数据仍把 NPC 命名为“人物”，因此仅在显示层将
 * 这个测试占位名暂时映射为“亥”；不修改 chapters.py、存档或任务模型。
 *
 * 图片示意：hai: {
 *   name: "亥",
 *   defaultExpression: "normal",
 *   expressions: {
 *     normal: "/assets/story/portraits/hai-normal.png",
 *     smile: "/assets/story/portraits/hai-smile.png"
 *   },
 *   objectPosition: "50% 20%"
 * }
 */
(function (global) {
  "use strict";

  global.NPC_DIALOGUE_CHARACTER_CONFIG = {
    characters: {
      hai:  { name: "亥",  defaultExpression: "normal", expressions: {} },
      zi:   { name: "子",  defaultExpression: "normal", expressions: {} },
      chou: { name: "丑",  defaultExpression: "normal", expressions: {} },
      yin:  { name: "寅",  defaultExpression: "normal", expressions: {} },
      mao:  { name: "卯",  defaultExpression: "normal", expressions: {} }
    },

    // 只处理当前官方 main 中用于演示第一章的“人物”占位文本。
    // 后续若 room.js 开始传入真实名字或人物 ID，此映射可以直接删除。
    placeholderNameMap: { "人物": "hai" }
  };
})(window);
