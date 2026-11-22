/**
 * Chapter map uses the same dot artwork as the world map without rendering
 * text on the small map. Mengjin now exposes two approved hotspots.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createPannableMap} from '../public/map-viewport.js';

const app = fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css = fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const from = app.indexOf("function showChapterMap(chapterId, regionId = 'mengjin') {");
const to = app.indexOf('async function showRoom(', from);
assert.ok(from >= 0 && to > from, 'must extract the actual region route');

const openedRooms = [], renders = [];
const chapter = {id:'ch1', title:'第一章', order:1,implemented:true, canEnter:true, locations:[{id:'gate-road',name:'玉匠铺'}]};
const context = {
  requireChapter:id=>{assert.equal(id,'ch1');return chapter;},
  getChapterOneRegion:id=>({
    id,title:'孟津',imageUrl:'/assets/scenes/chapter1-maps/01-mengjin.webp',width:2047,height:1152,
    hotspots:[
      {id:'mengjin-inner-court',x:0.3522,y:0.4274,label:'孟津内城',ariaLabel:'孟津内城剧情入口'},
      {id:'mengjin-river-gate',x:0.5420,y:0.5399,label:'孟津河门',ariaLabel:'孟津河门剧情入口'},
    ],
  }),
  mountMapScene:opts=>renders.push(opts),
  showRoom:(chapterId,locationId)=>openedRooms.push([chapterId,locationId]),
  showMap:()=>{},
  cloudDescend:(callback,options)=>{assert.ok(options.enter, 'existing chapter/room cloud transition remains');return callback();},
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  page(){throw Error('should render the existing region, not empty state');},
};
vm.runInNewContext(app.slice(from,to)+'\nglobalThis.enterChapter=showChapterMap;',context);
context.enterChapter('ch1');
assert.equal(renders.length,1);
const scene=renders[0];
assert.equal(scene.source,'/assets/scenes/chapter1-maps/01-mengjin.webp');
assert.equal(scene.regionName,'孟津');
assert.equal(scene.width,2047);
assert.equal(scene.height,1152);
assert.equal(scene.markers.length,2,'Mengjin should show the two approved dots');
assert.equal(scene.temporarySample,null);
scene.markers[0].onActivate();
assert.deepEqual(openedRooms,[['ch1','gate-road']]);

class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.style={};this.className='';this.children=[];this.attributes={};this.dataset={};this.listeners={};this.clientWidth=1440;this.clientHeight=900;this.classList={add(){},remove(){}};}
  setAttribute(k,v){this.attributes[k]=v;}
  append(...children){this.children.push(...children);}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(x=>x!==fn);}
  focus(){}
  setPointerCapture(){}
  hasPointerCapture(){return false;}
}

globalThis.document={createElement:tag=>new Element(tag),activeElement:null,addEventListener(){},removeEventListener(){}};
globalThis.window={innerWidth:1440,innerHeight:900,addEventListener(){},removeEventListener(){}};
globalThis.requestAnimationFrame=()=>1;
globalThis.cancelAnimationFrame=()=>{};

const host=new Element('main');
const map=createPannableMap({host,imageUrl:scene.source,width:scene.width,height:scene.height,focus:scene.focus,markers:scene.markers});
const viewport=host.children[0];
const cameraScene=viewport.children[0];
assert.equal(cameraScene.children.length,3,'Image plus two buttons');
assert.equal(cameraScene.children[0].tagName,'IMG');
assert.equal(cameraScene.children[1].tagName,'BUTTON');
assert.equal(cameraScene.children[2].tagName,'BUTTON');
assert.equal(cameraScene.children[1].children.length,1,'button contains only the dot');
assert.equal(cameraScene.children[1].children[0].className,'scene-gate__dot');
map.dispose();

assert.match(css,/#app\.page--map\.map--chapter \.scene-gate--chapter-entry \{[\s\S]*?min-width:44px;/);
assert.match(css,/#app\.page--map\.map--chapter \.scene-gate--chapter-entry \.scene-gate__dot \{/);
assert.match(css,/background-color:rgba\(174,117,58,\.97\)/,'mid-ring gains a softer golden tone');
assert.match(css,/background-color:rgba\(166,73,35,\.98\)/,'red center is slightly brighter');
assert.match(css,/border-color:rgb\(255,223,112\)/,'outer ring remains bright gold');
assert.doesNotMatch(css,/scene-gate__dot::before/,'do not draw a fourth ring');

console.log('Chapter map PASS: Mengjin renders two approved dot-only hotspots, both using the existing marker artwork.');
