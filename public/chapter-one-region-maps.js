/**
 * 第一章十处地区小地图，统一切换到用户新提供的高清复原图。
 * 本轮仅实装孟津两个已确认光点；其余小地图仍保持无光点状态。
 * 孟津两点都先接到当前唯一可玩的现有样张，后续再按剧情拆分。
 */
const EMPTY_SPOTS = Object.freeze([]);
const MENGJIN_SPOTS = Object.freeze([
  Object.freeze({id:'mengjin-inner-court', x:0.3522, y:0.4274,
    label:'孟津内城', ariaLabel:'孟津内城剧情入口'}),
  Object.freeze({id:'mengjin-river-gate', x:0.5420, y:0.5399,
    label:'孟津河门', ariaLabel:'孟津河门剧情入口'}),
]);

export const CHAPTER_ONE_REGIONS = Object.freeze([
  {id:'mengjin',    title:'孟津',   imageUrl:'/assets/scenes/chapter1-maps/01-mengjin.webp',   width:2047,height:1152, act:'亥', hotspots:MENGJIN_SPOTS},
  {id:'taosi',      title:'陶寺',   imageUrl:'/assets/scenes/chapter1-maps/02-taosi.webp',     width:2047,height:1152, act:'子', hotspots:EMPTY_SPOTS},
  {id:'guirui',     title:'妫汭',   imageUrl:'/assets/scenes/chapter1-maps/03-guirui.webp',    width:2047,height:1152, act:'子', hotspots:EMPTY_SPOTS},
  {id:'yangcheng',  title:'阳城',   imageUrl:'/assets/scenes/chapter1-maps/04-yangcheng.webp', width:2047,height:1152, act:'丑', hotspots:EMPTY_SPOTS},
  {id:'gan',        title:'甘',     imageUrl:'/assets/scenes/chapter1-maps/05-gan.webp',       width:2047,height:1152, act:'丑', hotspots:EMPTY_SPOTS},
  {id:'zhenxun',    title:'斟鄩',   imageUrl:'/assets/scenes/chapter1-maps/06-zhenxun.webp',   width:2047,height:1152, act:'寅', hotspots:EMPTY_SPOTS},
  {id:'zhongcun',   title:'钟村',   imageUrl:'/assets/scenes/chapter1-maps/07-zhongcun.webp',  width:2047,height:1152, act:'寅', hotspots:EMPTY_SPOTS},
  {id:'xiwubi',     title:'西吴壁', imageUrl:'/assets/scenes/chapter1-maps/08-xiwubi.webp',    width:2047,height:1152, act:'卯', hotspots:EMPTY_SPOTS},
  {id:'xingong',    title:'新宫',   imageUrl:'/assets/scenes/chapter1-maps/09-xingong.webp',   width:2047,height:1152, act:'卯', hotspots:EMPTY_SPOTS},
  {id:'jingbo',     title:'景亳',   imageUrl:'/assets/scenes/chapter1-maps/10-jingbo.webp',    width:2047,height:1152, act:'寅', hotspots:EMPTY_SPOTS},
].map(region=>Object.freeze(region)));

const BY_ID = new Map(CHAPTER_ONE_REGIONS.map(region=>[region.id,region]));

export function getChapterOneRegion(regionId) {
  return BY_ID.get(regionId) || null;
}
