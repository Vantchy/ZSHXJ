/**
 * 第一章二十七处地区小地图，统一切换到用户新提供的高清复原图。
 * 本轮仅实装孟津两个已确认光点；其余小地图仍保持无光点状态。
 * 河门点进入玉匠铺正式对白预览；内城点留给未来授业学舍。
 */
const EMPTY_SPOTS = Object.freeze([]);
const MENGJIN_SPOTS = Object.freeze([
  Object.freeze({id:'mengjin-inner-court', x:0.3522, y:0.4274,
    label:'孟津内城', ariaLabel:'孟津内城·授业学舍尚未开放', locationId:null}),
  Object.freeze({id:'mengjin-river-gate', x:0.5420, y:0.5399,
    label:'孟津河门', ariaLabel:'进入孟津玉匠铺·第一场',
    locationId:'mengjin-jade-courtyard'}),
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
  {id:'mingtiao', title:'鸣条', imageUrl:'/assets/scenes/chapter1-maps/11-mingtiao.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'bo', title:'亳', imageUrl:'/assets/scenes/chapter1-maps/12-bo.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'yanshishangcheng', title:'偃师商城', imageUrl:'/assets/scenes/chapter1-maps/13-yanshishangcheng.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'sibei', title:'寺北', imageUrl:'/assets/scenes/chapter1-maps/14-sibei.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'yin', title:'殷', imageUrl:'/assets/scenes/chapter1-maps/15-yin.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'qiangfang', title:'羌方', imageUrl:'/assets/scenes/chapter1-maps/16-qiangfang.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'chaoge', title:'朝歌', imageUrl:'/assets/scenes/chapter1-maps/17-chaoge.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'qizhou', title:'岐周', imageUrl:'/assets/scenes/chapter1-maps/18-qizhou.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'fenghao', title:'丰镐', imageUrl:'/assets/scenes/chapter1-maps/19-fenghao.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'muye', title:'牧野', imageUrl:'/assets/scenes/chapter1-maps/20-muye.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'luoyi', title:'洛邑', imageUrl:'/assets/scenes/chapter1-maps/21-luoyi.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'jin', title:'晋', imageUrl:'/assets/scenes/chapter1-maps/22-jin.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'qufu', title:'曲阜', imageUrl:'/assets/scenes/chapter1-maps/23-qufu.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'linzi', title:'临淄', imageUrl:'/assets/scenes/chapter1-maps/24-linzi.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'yi', title:'彘', imageUrl:'/assets/scenes/chapter1-maps/25-yi.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'taiyuan', title:'太原', imageUrl:'/assets/scenes/chapter1-maps/26-taiyuan.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
  {id:'lishan', title:'骊山', imageUrl:'/assets/scenes/chapter1-maps/27-lishan.webp', width:2047,height:1152, act:'', hotspots:EMPTY_SPOTS},
].map(region=>Object.freeze(region)));

const BY_ID = new Map(CHAPTER_ONE_REGIONS.map(region=>[region.id,region]));

export function getChapterOneRegion(regionId) {
  return BY_ID.get(regionId) || null;
}
