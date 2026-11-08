#!/usr/bin/env python3
"""Real-browser regression for circuit-editor right-click menus.

Run from repository root:
    python tests/verify_context_menu_browser.py

Requires Playwright with Chromium. All scripts and CSS are embedded from local
repository files, so no web server/login/network is necessary.
"""
from __future__ import annotations
import base64
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/"public"

def as_module(text):
    return "data:text/javascript;base64,"+base64.b64encode(text.encode("utf-8")).decode("ascii")

routing=as_module((PUBLIC/"circuit-routing.js").read_text(encoding="utf-8"))
interaction=as_module((PUBLIC/"circuit-interactions.js").read_text(encoding="utf-8"))
drafting=(PUBLIC/"circuit-drafting.js").read_text(encoding="utf-8")
drafting=drafting.replace("'./circuit-routing.js'","'"+routing+"'")
drafting=as_module(drafting)
editor=(PUBLIC/"circuit-editor.js").read_text(encoding="utf-8")
for name,url in [
    ("circuit-routing.js",routing),
    ("circuit-interactions.js",interaction),
    ("circuit-drafting.js",drafting),
]:
    editor=editor.replace('"./'+name+'"','"'+url+'"')
editor=as_module(editor)
css=(PUBLIC/"style.css").read_text(encoding="utf-8")
html=r"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>__CSS__</style>
<style>
  body{margin:0;padding:8px}
  #test-page{width:100%;max-width:1520px;margin:auto}
  #editor{width:100%;min-height:850px}
  /* The isolated fixture does not have the game's full-height page shell. */
  #editor .ce-layout{min-height:690px !important;height:690px !important}
  #editor .ce-stage{min-height:690px !important}
  #editor .ce-canvas-wrap{min-height:620px !important;height:620px !important}
  #editor .ce-canvas{min-height:620px !important;height:100% !important}
</style>
</head><body><div class="circuit-level-page" id="test-page">
<div id="editor"></div></div>
<script type="module">
import {mount} from "__EDITOR__";
const shape=(name,ins,outs)=>({name,family:'gate',pins:[
  ...ins.map(n=>({name:n,direction:'in',width:1})),
  ...outs.map(n=>({name:n,direction:'out',width:1})),
]});
const types={
  input:shape('输入',[],['out']),
  output:shape('输出',['in'],[]),
  and:shape('与门',['in1','in2'],['out']),
  junction:shape('接点',['a','b','c','d'],['out']),
};
const initial={schemaVersion:1,components:[
  {id:'A',type:'input',name:'A',x:80,y:210},
  {id:'G',type:'and',x:510,y:230},
  {id:'Y',type:'output',name:'Y',x:1110,y:230}
],wires:[
  {from:{comp:'A',pin:'out'},to:{comp:'G',pin:'in1'}},
  {from:{comp:'G',pin:'out'},to:{comp:'Y',pin:'in'}}
]};
const state={circuitLevels:{demo:{levelVersion:1,graph:initial}}};
const level={id:'demo',title:'右键菜单验收',layer:'gate',levelVersion:1,
  interface:{inputs:[{name:'A'}],outputs:[{name:'Y'}]},
  allowedTypes:Object.keys(types),allowedPackages:[],initialGraph:initial};
