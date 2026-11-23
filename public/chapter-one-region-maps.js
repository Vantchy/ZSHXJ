/**
 * 第一章十处地区小地图，统一切换到用户新提供的高清复原图。
 * 本轮仅实装孟津两个已确认光点；其余小地图仍保持无光点状态。
 * 河门点按正式任务进入玉匠铺/贞人夜景；内城点在夜访后开启授业学舍。
 */
const EMPTY_SPOTS = Object.freeze([]);
const MENGJIN_SPOTS = Object.freeze([
  Object.freeze({id:'mengjin-inner-court', x:0.3340, y:0.4030,
    label:'孟津内城·授业学舍', ariaLabel:'孟津内城·授业学舍（夜访贞人后解锁）', locationId:'mengjin-school-courtyard'}),
  Object.freeze({id:'mengjin-river-gate', x:0.5930, y:0.5660,
    label:'孟津河门', ariaLabel:'进入孟津玉匠铺·第一场',
    locationId:'mengjin-jade-courtyard'}),
]);

// 陶寺旧学舍的交互点为初版定位，后续可按高清陶寺小地图微调。
const TAOSI_SPOTS = Object.freeze([
  Object.freeze({id:'taosi-old-academy-dot',x:0.540,y:0.590,
    label:'陶寺·器派旧学舍',ariaLabel:'进入陶寺旧学舍·子时算稿前三页',
    locationId:'taosi-old-academy'}),
]);
// 嫣沩水畔：同一个光点，第四页完成后自动切换夜景。
// atlas 仍采用已有 guirui 内部地区 ID，避免破坏地图历史路由。
const YANWEI_SPOTS = Object.freeze([
  Object.freeze({id:'yanwei-workshop-dot',x:0.302,y:0.695,
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

// The world atlas contains 27 clickable cities, not merely the first ten.
// These additional cities are for *map viewing only*: no invented quest spot
// or NPC is added before the corresponding story/location is authored.
const EXTRA_REGION_ARTWORK = Object.freeze([
  [11,'mingtiao','鸣条'],
  [12,'bo','亳'],
  [13,'yanshishangcheng','偃师商城'],
  [14,'sibei','寺北'],
  [15,'yin','殷'],
  [16,'qiangfang','羌方'],
  [17,'chaoge','朝歌'],
  [18,'qizhou','岐周'],
  [19,'fenghao','丰镐'],
  [20,'muye','牧野'],
  [21,'luoyi','洛邑'],
  [22,'jin','晋'],
  [23,'qufu','曲阜'],
  [24,'linzi','临淄'],
  [25,'yi','彘'],
  [26,'taiyuan','太原'],
  [27,'lishan','骊山'],
]);

export function candidateRegionMapPaths(number,slug,hanzi) {
  const prefix=String(number).padStart(2,'0');
  const folder='/assets/scenes/chapter1-maps/';
  // New and historical names commonly found inside the project's assets dir.
  // Probe only on first visit; known maps 01–10 never need probing.
  return Object.freeze([
    `${folder}${prefix}-${slug}.webp`,
    `${folder}${prefix}-${slug}.png`,
    `${folder}${prefix}_${slug}.webp`,
    `${folder}${prefix}_${slug}.png`,
    `${folder}${prefix}_${hanzi}.webp`,
    `${folder}${prefix}_${hanzi}.png`,
    `${folder}${prefix}-${hanzi}.png`,
    `${folder}${prefix}-${hanzi}.webp`,
    `/assets/scenes/maps/${prefix}-${slug}.webp`,
    `/assets/maps/chapter1/${prefix}-${slug}.webp`,
    `/assets/maps/${prefix}-${slug}.png`,
    `/assets/scenes/${prefix}_${hanzi}.png`,
  ]);
}

export const EXTRA_CHAPTER_ONE_REGIONS = Object.freeze(EXTRA_REGION_ARTWORK.map(
  ([number,id,title])=>Object.freeze({
    id,title,number,act:null,width:2047,height:1152,hotspots:EMPTY_SPOTS,
    imageUrl:candidateRegionMapPaths(number,id,title)[0],
    imageCandidates:candidateRegionMapPaths(number,id,title),
  })
));
export const ALL_CHAPTER_ONE_REGIONS = Object.freeze([
  ...CHAPTER_ONE_REGIONS, ...EXTRA_CHAPTER_ONE_REGIONS,
]);
const BY_ID = new Map(ALL_CHAPTER_ONE_REGIONS.map(region=>[region.id,region]));

export function getChapterOneRegion(regionId) {
  return BY_ID.get(regionId) || null;
}

const artworkCache = new Map();
function browserImageAvailable(url) {
  return new Promise(resolve=>{
    if(typeof Image === 'undefined') {resolve(null);return;}
    const img=new Image();
    let settled=false;
    const done=payload=>{if(settled)return;settled=true;resolve(payload);};
    img.onload=()=>done(img.naturalWidth&&img.naturalHeight
      ? {url,width:img.naturalWidth,height:img.naturalHeight}:null);
    img.onerror=()=>done(null);
    img.src=url;
  });
}

/**
 * Resolve only files actually deployed on the current site's /assets path.
 * Never pretend a city has a scene when a known filename yields a 404.
 * @param {object} region
 * @param {function} probe Injected by tests; returns {url,width,height} or null.
 */
export async function resolveChapterOneRegionArtwork(region,probe=browserImageAvailable) {
  if (!region) return null;
  if (!region.imageCandidates?.length) return region; // ten verified images
  if (artworkCache.has(region.id)) return artworkCache.get(region.id);
  for (const url of region.imageCandidates) {
    const image = await probe(url);
    if (image?.width > 0 && image?.height > 0) {
      const result={...region,imageUrl:url,width:image.width,height:image.height};
      artworkCache.set(region.id,result);
      return result;
    }
  }
  return null; // missing files get a visible explanation in app.js
}
