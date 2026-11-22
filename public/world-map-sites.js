/**
 * 大地图地点坐标全部以剧情组上传的 2048×1152 原图归一化，
 * 绝不使用过渡扩展图的坐标。扩展圈只供云雾转场使用。
 */
export const WORLD_MAP_SITES = Object.freeze([
  { id: 'qiangfang', label: '十六·羌方', x: 0.12, y: 0.21 },
  { id: 'qizhou', label: '二十八·岐周', x: 0.14, y: 0.36 },
  { id: 'fenghao', label: '二十九·丰镐', x: 0.19, y: 0.47 },
  { id: 'gan', label: '五·甘', x: 0.22, y: 0.57 },
  { id: 'lishan', label: '二十七·骊山', x: 0.29, y: 0.67 },
  { id: 'guirui', label: '三·妫汭', x: 0.38, y: 0.60 },

  { id: 'taiyuan', label: '二十六·太原', x: 0.55, y: 0.12 },
  { id: 'zhongcun', label: '七·钟村', x: 0.66, y: 0.19 },
  { id: 'yi', label: '二十五·冀', x: 0.58, y: 0.27 },
  { id: 'jin', label: '二十二·晋', x: 0.59, y: 0.34 },
  { id: 'taosi', label: '二·陶寺', x: 0.53, y: 0.44 },
  { id: 'xiwubi', label: '八·西吴壁', x: 0.60, y: 0.51 },
  { id: 'sibei', label: '十四·寺北', x: 0.55, y: 0.57 },
  { id: 'mingtiao', label: '十一·鸣条', x: 0.51, y: 0.62 },

  { id: 'xingong', label: '九·新宫', x: 0.82, y: 0.08 },
  { id: 'linzi', label: '二十四·临淄', x: 0.92, y: 0.43 },
  { id: 'qufu', label: '二十三·曲阜', x: 0.97, y: 0.54 },
  { id: 'yin', label: '十五·殷', x: 0.77, y: 0.54 },
  { id: 'chaoge', label: '十七·朝歌', x: 0.81, y: 0.61 },
  { id: 'muye', label: '三十·牧野', x: 0.88, y: 0.69 },
  { id: 'bo', label: '十二·亳', x: 0.90, y: 0.80 },
  { id: 'jingbo', label: '十·景亳', x: 0.96, y: 0.91 },
  { id: 'yanshishangcheng', label: '十三·偃师商城', x: 0.79, y: 0.88 },
  { id: 'yangcheng', label: '四·阳城', x: 0.72, y: 0.92 },

  { id: 'luoyi', label: '二十·洛邑', x: 0.70, y: 0.78 },
  { id: 'mengjin', label: '一·孟津', x: 0.56, y: 0.84 },
  { id: 'zhenxun', label: '六·斟鄩', x: 0.61, y: 0.91 },
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
