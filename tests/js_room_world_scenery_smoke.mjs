/* Background selection must follow the reorganized assets/scenes URLs. */
import assert from "node:assert/strict";
import { createRoomWorld } from "../public/room-world.js";

class Element {
  constructor(tag) {
    this.tagName=tag.toUpperCase();
    this.children=[];
    this.handlers={};
    this.style={setProperty() {}};
    this.clientWidth=960;
    this.clientHeight=640;
  }
  append(child) {this.children.push(child);}
  setAttribute() {}
  addEventListener(event,handler) {(this.handlers[event]??=[]).push(handler);}
  removeEventListener(event,handler) {
    this.handlers[event]=(this.handlers[event]||[]).filter(x=>x!==handler);
  }
}
globalThis.document={createElement:tag=>new Element(tag)};
globalThis.window={addEventListener() {},removeEventListener() {}};
globalThis.ResizeObserver=class {observe() {} disconnect() {}};

const backgrounds=[
  "/assets/scenes/workshop-background.png",
];
for (const background of backgrounds) {
  const stage=new Element("main");
  const world=createRoomWorld({stage,background,npcName:"工匠",getPlayerX:()=>500,onNpcClick:()=>{}});
  const picture=stage.children[0].children[0];
  assert.equal(picture.src,background,"Known location should use its own scenery");
  assert.equal(world.toWorld(100,{left:0}),world.toWorld(100,{left:0}));
  world.dispose();
}
const stage=new Element("main");
const invalid=createRoomWorld({stage,background:"/scenes/room-lane.png",
  npcName:"工匠",getPlayerX:()=>500,onNpcClick:()=>{}});
assert.equal(stage.children[0].children[0].src,backgrounds[0],
  "Invalid legacy path falls back to the documented default");
invalid.dispose();
console.log("Room world scenery smoke: active test map + legacy fallback PASS.");
