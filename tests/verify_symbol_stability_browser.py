"""Chromium QA: viewport-stable editor, library symbols, and direct digit switch.
Uses the same isolated fixture API as verify_live_editor_browser.py.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re

root = Path(__file__).resolve().parents[1]
output=root/'tests'/'_browser_artifacts'
output.mkdir(exist_ok=True,parents=True)

def module_text(filename,exports,requires=''):
    src=(root/'public'/filename).read_text()
    src=re.sub(r'^import .*?;\n','',src,flags=re.M)
    src=re.sub(r'^export ','',src,flags=re.M)
    return '(()=>{\n'+requires+src+'\nreturn {'+','.join(exports)+'};\n})()'

routing=['routeOrthogonal','compactPath','pointsToPath','pathIsOrthogonal','projectToPath','splitPathAt','shiftSegment','reanchorPath','pathHitsObstacles','occupiedSegments','unrelatedOverlap']
interactions=['transitionEditorMode','checkConnection']
draft=['liveDraftPath','commitDraftWaypoint','assessDraftPath']
bundle='const __route='+module_text('circuit-routing.js',routing)+';\n'
bundle+='const __inter='+module_text('circuit-interactions.js',interactions)+';\n'
bundle+='const __draft='+module_text('circuit-drafting.js',draft,'const {compactPath,pathIsOrthogonal,pathHitsObstacles}=__route;\n')+';\n'
requires='const {transitionEditorMode,checkConnection}=__inter;\nconst {'+','.join(routing)+'}=__route;\nconst {'+','.join(draft)+'}=__draft;\n'
bundle+='window.__mountCircuit='+module_text('circuit-editor.js',['mount'],requires)+';'

fixture=(root/'tests/fixtures/editor_live.html').read_text().split('<script type="module">',1)[1].split('</script>',1)[0]
fixture=fixture.replace("import { mount } from '../../public/circuit-editor.js';",'const {mount}=window.__mountCircuit;')

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-web-security'])
    for width,height in [(1600,900),(1080,720)]:
        page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_default_timeout(8000)
        page.set_content('<div id="app" class="page page--level circuit-level-page"><h2 class="page-title">正式电路 · 编辑器</h2><div id="editor"></div></div>')
        page.add_style_tag(content=(root/'public/style.css').read_text())
        page.add_script_tag(content=bundle)
        page.evaluate('async()=>{'+fixture+'}')
        page.wait_for_function('window.__ready === true')
        page.wait_for_timeout(200)
        def metrics():
            return page.evaluate('''()=>{const el=document.querySelector('.ce-canvas-wrap'),body=document.body;
              const box=el.getBoundingClientRect();return {top:box.top,left:box.left,width:box.width,height:box.height,
              scroll:window.scrollY,bodyHeight:body.scrollHeight,viewport:window.innerHeight}}''')
        before=metrics()
        assert before['height']>250,before
        assert abs(before['bodyHeight']-before['viewport']) <= 2, before
        # Real click on rendered input digit, with no inspector interaction.
        display=page.locator('[data-component="A"] .ce-digit')
        assert display.text_content()=='0'
        display.click()
        page.wait_for_timeout(180)
        assert display.text_content()=='1'
        assert page.evaluate('window.__simulations.at(-1).inputs.A')==1
        assert page.locator('.ce-stage').get_attribute('data-mode') != 'wire'
        page.screenshot(path=str(output/f'editor_stable_symbols_{width}.png'))
        # Increasing inspector warnings + changing status must not move the canvas.
        page.evaluate('''()=>{
          const warnings=document.querySelector('.ce-warnings');
          for(let i=0;i<28;i++){
            const p=document.createElement('p');p.className='ce-warning';
            p.textContent='模拟提示 '+(i+1)+'：该输入端存在尚未连接的信号。';warnings.append(p);
          }
          document.querySelector('.ce-feedback').textContent='状态更新 '.repeat(65);
        }''')
        page.wait_for_timeout(120)
        after=metrics()
        assert abs(after['top']-before['top'])<=1.5,(width,before,after)
        assert abs(after['height']-before['height'])<=1.5,(width,before,after)
        assert abs(after['scroll']-before['scroll'])<=1.5,(width,before,after)
        assert abs(after['bodyHeight']-after['viewport'])<=2,(width,before,after)
        # Grading results also must not push the drawing area down.
        page.evaluate('''()=>{const r=document.querySelector('.ce-result');r.hidden=false;
        for(let i=0;i<20;i++){const x=document.createElement('p');x.textContent='评分结果 '+i;r.append(x)}}''')
        page.wait_for_timeout(50)
        after_grading=metrics()
        assert abs(after_grading['top']-before['top'])<=1.5,(width,before,after_grading)
        assert abs(after_grading['height']-before['height'])<=1.5,(width,before,after_grading)
        assert not errors,errors
        print(f'PASS {width}x{height}: canvas stable with 28 extra warnings, long status, grading overlay; 0->1 direct click')
        page.close()
    browser.close()
