"""Chromium regression: long overshoot snaps cleanly and no left-bottom toast.

Uses local JS/CSS without assets, server, accounts or network calls.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]

def inline_module(filename,exports,requires=''):
    source=(root/'public'/filename).read_text(encoding='utf8')
    source=re.sub(r'^import .*?;\n','',source,flags=re.M)
    source=re.sub(r'^export ','',source,flags=re.M)
    return '(()=>{\n'+requires+source+'\nreturn {'+','.join(exports)+'};\n})()'

routing=['routeOrthogonal','compactPath','pointsToPath','pathIsOrthogonal',
         'projectToPath','splitPathAt','shiftSegment','reanchorPath',
         'pathHitsObstacles','occupiedSegments','unrelatedOverlap',
         'collinearOverlap','electricalJunctionPoints','firstSharedTerminalOverlap']
drafting=['liveDraftPath','commitDraftWaypoint','assessDraftPath','alignFixedWaypoints']
interactions=['transitionEditorMode','checkConnection']
js='const __route='+inline_module('circuit-routing.js',routing)+';\n'
js+='const __draft='+inline_module('circuit-drafting.js',drafting,
       'const {compactPath,pathIsOrthogonal,pathHitsObstacles}=__route;\n')+';\n'
js+='const __interaction='+inline_module('circuit-interactions.js',interactions)+';\n'
requires=('const {transitionEditorMode,checkConnection}=__interaction;\nconst {'
     +','.join(routing)+'}=__route;\nconst {'+','.join(drafting)+'}=__draft;\n')
js+='window.__mountCircuit='+inline_module('circuit-editor.js',['mount'],requires)+';'

fixture=(root/'tests/fixtures/editor_live.html').read_text(encoding='utf8').split('<script type="module">',1)[1].split('</script>',1)[0]
fixture=fixture.replace("import { mount } from '../../public/circuit-editor.js';",'const {mount}=window.__mountCircuit;')
fixture=fixture.replace("document.getElementById('editor')","document.getElementById('app')")
fixture=fixture.replace("{id:'Y',type:'output',name:'Y',x:1100,y:210}",
                        "{id:'Y',type:'output',name:'Y',x:1100,y:350}")
assert "x:1100,y:350" in fixture

with sync_playwright() as driver:
    browser=driver.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage','--disable-web-security'])
    page=browser.new_page(viewport={'width':1680,'height':970},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<div id="app" class="circuit-level-page"><header class="page-title"><a class="brand-link">铸算·华夏纪</a></header></div>')
    page.add_style_tag(content=(root/'public/style.css').read_text(encoding='utf8'))
    page.add_style_tag(content=(root/'public/circuit-desktop.css').read_text(encoding='utf8'))
    page.add_script_tag(content=js)
    page.add_script_tag(content=(root/'public/circuit-desktop.js').read_text(encoding='utf8'))
    page.evaluate('async()=>{'+fixture+'}')
    page.wait_for_function('window.__ready && document.querySelector("#app.ce-desktop-v2")')
    assert page.locator('.ce-v2-toast').count()==0
    assert page.locator('.ce-v2-status-sr-only').count()==1
    assert page.locator('.ce-v2-warn-dock').count()==1
    assert page.evaluate("getComputedStyle(document.querySelector('.ce-v2-status-sr-only')).clipPath")=='inset(50%)'
    def mouse_at(x,y):
        return page.evaluate('''p=>{const pt=document.querySelector('.ce-canvas').createSVGPoint();
          pt.x=p.x;pt.y=p.y;const v=pt.matrixTransform(document.querySelector('.ce-world').getScreenCTM());
          return {x:v.x,y:v.y};}''',{'x':x,'y':y})
    def click(x,y):
        p=mouse_at(x,y)
        page.mouse.click(p['x'],p['y'])
    source=page.locator('[data-pin-comp="A"][data-pin="out"] .ce-pin-hit')
    sink=page.locator('[data-pin-comp="Y"][data-pin="in"] .ce-pin-hit')
    source.click()
    assert page.locator('.ce-stage').get_attribute('data-mode')=='wire'
    click(444,600)  # way below output Y's pin at y=388
    assert page.locator('.ce-waypoint').count()>=1
    sink.hover()
    page.wait_for_timeout(100)
    preview=page.locator('.ce-wire--preview')
    assert preview.count()==1,'Only one corrected preview path may be drawn'
    assert page.locator('.ce-wire--fixed').count()==0
    d=preview.get_attribute('d')
    assert ' 600' not in d,d
    assert '444 388' in d,d
    assert page.locator('.ce-waypoint').evaluate_all('(nodes)=>nodes.every(n=>Number(n.getAttribute("y"))<550)')
    sink.click()
    assert page.locator('.ce-wire--preview').count()==0
    assert page.locator('.ce-stage').get_attribute('data-mode')!='wire'
    page.get_by_role('button',name='保存',exact=True).click()
    saved=page.evaluate('window.__saved()')
    assert len(saved['wires'])==1,saved
    path=next(iter(saved['editorLayout']['paths'].values()))
    assert path==[{'x':208,'y':248},{'x':444,'y':248},
                  {'x':444,'y':388},{'x':1100,'y':388}],path
    # Erasing the visual overshoot does NOT alter endpoint topology.
    assert saved['wires'][0]['from']=={'comp':'A','pin':'out'},saved['wires']
    assert saved['wires'][0]['to']=={'comp':'Y','pin':'in'},saved['wires']
    assert page.locator('.ce-v2-toast').count()==0
    assert not errors,errors
    print('PASS: 212-unit backtrack removed during preview AND save; visible toast absent; electrical topology unchanged')
    browser.close()
