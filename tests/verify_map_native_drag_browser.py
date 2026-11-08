#!/usr/bin/env python3
"""Adversarial Chromium test with real ZSHXJ map artwork and full production CSS.

Run from the repository root:
    python tests/verify_map_native_drag_browser.py

Requirements: playwright + Chromium. The repository's CSS and real world-map
image are loaded directly; no server, login or network is necessary.
"""
import base64
import shutil
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "public/map-viewport.js").read_bytes()
CSS = (ROOT / "public/style.css").read_text(encoding="utf-8")
IMAGE = (ROOT / "public/assets/scenes/world-map-grand.png").read_bytes()
MODULE_URL = "data:text/javascript;base64," + base64.b64encode(SCRIPT).decode("ascii")
IMAGE_URL = "data:image/png;base64," + base64.b64encode(IMAGE).decode("ascii")

HTML_TEMPLATE = r"""
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>__STYLE__</style></head><body>
<div id="app" class="page page--map map--world">
  <header class="room-topbar">
    <button class="room-brand" type="button">铸算 · 华夏纪</button>
    <strong>大地图</strong>
  </header>
</div>
<script type="module">
import {createPannableMap} from "__MODULE__";
window.__counts={dragstart:0,pointercancel:0,pointerdown:0,lostcapture:0};
window.__dragReports=[];
for(const type of ["dragstart","pointercancel","pointerdown","lostpointercapture"]){
  document.addEventListener(type,e=>{
    if(type==="dragstart"){
      window.__counts.dragstart++;
      window.__dragReports.push({
        target:e.target?.className,
        transfer:[...(e.dataTransfer?.types||[])],
      });
    }
    else if(type==="pointercancel")window.__counts.pointercancel++;
    else if(type==="pointerdown")window.__counts.pointerdown++;
    else window.__counts.lostcapture++;
  },true);
}
window.__activations=0;
window.__map=createPannableMap({
 host:document.getElementById("app"),
 imageUrl:"__IMAGE__",width:2048,height:1152,alt:"大地图",
 focus:{x:.7,y:.568},
 markers:[{
   label:"进入地图",className:"scene-gate--world-entry",
   x:.806,y:.568,onActivate:()=>window.__activations++,
 }],
});
window.__ready=true;
</script></body></html>
"""
HTML = (HTML_TEMPLATE.replace("__STYLE__", CSS)
                     .replace("__MODULE__", MODULE_URL)
                     .replace("__IMAGE__", IMAGE_URL))


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def run():
    with sync_playwright() as playwright:
        launch = {"headless": True,
                  "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        chromium = shutil.which("chromium") or shutil.which("chromium-browser")
        if chromium:
            launch["executable_path"] = chromium
        browser = playwright.chromium.launch(**launch)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.set_content(HTML, wait_until="load", timeout=35000)
        page.wait_for_function("window.__ready === true", timeout=20000)
        page.wait_for_timeout(200)

        def camera():
            return page.locator(".map-camera-scene").evaluate("""el => {
              const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);
              return {x:m.m41,y:m.m42};
            }""")

        def drag(dx,dy,start=(460,440),steps=5):
            sx,sy=start
            page.mouse.move(sx,sy)
            page.mouse.down()
            page.mouse.move(sx+dx,sy+dy,steps=steps)
            page.mouse.up()
            return camera()

        # The decisive root-cause protections must actually be active.
        selection_style=page.locator(".map-viewport").evaluate(
            "el => getComputedStyle(el).userSelect")
        require(selection_style=="none",
            "The map allows native DOM text selection again")

        # The FIRST drag was fine in the broken version. Repeating identical
        # starts is crucial: browser native dragstart used to appear on drag 2.
        accepted=0
        for i in range(80):
            before=camera()
            dx=100 if i%2==0 else -100
            dy=55 if i%2==0 else -55
            after=drag(dx,dy)
            moved_x=after["x"]-before["x"]
            moved_y=after["y"]-before["y"]
            require(abs(moved_x-dx)<1.5 and abs(moved_y-dy)<1.5,
                f"Drag {i+1} was hijacked or clipped: moved "
                f"{moved_x:.2f}/{moved_y:.2f}, wanted {dx}/{dy}")
            accepted+=1
            if i%15==0:
                page.wait_for_timeout(60)

        counts=page.evaluate("window.__counts")
        require(counts["dragstart"]==0,
            f"Native HTML drag hijacked the map: {counts}")
        require(counts["pointercancel"]==0,
            f"Unexpected pointercancel after repeated drag: {counts}")
        print(f"PASS: {accepted}/80 full-distance real mouse drags; "
              "0 native dragstart, 0 pointercancel")

        # A normal click on a landmark is still an activation, but moving the
        # pointer from that same landmark must instead move the map.
        gate=page.locator(".scene-gate")
        gate.click()
        require(page.evaluate("window.__activations")==1,
                "Normal landmark click no longer works")
        box=gate.bounding_box()
        require(box is not None,"Landmark is not visible")
        mid=(box["x"]+box["width"]/2,box["y"]+box["height"]/2)
        before=camera()
        after=drag(-60,-30,mid)
        require(after!=before,"Dragging from a map landmark does not move")
        require(page.evaluate("window.__activations")==1,
                "Landmark was accidentally clicked by a map drag")

        # Saturating the boundary must not create a sticky dead zone in the
        # SAME gesture; reversing by one pixel must immediately move back.
        page.mouse.move(280,320)
        page.mouse.down()
        page.mouse.move(1100,750,steps=5)
        at_edge=camera()
        page.mouse.move(1099,749)
        reversed_one_pixel=camera()
        page.mouse.up()
        require(reversed_one_pixel["x"]<at_edge["x"]
                and reversed_one_pixel["y"]<at_edge["y"],
                "Map did not reverse immediately after reaching its edge")
        resumed=drag(-50,-35)
        require(resumed["x"]<reversed_one_pixel["x"]
                and resumed["y"]<reversed_one_pixel["y"],
                "New gesture stuck after a boundary collision")
        print("PASS: same-gesture one-pixel reversal and next-gesture recovery")

        # A selection can be created programmatically (or by another script).
        # The map must still reject native HTML5 drag on its scene.
        cancelled=page.locator(".map-camera-scene").evaluate("""scene => {
          const event=new DragEvent("dragstart",{
            bubbles:true,cancelable:true,dataTransfer:new DataTransfer()
          });
          return !scene.dispatchEvent(event);
        }""")
        require(cancelled,"A native dragstart was not prevented")

        # Browser removes pointer capture unexpectedly.
        page.mouse.move(340,350)
        page.mouse.down()
        page.mouse.move(370,365,steps=3)
        pointer=page.evaluate("""() =>
          document.querySelector(".map-viewport").hasPointerCapture(1)
        """)
        if pointer:
            page.evaluate("""() =>
              document.querySelector(".map-viewport").releasePointerCapture(1)
            """)
        page.mouse.up()
        before=camera()
        after=drag(-48,-25)
        require(after!=before,"Could not recover after lost pointer capture")

        # Blur, visibility and mouseup outside the viewport.
        page.mouse.move(350,350)
        page.mouse.down()
        page.mouse.move(390,380)
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        page.mouse.up()
        before=camera()
        require(drag(-45,-25)!=before,"Could not recover after window blur")

        page.mouse.move(350,350)
        page.mouse.down()
        page.mouse.move(1600,970,steps=5)
        page.mouse.up()
        before=camera()
        require(drag(-35,-24)!=before,"Could not recover after outside release")

        # Artificially lose pointerup, then start a fresh physical gesture.
        page.mouse.move(350,350)
        page.mouse.down()
        page.mouse.move(385,377)
        page.evaluate("""() => {
          document.querySelector(".map-viewport")
            .dispatchEvent(new PointerEvent("pointercancel",{
              bubbles:true,pointerId:1
            }));
        }""")
        page.mouse.up()
        before=camera()
        require(drag(-31,-17)!=before,"Could not recover after pointercancel")

        require(not errors,"Browser exceptions: "+" | ".join(errors))
        page.evaluate("window.__map.dispose()")
        browser.close()
        print("PASS: landmark hit targets, forced native dragstart rejection,")
        print("lost capture, blur, outside release, pointercancel, no JS errors")


if __name__ == "__main__":
    run()
