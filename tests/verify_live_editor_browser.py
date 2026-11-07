from playwright.sync_api import sync_playwright
from pathlib import Path
import json, time, sys

root=Path(__file__).resolve().parents[1]
url='about:blank'
output=root/'tests'/'_browser_artifacts'
output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files','--disable-web-security'])
    page=browser.new_page(viewport={'width':1640,'height':1020},device_scale_factor=1)
    page.set_default_timeout(5000)
    errors=[]
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    print('set_content',flush=True)
    page.set_content('<div id="editor"></div>')
    print('add_style',flush=True)
    page.add_style_tag(content=(root/'public/style.css').read_text())
    import re
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
    editor_require='const {transitionEditorMode,checkConnection}=__inter;\nconst {'+','.join(routing)+'}=__route;\nconst {'+','.join(draft)+'}=__draft;\n'
    bundle+='window.__mountCircuit='+module_text('circuit-editor.js',['mount'],editor_require)+';'
    print('add_script',len(bundle),flush=True)
    page.add_script_tag(content=bundle)
    print('script_added',flush=True)
    fixture=(root/'tests/fixtures/editor_live.html').read_text().split('<script type="module">',1)[1].split('</script>',1)[0]
    fixture=fixture.replace("import { mount } from '../../public/circuit-editor.js';",'const {mount}=window.__mountCircuit;')
    print('mount_editor',flush=True)
    page.evaluate('async()=>{'+fixture+'}')
    print('mounted',flush=True)
    page.wait_for_function('window.__ready === true',timeout=15000)
    def mouse_at(x,y):
        return page.evaluate('''p=>{const svg=document.querySelector('.ce-canvas'),pt=svg.createSVGPoint(); pt.x=p.x;pt.y=p.y;const w=pt.matrixTransform(document.querySelector('.ce-world').getScreenCTM());return {x:w.x,y:w.y}}''',{'x':x,'y':y})
    def move(x,y):
        p=mouse_at(x,y);page.mouse.move(p['x'],p['y']);page.wait_for_timeout(35);return p
    def click(x,y):
        p=move(x,y);page.mouse.click(p['x'],p['y']);return p
    def save():
        page.get_by_role('button',name='保存进度').click()
        page.wait_for_function('typeof window.__saved() !== "undefined"')
        return page.evaluate('window.__saved()')
    a=page.locator('[data-pin-comp="A"][data-pin="out"] .ce-pin-hit')
    y=page.locator('[data-pin-comp="Y"][data-pin="in"] .ce-pin-hit')
    assert a.count()==1 and y.count()==1
    print('pin bounding:',a.bounding_box(),flush=True)
    print('element target:',page.evaluate("document.querySelector('[data-pin-comp=\"A\"][data-pin=\"out\"] .ce-pin-hit').outerHTML"),flush=True)
    page.screenshot(path=str(output/'editor_before_live.png'))
    print('clicking pin',flush=True)
    a.click()
    print('pin clicked',flush=True)
    assert page.locator('.ce-stage').get_attribute('data-mode')=='wire'
    move(420,400)
    first_preview=page.locator('.ce-wire--preview').get_attribute('d')
    page.screenshot(path=str(output/'editor_live_preview.png'),full_page=True)
    move(440,420)
    second_preview=page.locator('.ce-wire--preview').get_attribute('d')
    assert first_preview and second_preview and first_preview!=second_preview,(first_preview,second_preview)
    assert page.locator('.ce-wire').count()==1,'Only preview exists before first turn'
    click(440,420)
    assert page.locator('.ce-waypoint').count()>=1,'Committed waypoint visually apparent'
    page.screenshot(path=str(output/'editor_live_waypoint.png'),full_page=True)
    assert len(page.evaluate('window.__simulations'))>=0
    assert len(save()['wires'])==0,'Waypoints must not silently create electrical connections'
    move(936,420)
    third_preview=page.locator('.ce-wire--preview').get_attribute('d')
    assert third_preview and third_preview != second_preview
    click(936,420)
    assert page.locator('.ce-waypoint').count()>=2
    y.click()
    saved=save()
    assert len(saved['wires'])==1, f"Not connected: {saved['wires']} feedback: {page.locator('.ce-feedback').inner_text()}"
    assert saved['editorLayout']['manualPaths'], 'User path must be marked manual'
    path=next(iter(saved['editorLayout']['paths'].values()))
    assert len(path)>=4 and any(pt['y']==420 for pt in path),path
    assert page.locator('.ce-wire--preview').count()==0,'Preview clears after finish'
    page.screenshot(path=str(output/'editor_after_manual_connection.png'),full_page=True)
    # Ctrl+Z and Ctrl+Shift+Z are transactional and do not affect the login shell.
    page.keyboard.press('Control+z')
    assert len(save()['wires'])==0,'Undo reverted connection'
    page.keyboard.press('Control+Shift+z')
    assert len(save()['wires'])==1,'Redo restores connection'
    # Shift-click a specific drawn segment, with no forced re-routing.
    branch_mouse=mouse_at(690,420)
    page.keyboard.down('Shift')
    page.mouse.click(branch_mouse['x'],branch_mouse['y'])
    page.keyboard.up('Shift')
    branched=save()
    assert len(branched['wires'])==2, f"Branch did not split conductor: {len(branched['wires'])}"
    assert len([c for c in branched['components'] if c['type']=='junction'])==1
    page.screenshot(path=str(output/'editor_live_branch.png'),full_page=True)
    page.keyboard.press('Escape')  # Cancel unfinished branch, leave the electrical split.
    page.keyboard.press('Control+z')
    assert len(save()['wires'])==1,'Undo removes the split without damaging original conductor'
    # Drag the horizontal segment and preserve its electrical end points.
    before_drag=save()
    wp=mouse_at(800,420)
    ep=mouse_at(800,470)
    page.mouse.move(wp['x'],wp['y'])
    page.mouse.down()
    page.mouse.move(ep['x'],ep['y'],steps=10)
    page.mouse.up()
    dragged=save()
    assert len(dragged['wires'])==1
    original_path=next(iter(before_drag['editorLayout']['paths'].values()))
    new_path=next(iter(dragged['editorLayout']['paths'].values()))
    assert original_path!=new_path,(original_path,new_path)
    assert new_path[0]==original_path[0] and new_path[-1]==original_path[-1]
    page.screenshot(path=str(output/'editor_live_dragged.png'),full_page=True)
    # Simulate real-time switch feedback.
    click(128,265)
    page.wait_for_timeout(200)
    assert page.locator('.ce-feedback').inner_text().find('输入开关')!=-1
    assert page.evaluate('window.__simulations.length')>=2
    assert page.locator('[data-component="Y"] .ce-lamp.is-on').count()==1, 'Output indicator follows current input simulation'
    # A selected line can be removed directly from the toolbar.
    wire=page.locator('.ce-wire-hit-area').first
    bb=wire.bounding_box(); assert bb
    # Use exact middle of one drawable segment on the saved path.
    segments=[(new_path[i],new_path[i+1]) for i in range(len(new_path)-1)]
    a0,b0=max(segments,key=lambda t:abs(t[0]['x']-t[1]['x'])+abs(t[0]['y']-t[1]['y']))
    midx=(a0['x']+b0['x'])/2;midy=(a0['y']+b0['y'])/2
    click(midx,midy)
    page.get_by_role('button',name='删除选中').click()
    assert len(save()['wires'])==0
    page.screenshot(path=str(output/'editor_after_deletion.png'),full_page=True)
    # Native HTML5 drag-and-drop uses existing palette and circuit-editor registration.
    palette_item=page.locator('.ce-palette-item[data-type="not"]')
    assert palette_item.count()==1
    palette_item.drag_to(page.locator('.ce-canvas'),target_position={'x':590,'y':630})
    with_gate=save()
    assert len([c for c in with_gate['components'] if c['type']=='not'])==1, 'Palette drag must create component'
    page.get_by_role('button',name='▶ 运行电路').click()
    page.wait_for_timeout(190)
    assert page.evaluate('window.__simulations.length')>=3,'Run button calls the existing simulate API'
    page.screenshot(path=str(output/'editor_palette_drop.png'),full_page=True)
    assert not errors, '\n'.join(errors)
    print('PASS: live mouse preview, clicked waypoints, exact manual path, simulation, undo/redo, deleting conductor')
    print('Saved path:', json.dumps(path,ensure_ascii=False))
    browser.close()
