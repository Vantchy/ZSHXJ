"""Real Chromium validation of auto-joined shared terminal and unconnected X.

No backend, login, assets or external resources are required. Tests BOTH the
saved electrical graph and the actual SVG dots, not just geometry helpers.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]

def inline_module(filename,exports,requires=''):
    source=(ROOT/'public'/filename).read_text(encoding='utf-8')
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
requires=('const {transitionEditorMode,checkConnection}=__interaction;\nconst {'+
          ','.join(routing)+'}=__route;\nconst {'+','.join(drafting)+'}=__draft;\n')
js+='window.__mountCircuit='+inline_module('circuit-editor.js',['mount'],requires)+';'
fixture=(ROOT/'tests/fixtures/editor_live.html').read_text(encoding='utf-8').split('<script type="module">',1)[1].split('</script>',1)[0]
fixture=fixture.replace("import { mount } from '../../public/circuit-editor.js';",'const {mount}=window.__mountCircuit;')

def new_page(browser):
    page=browser.new_page(viewport={'width':1660,'height':950})
    page.set_default_timeout(7000)
    errors=[]
    page.on('pageerror',lambda err: errors.append(str(err)))
    page.set_content('<div id="editor"></div>')
    page.add_style_tag(content=(ROOT/'public/style.css').read_text(encoding='utf-8'))
    page.add_script_tag(content=js)
    return page,errors

def save(page):
    page.get_by_role('button',name='保存进度').click()
    page.wait_for_function('window.__saved()!==undefined')
    return page.evaluate('window.__saved()')

def pt_eq(a,b):
    return abs(a['x']-b['x'])<0.1 and abs(a['y']-b['y'])<0.1

def case_merge(browser):
    code=re.sub(r'const components=.*?;\nconst original=',
       "const components=[{id:'A',type:'input',name:'A',x:80,y:210},"
       "{id:'B',type:'input',name:'B',x:80,y:350},"
       "{id:'C',type:'input',name:'C',x:80,y:430},"
       "{id:'Y',type:'output',name:'Y',x:1100,y:210}];\nconst original=",
       fixture,flags=re.S)
    page,errors=new_page(browser)
    page.evaluate('async()=>{'+code+'}')
    page.wait_for_function('window.__ready===true')
    page.locator('[data-pin-comp="A"][data-pin="out"] .ce-pin-hit').click()
    page.locator('[data-pin-comp="Y"][data-pin="in"] .ce-pin-hit').click()
    first=save(page)
    assert len(first['wires'])==1,first
    # B's path ascends to y=248 then shares A->Y's horizontal tail.
    page.locator('[data-pin-comp="B"][data-pin="out"] .ce-pin-hit').click()
    page.locator('[data-pin-comp="Y"][data-pin="in"] .ce-pin-hit').hover()
    page.wait_for_timeout(120)
    assert page.locator('.ce-electrical-junction--preview').count()==1, 'Live preview must show the proposed tap'
    preview=page.locator('.ce-wire--preview').get_attribute('d')
    assert preview and preview.endswith('232 248'),preview
    assert '1100 248' not in preview,preview
    page.locator('[data-pin-comp="Y"][data-pin="in"] .ce-pin-hit').click()
    final=save(page)
    joints=[c for c in final['components'] if c['type']=='junction']
    assert len(joints)==1,final
    joint=joints[0]
    assert abs(joint['x']+14-232)<0.1 and abs(joint['y']+14-248)<0.1, joint
    assert len(final['wires'])==3,final
    assert sum(w['from']['comp']==joint['id'] or w['to']['comp']==joint['id'] for w in final['wires'])==3
    path_by_key=final['editorLayout']['paths']
    bpath=next(path for k,path in path_by_key.items() if 'B:out' in k)
    assert pt_eq(bpath[0],{'x':208,'y':388}),bpath
    assert pt_eq(bpath[-1],{'x':232,'y':248}),bpath
    assert all(not (pt['x']==1100 and pt['y']==248) for pt in bpath),bpath
    assert page.locator('[data-component="'+joint['id']+'"] .ce-junction-dot').count()==1, (
      'Three electrical conductors must show exactly one solid dot at the tap')
    assert page.locator('.ce-electrical-junction--preview').count()==0
    # Undo returns to one original wire and removes the electrical junction.
    page.keyboard.press('Control+z')
    undo=save(page)
    assert len(undo['wires'])==1 and not any(c['type']=='junction' for c in undo['components']),undo
    page.keyboard.press('Control+Shift+z')
    redo=save(page)
    assert len(redo['wires'])==3 and any(c['type']=='junction' for c in redo['components']),redo
    # A third wire should attach to the SAME existing junction rather than
    # stacking a duplicate node. Its approach should avoid B's vertical leg.
    page.locator('[data-pin-comp="C"][data-pin="out"] .ce-pin-hit').click()
    page.locator('[data-pin-comp="Y"][data-pin="in"] .ce-pin-hit').hover()
    page.wait_for_timeout(130)
    assert page.locator('.ce-electrical-junction--preview').count()==1
    page.locator('[data-pin-comp="Y"][data-pin="in"] .ce-pin-hit').click()
    reused=save(page)
    assert len(reused['wires'])==4,reused
    assert len([c for c in reused['components'] if c['type']=='junction'])==1, reused
    cpath=next(path for k,path in reused['editorLayout']['paths'].items() if 'C:out' in k)
    assert pt_eq(cpath[-1],{'x':232,'y':248}),cpath
    # A vertical stretch coincident with B->J (x=232, y=248..388) should
    # be avoided in favour of a short, safe final approach.
    def overlaps_bad_vertical(points):
        return any(abs(a['x']-232)<0.1 and abs(b['x']-232)<0.1 and
            min(a['y'],b['y'])<388 and max(a['y'],b['y'])>248 for a,b in zip(points,points[1:]))
    assert not overlaps_bad_vertical(cpath),cpath
    assert page.locator('.ce-components .ce-junction-dot').count()==1
    assert not errors,errors
    page.close()
    print('PASS: common destination -> first shared section becomes real T junction; preview, save, Undo/Redo')
    print('PASS: third fan-in reuses existing junction and routes around unrelated overlapping branch')

def case_cross(browser):
    comp="const components=[{id:'A',type:'input',name:'A',x:80,y:210},"
    comp+="{id:'Y',type:'output',name:'Y',x:1100,y:210},"
    comp+="{id:'C',type:'input',name:'C',x:360,y:20},"
    comp+="{id:'D',type:'output',name:'D',x:1070,y:550}];"
    original="""const original={schemaVersion:1,components,wires:[
      {from:{comp:'A',pin:'out'},to:{comp:'Y',pin:'in'}},
      {from:{comp:'C',pin:'out'},to:{comp:'D',pin:'in'}}
    ],editorLayout:{version:1,paths:{
      'A:out|Y:in':[{x:208,y:248},{x:1100,y:248}],
      'C:out|D:in':[{x:488,y:58},{x:700,y:58},{x:700,y:588},{x:1070,y:588}]
    },manualPaths:{'A:out|Y:in':true,'C:out|D:in':true}}};"""
    code=re.sub(r'const components=.*?;\nconst original=.*?;\nconst state=',
                comp+'\n'+original+'\nconst state=',fixture,flags=re.S)
    page,errors=new_page(browser)
    page.evaluate('async()=>{'+code+'}')
    page.wait_for_function('window.__ready===true')
    assert page.locator('.ce-wire-hit-area').count()==2
    paths=page.locator('.ce-wires .ce-wire').evaluate_all('(els)=>els.map(e=>e.getAttribute("d"))')
    assert 'M 208 248 L 1100 248' in paths,paths
    assert 'M 488 58 L 700 58 L 700 588 L 1070 588' in paths,paths
    assert page.locator('.ce-components .ce-junction-dot').count()==0
    assert page.locator('.ce-electrical-junction').count()==0, (
      'A geometric cross at (700,248) between two unrelated nets cannot gain a dot')
    graph=save(page)
    assert len(graph['wires'])==2 and all(c['type']!='junction' for c in graph['components'])
    assert not errors,errors
    page.close()
    print('PASS: unrelated horizontal/vertical paths really cross at (700,248), no dot and unchanged independent graph')

def case_shared_device_pin(browser):
    # Old save files may have two distinct routes to the SAME physical pin,
    # without an explicit junction component. This is still an electrical tie.
    comp="const components=[{id:'A',type:'input',name:'A',x:80,y:210},"
    comp+="{id:'B',type:'input',name:'B',x:80,y:350},"
    comp+="{id:'Y',type:'output',name:'Y',x:1100,y:210}];"
    original="""const original={schemaVersion:1,components,wires:[
      {from:{comp:'A',pin:'out'},to:{comp:'Y',pin:'in'}},
      {from:{comp:'B',pin:'out'},to:{comp:'Y',pin:'in'}}
    ],editorLayout:{version:1,paths:{
      'A:out|Y:in':[{x:208,y:248},{x:1100,y:248}],
      'B:out|Y:in':[{x:208,y:388},{x:960,y:388},{x:960,y:248},{x:1100,y:248}]
    },manualPaths:{'A:out|Y:in':true,'B:out|Y:in':true}}};"""
    code=re.sub(r'const components=.*?;\nconst original=.*?;\nconst state=',
                comp+'\n'+original+'\nconst state=',fixture,flags=re.S)
    page,errors=new_page(browser)
    page.evaluate('async()=>{'+code+'}')
    page.wait_for_function('window.__ready===true')
    dots=page.locator('.ce-components .ce-electrical-junction')
    assert dots.count()==1, 'Multiple wires to the same pin need one dot, even without a junction component'
    assert dots.get_attribute('data-electrical-node')=='Y:in'
    assert abs(float(dots.get_attribute('cx'))-1100)<0.01
    assert abs(float(dots.get_attribute('cy'))-248)<0.01
    graph=save(page)
    assert len(graph['wires'])==2 and not any(c['type']=='junction' for c in graph['components'])
    assert not errors,errors
    page.close()
    print('PASS: existing save with two wires to same device terminal shows exactly one electrical junction dot')

if __name__=='__main__':
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
          args=['--no-sandbox','--disable-dev-shm-usage'])
        try:
            case_merge(browser)
            case_cross(browser)
            case_shared_device_pin(browser)
        finally:
            browser.close()
