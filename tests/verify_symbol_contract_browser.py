"""Standalone visual/geometry test for the native schematic symbol catalog."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
output=root/'tests'/'_browser_artifacts'
output.mkdir(parents=True,exist_ok=True)
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
fixture=(root/'tests/fixtures/editor_live.html').read_text().split('<script type="module">',1)[1].split('</script>',1)[0].replace("import { mount } from '../../public/circuit-editor.js';",'const {mount}=window.__mountCircuit;')
types_code="""const types={
 input:shape('数字输入',[],['out']),output:shape('数字灯',['in'],[]),
 vdd:shape('电源',[],['out']),gnd:shape('接地',[],['out']),
 not:shape('非门',['in'],['out']),nand:shape('与非门',['in1','in2'],['out']),
 nor:shape('或非门',['in1','in2'],['out']),and:shape('与门',['in1','in2'],['out']),
 or:shape('或门',['in1','in2'],['out']),xor:shape('异或门',['in1','in2'],['out']),
 xnor:shape('同或门',['in1','in2'],['out']),
 nmos:shape('NMOS',['gate','source'],['drain']),
 pmos:shape('PMOS',['gate','source'],['drain']),
 mux2:shape('二选一选择器',['a','b','sel'],['out']),
 sr_latch:shape('SR锁存器',['s','r'],['q','qbar']),
 dff:shape('D触发器',['d','clk'],['q','qbar']),
 junction:shape('接点',['a','b','c','d'],['out'])
};"""
family=['input','output','vdd','gnd','not','nand','nor','and','or','xor','xnor','nmos','pmos','mux2','sr_latch','dff','junction']
components='const components=['+','.join(
    "{id:'"+('A' if typ=='input' else 'Y' if typ=='output' else 'C'+str(i))+
    "',type:'"+typ+"',"+("name:'A'," if typ=='input' else "name:'Y'," if typ=='output' else '')+
    'x:'+str(70+(i%4)*340)+',y:'+str(75+(i//4)*168)+'}'
    for i,typ in enumerate(family))+'];'
fixture=re.sub(r'const types=.*?;\nconst components=',types_code+'\nconst components=',fixture,flags=re.S)
fixture=re.sub(r'const components=.*?;\nconst original=',components+'\nconst original=',fixture,flags=re.S)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-web-security'])
    page=browser.new_page(viewport={'width':1620,'height':950})
    page.set_default_timeout(5500)
    print('catalog page opened',flush=True)
    page.set_content('<div id="app" class="page page--level circuit-level-page"><h2 class="page-title">标准元件 · 引脚测试</h2><div id="editor"></div></div>')
    page.add_style_tag(content=(root/'public/style.css').read_text())
    print('catalog style ready',flush=True)
    page.add_script_tag(content=bundle)
    print('catalog script ready',flush=True)
    print('catalog mounting',len(fixture),flush=True)
    page.evaluate('async()=>{'+fixture+'}')
    print('catalog mounted',flush=True)
    page.wait_for_function('window.__ready === true')
    print('catalog testing pin positions',flush=True)
    failures=page.evaluate('''()=>{
      const failures=[];
      for(const c of document.querySelectorAll('.ce-component')){
        if(c.dataset.component==='C16')continue;
        const dots=[...c.querySelectorAll('.ce-symbol-terminal')];
        const pins=[...c.querySelectorAll('.ce-pin-dot')];
        if(dots.length!==pins.length){failures.push([c.dataset.component,'number',dots.length,pins.length]);continue;}
        const at=(el)=>{const p=el.ownerSVGElement.createSVGPoint();p.x=Number(el.getAttribute('cx'));p.y=Number(el.getAttribute('cy'));return p.matrixTransform(el.getScreenCTM());};
        for(const pin of pins){const p=at(pin),dist=Math.min(...dots.map(d=>{const q=at(d);return Math.hypot(q.x-p.x,q.y-p.y)}));
          if(dist>1.1)failures.push([c.dataset.component,'position',dist]);}
      }return failures;
    }''')
    assert not failures,failures
    print('catalog screenshot',flush=True)
    page.screenshot(path=str(output/'editor_symbol_catalog.png'))
    print('catalog screenshot done',flush=True)
    # Rotate the MOSFET to verify that an actual pin stays at the drawn wire end.
    page.locator('[data-component="C11"] .ce-component-hit').click()
    page.keyboard.press('r')
    rotated=page.evaluate('''()=>{const c=document.querySelector('[data-component="C11"]');
      const dots=[...c.querySelectorAll('.ce-symbol-terminal')],pins=[...c.querySelectorAll('.ce-pin-dot')];
      const at=el=>{const p=el.ownerSVGElement.createSVGPoint();p.x=+el.getAttribute('cx');p.y=+el.getAttribute('cy');return p.matrixTransform(el.getScreenCTM());};
      return pins.map(pin=>{const p=at(pin);return Math.min(...dots.map(d=>{const q=at(d);return Math.hypot(q.x-p.x,q.y-p.y)}));});}''')
    assert rotated and max(rotated)<1.1,rotated
    print('PASS: 16 standard symbol types drawn with electrically aligned visible endpoints; MOSFET rotation preserves alignment')
    browser.close()
