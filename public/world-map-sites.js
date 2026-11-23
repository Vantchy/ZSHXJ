/**
 * 大地图地点坐标以剧情组 2048×1152 原图归一化。
 * 地名不附带章节编号：城池可在不同时期反复访问。
 * 只修改显示 label，不改变 id、坐标或地图导航。
 */
export const WORLD_MAP_SITES = Object.freeze([
  { id: 'qiangfang', label: '羌方', x: 0.12, y: 0.21 },
  { id: 'qizhou', label: '岐周', x: 0.14, y: 0.36 },
  { id: 'fenghao', label: '丰镐', x: 0.19, y: 0.47 },
  { id: 'gan', label: '甘', x: 0.22, y: 0.57 },
  { id: 'lishan', label: '骊山', x: 0.29, y: 0.67 },
  { id: 'guirui', label: '妫汭', x: 0.38, y: 0.60 },
  { id: 'taiyuan', label: '太原', x: 0.55, y: 0.12 },
  { id: 'zhongcun', label: '钟村', x: 0.66, y: 0.19 },
  { id: 'yi', label: '彘', x: 0.58, y: 0.27 },
  { id: 'jin', label: '晋', x: 0.59, y: 0.34 },
  { id: 'taosi', label: '陶寺', x: 0.53, y: 0.44 },
  { id: 'xiwubi', label: '西吴壁', x: 0.60, y: 0.51 },
  { id: 'sibei', label: '寺北', x: 0.55, y: 0.57 },
  { id: 'mingtiao', label: '鸣条', x: 0.51, y: 0.62 },
  { id: 'xingong', label: '新宫', x: 0.82, y: 0.08 },
  { id: 'linzi', label: '临淄', x: 0.92, y: 0.43 },
  { id: 'qufu', label: '曲阜', x: 0.97, y: 0.54 },
  { id: 'yin', label: '殷', x: 0.77, y: 0.54 },
  { id: 'chaoge', label: '朝歌', x: 0.81, y: 0.61 },
  { id: 'muye', label: '牧野', x: 0.88, y: 0.69 },
  { id: 'bo', label: '亳', x: 0.90, y: 0.80 },
  { id: 'jingbo', label: '景亳', x: 0.96, y: 0.91 },
  { id: 'yanshishangcheng', label: '偃师商城', x: 0.79, y: 0.88 },
  { id: 'yangcheng', label: '阳城', x: 0.72, y: 0.92 },
  { id: 'luoyi', label: '洛邑', x: 0.70, y: 0.78 },
  { id: 'mengjin', label: '孟津', x: 0.56, y: 0.84 },
  { id: 'zhenxun', label: '斟鄩', x: 0.61, y: 0.91 },
]).map((site) => Object.freeze(site));

export const WORLD_MAP_INITIAL_FOCUS = Object.freeze({ x: 0.62, y: 0.56 });
/** Exact core bounds within the world-map-grand.png transition canvas. */
export const WORLD_MAP_IMAGE_SIZE = Object.freeze({width:2816,height:1584});
export const WORLD_MAP_DRAG_BOUNDS = Object.freeze({
  x:384,y:216,width:2048,height:1152,
});
/** Turn a marker in the original artwork into a CSS transform origin. */
export function worldMapTransformOrigin(site) {
  const {width,height}=WORLD_MAP_IMAGE_SIZE;
  const box=WORLD_MAP_DRAG_BOUNDS;
  return `${((box.x + site.x * box.width) / width) * 100}% ` +
    `${((box.y + site.y * box.height) / height) * 100}%`;
}