window.__lastSaved=null;
window.__editor=await mount({
  container:document.getElementById('editor'),
  chapter:{title:'数字电路'},level,state,
  signal:new AbortController().signal,
  api:async(method,path,payload)=>{
    if(path==='/api/circuit/components')return {types,packages:[]};
    if(path==='/api/circuit/results/mine')return {results:[]};
    if(path.endsWith('/simulate'))return {pins:{},outputs:{Y:0},state:{},warnings:[]};
    throw new Error('Unexpected API '+path);
  },
  saveProgress:async next=>{window.__lastSaved=structuredClone(next.circuitLevels.demo.graph);},
  exit:async()=>{}
});
window.__ready=true;
</script></body></html>
""".replace("__EDITOR__",editor).replace("__CSS__",css)

def check(ok,message):
    if not ok: raise AssertionError(message)

def run():
    with sync_playwright() as p:
        args={"headless":True,"args":["--no-sandbox","--disable-dev-shm-usage"]}
        chromium=shutil.which("chromium") or shutil.which("chromium-browser")
        if chromium:args["executable_path"]=chromium
        browser=p.chromium.launch(**args)
        page=browser.new_page(viewport={"width":1640,"height":1060},device_scale_factor=1)
        errors=[]
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.set_content(html,wait_until="load",timeout=30000)
        page.wait_for_function("window.__ready===true",timeout=15000)
        menu=page.locator(".ce-context-menu")
        action=lambda name:page.locator(f'.ce-context-menu [data-context-action="{name}"]')

        def save():
            page.get_by_role("button",name="保存进度").click()
            return page.evaluate("window.__lastSaved")

        def component(id):
            return page.locator(f'.ce-components [data-component="{id}"]').first

        def right_component(id):
            component(id).click(button="right",position={"x":20,"y":20})
            check(menu.count()==1,f"Component {id}: missing context menu")

        def right_wire(index=0):
            coords=page.evaluate("""index=>{
              const path=document.querySelector(
                `.ce-wire-hit-area[data-wire="${index}"]`);
              const distance=path.getTotalLength();
              const p=path.getPointAtLength(distance*.5);
              const xy=new DOMPoint(p.x,p.y).matrixTransform(path.getScreenCTM());
              return {clientX:xy.x,clientY:xy.y,worldX:p.x,worldY:p.y};
            }""",index)
            page.mouse.click(coords["clientX"],coords["clientY"],button="right")
            check(menu.count()==1,f"Wire {index}: missing context menu")
            return coords

        original=save()
        right_component("G")
        check(menu.get_attribute("role")=="menu","Missing menu accessibility role")
        check(action("rotate").count()==1 and action("delete").count()==1,
              "Component right-click actions incorrect")
        check(save()["wires"]==original["wires"],
              "Opening menu mutated electrical wires")
        # Saving clicks outside the popup by design; reopen to execute action.
        right_component("G")
        action("rotate").click()
        rotated=save()
        check(menu.count()==0,"Menu not closed after rotate")
        check(next(c for c in rotated["components"] if c["id"]=="G")["rotation"]==90,
              "Rotate action failed")
        check(rotated["wires"]==original["wires"],"Rotate changed electrical graph")
        page.get_by_role("button",name="↶ 撤销").click()
        restored=save()
        check(next(c for c in restored["components"] if c["id"]=="G").get("rotation",0)==0,
              "Undo did not restore component rotation")
        print("PASS: component menu, rotate, preserved electrical wires, undo")

        # A right-click on an individual pin must select its component.
        pin=page.locator('[data-pin-comp="G"][data-pin="in1"]')
        pin.click(button="right")
        check(action("rotate").count()==1 and action("junction").count()==0,
              "Pin's context menu must belong to its component")
        page.keyboard.press("Escape")
        check(menu.count()==0,"Escape did not dismiss context menu")

        # A wire is selected by its actual visible SVG line at the click point.
        graph_before=save()
        coords=right_wire(0)
        check(action("junction").count()==1 and action("delete").count()==1,
              "Wire context menu is incorrect")
        check(save()["components"]==graph_before["components"],
              "Wire context menu created a premature junction")
        coords=right_wire(0)
        action("junction").click()
        after=save()
        junctions=[c for c in after["components"] if c["type"]=="junction"]
        check(len(junctions)==1,"No electrical junction was created")
        # Playwright mouse coordinates are rounded to integral CSS pixels
        # by Chromium. At a 0.63 screen-to-world scale, one pixel is ~1.6
        # circuit units; verify within one physical click pixel.
        click_px=page.locator(".ce-world").evaluate(
            "el=>1/Math.hypot(el.getScreenCTM().a,el.getScreenCTM().b)")
        tolerance=max(2.0,click_px+0.05)
        check(abs(junctions[0]["x"]+14-coords["worldX"])<tolerance,
              "Junction X differs from the originally right-clicked wire point")
        check(abs(junctions[0]["y"]+14-coords["worldY"])<tolerance,
              "Junction Y differs from the originally right-clicked wire point")
        check(len(after["wires"])==len(graph_before["wires"])+1,
              "Branch should split one wire into two")
        print("PASS: wire menu, junction exactly at original right-click position")

        # Branch tool enters wire-drafting mode. Right click now cancels it.
        component("G").click(button="right")
        check(menu.count()==0,"Right-click while drafting must cancel, not open menu")
        page.get_by_role("button",name="↶ 撤销").click()
        check(save()["wires"]==graph_before["wires"],"Undo did not restore wire")

        right_wire(0)
        action("delete").click()
        after_delete=save()
        check(len(after_delete["wires"])==len(graph_before["wires"])-1,
              "Delete wire did not update electrical topology")
        page.get_by_role("button",name="↶ 撤销").click()
        check(save()["wires"]==graph_before["wires"],"Undo wire delete failed")

        right_component("G")
        action("delete").click()
        deleted=save()
        check(not any(c["id"]=="G" for c in deleted["components"]),
              "Component still exists after right-click delete")
        check(all(w["from"]["comp"]!="G" and w["to"]["comp"]!="G"
                  for w in deleted["wires"]),
              "Deleting component left attached wires")
        page.get_by_role("button",name="↶ 撤销").click()
        check(save()["wires"]==graph_before["wires"],"Undo component deletion failed")
        print("PASS: wire deletion, component deletion, all undo flows")

        # At different editor zoom levels, menu buttons stay screen-sized.
        right_component("G")
        normal_size=action("rotate").bounding_box()["height"]
        page.keyboard.press("Escape")
        for _ in range(4):
            page.get_by_role("button",name="−",exact=True).click()
        right_component("G")
        scaled_size=action("rotate").bounding_box()["height"]
        check(abs(normal_size-scaled_size)<2,
              "Context menu incorrectly scales with the SVG circuit")
        page.keyboard.press("Escape")

        # Wire snapping and menu coordinates must also work on a zoomed
        # circuit, where mouse pixels cover more world-coordinate units.
        scaled_before=save()
        scaled_click=right_wire(0)
        action("junction").click()
        scaled_after=save()
        scaled_junction=[c for c in scaled_after["components"] if c["type"]=="junction"]
        check(len(scaled_junction)==1,
              "Right-click wire insertion failed after zooming out")
        world_per_px=page.locator(".ce-world").evaluate(
            "el=>1/Math.hypot(el.getScreenCTM().a,el.getScreenCTM().b)")
        check(abs(scaled_junction[0]["x"]+14-scaled_click["worldX"])<world_per_px+0.1,
              "Zoomed junction X does not match clicked wire")
        check(abs(scaled_junction[0]["y"]+14-scaled_click["worldY"])<world_per_px+0.1,
              "Zoomed junction Y does not match clicked wire")
        page.get_by_role("button",name="↶ 撤销").click()
        check(save()["wires"]==scaled_before["wires"],
              "Undo after zoomed junction did not restore the original graph")
        print("PASS: pixel-aware wire context operations at reduced zoom")

        # A synthetically targeted context event at the lower-right edge
        # verifies clamping without moving the real circuit component.
        bounds=page.locator(".ce-canvas-wrap").bounding_box()
        component("G").evaluate("""(el,rect)=>{
          el.dispatchEvent(new MouseEvent('contextmenu',{
            bubbles:true,cancelable:true,button:2,
            clientX:rect.x+rect.width-2,clientY:rect.y+rect.height-2
          }));
        }""",bounds)
        menu_box=menu.bounding_box()
        check(menu_box["x"]+menu_box["width"]<=bounds["x"]+bounds["width"]+1,
              "Menu escapes right side of the canvas")
        check(menu_box["y"]+menu_box["height"]<=bounds["y"]+bounds["height"]+1,
              "Menu escapes bottom side of the canvas")
        page.keyboard.press("Escape")
        check(menu.count()==0,"Menu doesn't close after edge-placement Escape")

        check(not errors,"Browser errors: "+" | ".join(errors))
        page.evaluate("window.__editor.dispose()")
        browser.close()
        print("PASS: pin priority, zoom-independent menu, edge avoidance, Escape,")
        print("      actual Chromium right-clicks and no browser exceptions")

if __name__=="__main__":
    run()
