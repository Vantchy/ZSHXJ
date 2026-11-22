/**
 * Regression for the V12 user report "河门光点无法点击":
 * server may still hold a chapter registry from before V12 even when the
 * browser has the updated world/region maps. Verify click, cache refresh,
 * retry, diagnostic, and actual map button wiring without touching grades.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {getChapterOneRegion} from '../public/chapter-one-region-maps.js';
import {createPannableMap} from '../public/map-viewport.js';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const begin=app.indexOf("function showChapterMap(chapterId, regionId = 'mengjin') {");
const end=app.indexOf('async function showRoom(',begin);
assert.ok(begin>=0 && end>begin);
const source=app.slice(begin,end)+'\nglobalThis.showRegion=showChapterMap;';

const student={id:'ch1',order:1,implemented:true,canEnter:true,
  locations:[{id:'gate-road',name:'旧样张'}]};
const withPreview={...student,locations:[...student.locations,
  {id:'mengjin-jade-courtyard',name:'孟津玉匠铺',roomType:'story-preview'}]};
const session={token:'student',generation:12};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function startScene({chapter=withPreview,refresh=()=>{throw Error('No refresh expected');},
    stillOnView=()=>true}={}) {
  let current=chapter;
  const mounts=[],opened=[],errors=[],transitions=[];
  let loads=0;
  const context={
    viewGeneration:3,
    getChapterOneRegion,
    getAuthSnapshot:()=>session,
    stillOnView,
    requireChapter:id=>{assert.equal(id,'ch1');return current;},
    loadGame:async()=>{loads++;await refresh(next=>{current=next;});},
    showError:error=>{errors.push(error.message||String(error));},
    mountMapScene:options=>mounts.push(options),
    cloudDescend:(action,options)=>{
      transitions.push(options);
      return action();
    },
    showRoom:(chapterId,locationId)=>opened.push({chapterId,locationId}),
    showMap(){},
    document:{querySelector(){return null;},querySelectorAll(){return []; }},
    page(){throw Error('Registered map must not render a placeholder');},
    el(){throw Error('No empty placeholder');},
    button(){throw Error('No placeholder button');},
    root:{},
  };
  vm.runInNewContext(source,context);
  context.showRegion('ch1','mengjin');
  const rendered=mounts.at(-1);
  assert.equal(rendered.markers.length,2);
  const inner=rendered.markers.find(p=>p.id==='mengjin-inner-court');
  const river=rendered.markers.find(p=>p.id==='mengjin-river-gate');
  assert.equal(river.ariaLabel,'进入孟津玉匠铺·第一场');
  return {inner,river,context,mounts,opened,errors,transitions,
    get loads(){return loads;},setCurrent:next=>{current=next;}};
}

// Fresh V12 server: native map button click opens the CORRECT room.
{
  const s=startScene();
  let blurCount=0;
  await s.inner.onActivate({blur(){blurCount++;}});
  assert.equal(blurCount,1,'Unimplemented school is inert but releases focus');
  assert.equal(s.opened.length,0);
  assert.equal(s.loads,0);

  // Real map-viewport.createPannableMap makes each hotspot an actual BUTTON;
  // dispatching its native click handler must trigger the routed entry.
  class Element {
    constructor(tag){this.tagName=tag.toUpperCase();this.style={};this.dataset={};
      this.children=[];this.attributes={};this.listeners={};this.className='';
      this.clientWidth=1440;this.clientHeight=900;
      this.classList={add(){},remove(){}};}
    setAttribute(k,v){this.attributes[k]=v;}
    append(...children){this.children.push(...children);}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(x=>x!==fn);}
    focus(){} setPointerCapture(){} hasPointerCapture(){return false;}
  }
  const oldDoc=globalThis.document,oldWindow=globalThis.window;
  globalThis.document={createElement:tag=>new Element(tag),activeElement:null,addEventListener(){},removeEventListener(){}};
  globalThis.window={innerWidth:1440,innerHeight:900,addEventListener(){},removeEventListener(){}};
  globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  try {
    const host=new Element('main');
    const map=createPannableMap({host,imageUrl:s.mounts[0].source,
      width:s.mounts[0].width,height:s.mounts[0].height,
      focus:s.mounts[0].focus,markers:s.mounts[0].markers});
    const cameraScene=host.children[0].children[0];
    const button=cameraScene.children.find(n=>n.dataset?.markerId==='mengjin-river-gate');
    assert.ok(button&&button.tagName==='BUTTON');
    assert.equal(button.attributes['aria-label'],'进入孟津玉匠铺·第一场');
    assert.equal(button.children.length,1,'dot-only, no text');
    button.listeners.click[0]();
    await tick();
    assert.deepEqual(s.opened,[{chapterId:'ch1',locationId:'mengjin-jade-courtyard'}]);
    assert.equal(s.transitions.length,1);
    assert.deepEqual(s.errors,[]);
    map.dispose();
  } finally {globalThis.document=oldDoc;globalThis.window=oldWindow;}
}

// An already updated backend but an old browser chapter cache: clicking
// once reloads authoritative data, then opens the authored room.
{
  const s=startScene({chapter:student,refresh:async set=>set(withPreview)});
  await s.river.onActivate();
  assert.equal(s.loads,1);
  assert.deepEqual(s.opened,[{chapterId:'ch1',locationId:'mengjin-jade-courtyard'}]);
  assert.deepEqual(s.errors,[]);
}

// Old Python process still serves the pre-V12 chapter registry: never fake
// an unregistered room, but provide a clear and retryable restart instruction.
{
  const s=startScene({chapter:student,refresh:async()=>{}});
  await s.river.onActivate();
  assert.equal(s.loads,1);
  assert.equal(s.opened.length,0);
  assert.equal(s.errors.length,1);
  assert.match(s.errors[0],/重启 Python 服务/);
  s.setCurrent(withPreview);
  await s.river.onActivate();
  assert.equal(s.loads,1,'Retry with updated chapter cache requires no extra GET');
  assert.deepEqual(s.opened,[{chapterId:'ch1',locationId:'mengjin-jade-courtyard'}]);
}

// No second GET or transition while a first refresh is still pending.
{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const s=startScene({chapter:student,refresh:async set=>{await pending;set(withPreview);}});
  const first=s.river.onActivate();
  const second=s.river.onActivate();
  assert.equal(s.loads,1);
  assert.equal(s.opened.length,0);
  release();
  await Promise.all([first,second]);
  assert.equal(s.opened.length,1);
}

// Navigation/account changes invalidate a delayed chapter refresh.
{
  const s=startScene({chapter:student,refresh:async set=>set(withPreview),
    stillOnView:()=>false});
  await s.river.onActivate();
  assert.equal(s.opened.length,0);
  assert.deepEqual(s.errors,[]);
}

const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
assert.match(css,/#app\.page--map\.map--chapter \.scene-gate--chapter-entry \{[\s\S]*?width:64px;/);
assert.match(css,/\.scene-gate--chapter-entry \.scene-gate__dot \{[\s\S]*?width:26px;/);
assert.doesNotMatch(css,/scene-gate__dot::before/,'No fourth ring can appear');
console.log('River gate click PASS: real map button, stale chapter refresh, explicit stale-server error, retry, concurrency, session guard and invisible hit target.');
