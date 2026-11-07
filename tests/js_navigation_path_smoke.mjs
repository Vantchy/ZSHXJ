/* The same complete path model drives both maps and rooms. */
import assert from "node:assert/strict";
import {getNavigationPath, mountNavigationPath} from "../public/navigation-path.js";

class Stub {
  constructor(tag) {this.tagName=tag.toUpperCase();this.children=[];this.handlers={};this.attributes={};this.textContent="";}
  append(...children){for (const c of children) {c.parentNode=this;this.children.push(c);}}
  setAttribute(name,value){this.attributes[name]=String(value);}
  addEventListener(name,handler){(this.handlers[name]??=[]).push(handler);}
}
globalThis.document={createElement:(tag)=>new Stub(tag)};
const stages=[["world","大地图"],["chapter","大地图›小地图"],["room","大地图›小地图›房间"]];
for (const [stage, expected] of stages) {
  const breadcrumb=getNavigationPath(stage);
  assert.equal(breadcrumb.map(x=>x.label).join("›"),expected);
  const host=new Stub("header");
  const clicks=[];
  const nav=mountNavigationPath(host,stage,(key)=>clicks.push(key));
  assert.equal(nav.tagName,"NAV");
  assert.equal(nav.attributes["aria-label"],"地图导航路径");
  assert.equal(nav.children.filter(x=>x.tagName==="BUTTON").length,breadcrumb.length-1);
  assert.equal(nav.children.at(-1).attributes["aria-current"],"page");
  for (const item of nav.children.filter(x=>x.tagName==="BUTTON")) {
    await item.handlers.click[0]();
  }
  assert.deepEqual(clicks,breadcrumb.slice(0,-1).map(x=>x.key));
}
assert.throws(()=>getNavigationPath("invalid"),TypeError);
console.log("Shared navigation path smoke: all stages, previous-route actions, current marker PASS.");
