import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {getChapterOneRegion} from '../public/chapter-one-region-maps.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const start = app.indexOf('function showMap() {');
const end = app.indexOf('function chapterState(', start);
assert.ok(start >= 0 && end > start, 'must find actual showMap source');
const source = app.slice(start, end);

const mounted = [], navigations = [];
const sites = [
  {id:'mengjin',label:'一·孟津',x:.56,y:.84},
  {id:'taosi',label:'二·陶寺',x:.53,y:.44},
  {id:'linzi',label:'二十四·临淄',x:.92,y:.43},
];
const context = {
  WORLD_MAP_SITES: sites,
  getChapterOneRegion,
  WORLD_MAP_IMAGE_SIZE: {width:2816,height:1584},
  WORLD_MAP_DRAG_BOUNDS: {x:384,y:216,width:2048,height:1152},
  WORLD_MAP_INITIAL_FOCUS: {x:.62,y:.56},
  worldMapTransformOrigin: site => `${site.x*100}% ${site.y*100}%`,
  mountMapScene: options => mounted.push(options),
  showHome() {},
  showChapterMap: (id, region) => navigations.push([id,region]),
  cloudDescend: (action, options) => {
    assert.ok(options.exit.origin, 'transition keeps point-specific focus');
    action();
  },
  document: {
    querySelector() { return null; },
    querySelectorAll() { return []; },
  },
  el() { throw new Error('world map must not create a bottom-right notice'); },
};
vm.runInNewContext(source + '\nglobalThis.mountWorld=showMap;', context);
context.mountWorld();
assert.equal(mounted.length, 1);
assert.equal(mounted[0].source, '/assets/scenes/world-map-grand.png');
assert.deepEqual(mounted[0].markers.map(item=>item.id), sites.map(item=>item.id));

function trigger() {
  const classes = new Set();
  const listeners = new Map();
  let blurs = 0;
  return {
    classList:{
      contains(name) {return classes.has(name);},
      add(name) {classes.add(name);},
      remove(name) {classes.delete(name);},
    },
    addEventListener(type,fn) {listeners.set(type,fn);},
    removeEventListener(type,fn) {
      if(listeners.get(type) === fn) listeners.delete(type);
    },
    dispatch(type) {listeners.get(type)?.();},
    blur() {blurs++;},
    get blurs() {return blurs;},
  };
}

// Two implemented region MAPS are navigable; only their story spots wait.
const taosi = mounted[0].markers.find(site=>site.id==='taosi');
taosi.onActivate(trigger());
const mengjin = mounted[0].markers.find(site=>site.id==='mengjin');
mengjin.onActivate(trigger());
assert.deepEqual(navigations,[['ch1','taosi'],['ch1','mengjin']]);

// Unregistered sites still release hover and have no invented destination.
const edge = mounted[0].markers.find(site=>site.id==='linzi');
const clicked = trigger();
edge.onActivate(clicked);
assert.equal(clicked.classList.contains('is-hover-suppressed'), true);
assert.equal(clicked.blurs,1, 'unfinished click should release keyboard focus');
assert.equal(navigations.length,2);
clicked.dispatch('pointerleave');
assert.equal(clicked.classList.contains('is-hover-suppressed'), false);
edge.onActivate(clicked);
assert.equal(clicked.classList.contains('is-hover-suppressed'), true);
clicked.dispatch('focus');
assert.equal(clicked.classList.contains('is-hover-suppressed'), false,
  'keyboard focus restores visible focus affordance');

const dotStart = css.indexOf('#app.page--map.map--world .scene-gate--world-location .scene-gate__dot,');
const dotEnd = css.indexOf('#app.page--map .scene-gate:hover:not(:disabled),',dotStart);
const mapRules = css.slice(dotStart,dotEnd);
assert.match(mapRules,/border:3px solid transparent;/);
assert.doesNotMatch(mapRules,/scene-gate__dot::before/,'no fourth ring');
assert.doesNotMatch(mapRules,/is-active/,'no persistent selection state');
assert.doesNotMatch(mapRules,/\\.map-scene-note/,'no right-hand overlay');
assert.doesNotMatch(app,/map-scene-note/,'the unused note DOM must be gone');
assert.match(mapRules, /255,\s*223,\s*112/,'brighter gold outer border');
assert.doesNotMatch(mapRules,/\\.scene-gate__dot::after[^}]*:hover/);
console.log('World map markers PASS: ten registered region maps navigate, unregistered sites reset, no popup or persistent marker ring.');
