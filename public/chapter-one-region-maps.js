/**
 * 第一章十处地区小地图，统一切换到用户新提供的高清复原图。
 * 本轮仅实装孟津两个已确认光点；其余小地图仍保持无光点状态。
 * 河门点按正式任务进入玉匠铺/贞人夜景；内城点在夜访后开启授业学舍。
 */
const EMPTY_SPOTS = Object.freeze([]);
const MENGJIN_SPOTS = Object.freeze([
  Object.freeze({id:'mengjin-inner-court', x:0.3522, y:0.4274,
    label:'孟津内城·授业学舍', ariaLabel:'孟津内城·授业学舍（夜访贞人后解锁）', locationId:'mengjin-school-courtyard'}),
  Object.freeze({id:'mengjin-river-gate', x:0.5420, y:0.5399,
    label:'孟津河门', ariaLabel:'进入孟津玉匠铺·第一场',
    locationId:'mengjin-jade-courtyard'}),
]);

// 陶寺旧学舍的交互点为初版定位，后续可按高清陶寺小地图微调。
const TAOSI_SPOTS = Object.freeze([
  Object.freeze({id:'taosi-old-academy-dot',x:0.54,y:0.56,
    label:'陶寺·器派旧学舍',ariaLabel:'进入陶寺旧学舍·子时算稿前三页',
    locationId:'taosi-old-academy'}),
]);
// 嫣沩水畔：同一个光点，第四页完成后自动切换夜景。
// atlas 仍采用已有 guirui 内部地区 ID，避免破坏地图历史路由。
const YANWEI_SPOTS = Object.freeze([
  Object.freeze({id:'yanwei-workshop-dot',x:0.54,y:0.54,
    label:'嫣沩·水畔玉网工坊',ariaLabel:'进入子时嫣沩玉网工坊',locationId:'yanwei-riverside-day'}),
]);
export const CHAPTER_ONE_REGIONS = Object.freeze([
  {id:'mengjin',    title:'孟津',   imageUrl:'/assets/scenes/chapter1-maps/01-mengjin.webp',   width:2047,height:1152, act:'亥', hotspots:MENGJIN_SPOTS},
  {id:'taosi',      title:'陶寺',   imageUrl:'/assets/scenes/chapter1-maps/02-taosi.webp',     width:2047,height:1152, act:'子', hotspots:TAOSI_SPOTS},
  {id:'guirui',     title:'嫣沩（原图册：妫汭）', imageUrl:'/assets/scenes/chapter1-maps/03-guirui.webp', width:2047,height:1152, act:'子', hotspots:YANWEI_SPOTS},
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
