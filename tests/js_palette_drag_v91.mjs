/** Offline regression: the published Yin levels must expose real editor types.
 * Includes the previously working majority gate and the failing mux2 gate.
 * The browser interaction regression is run separately in Playwright.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const palette = new Set([
  'input','output','vdd','gnd','junction','nmos','pmos','not',
  'nand','nor','and','or','xor','xnor','mux2','sr_latch','dff',
]);
const levels = [
  'majority','mux2','mux4','halfadder','fulladder','ripple4','cla4','eightbit',
];
let items = 0;
for (const part of levels) {
  const level = JSON.parse(fs.readFileSync(path.join(root,'levels',`ch1_yin_${part}_v1.json`),'utf8'));
  assert.equal(level.id,`ch1_yin_${part}`);
  assert.equal(level.layer,'gate');
  assert.equal(level.initialGraph.wires.length,0);
  assert.equal(new Set(level.allowedTypes).size,level.allowedTypes.length,'duplicate allowed type');
  for (const type of level.allowedTypes) {
    assert(palette.has(type), `${level.id} has unrecognized builtin ${type}`);
    items++;
  }
  for (const code of level.allowedPackages || []) {
    assert(/^[a-z][a-z0-9_]+$/.test(code), `invalid package symbol ${code}`);
  }
  for (const component of level.initialGraph.components) {
    assert(level.allowedTypes.includes(component.type), `initial ${component.type} not allowed in ${level.id}`);
  }
  assert(level.allowedTypes.some(t=>!['input','output'].includes(t)) || level.allowedPackages.length,
    `no placeable gate or package in ${level.id}`);
}
// The earlier army gates share this same palette-to-canvas delivery path.
for (const gate of ['not','and','or','nor','xor','xnor']) {
  const file = path.join(root,'levels',`ch1_army_${gate}_v1.json`);
  if (!fs.existsSync(file)) continue;
  const level = JSON.parse(fs.readFileSync(file,'utf8'));
  for (const type of level.allowedTypes) assert(palette.has(type),`${level.id}: ${type}`);
}
const editorFile = path.join(root,'public/circuit-editor.js');
if (fs.existsSync(editorFile)) {
  const editor = fs.readFileSync(editorFile,'utf8');
  assert.match(editor,/getData\("text\/circuit-type"\)/);
  assert.match(editor,/canvasWrap\.addEventListener\("drop"/);
  assert.match(editor,/canvasWrap\.addEventListener\("dragover"/);
}
const index = fs.readFileSync(path.join(root,'public/index.html'),'utf8');
assert.match(index,/circuit-palette-drag-fix\.js\?v=91/);
const script = fs.readFileSync(path.join(root,'public/circuit-palette-drag-fix.js'),'utf8');
assert.match(script,/text\/circuit-type/);
assert.match(script,/canvas\.dispatchEvent\(new DragEvent\('drop'/);
assert.doesNotMatch(script,/fetch\(|api\/|saveProgress\(/);
console.log(`PASS V9.1 editor data: ${levels.length} Yin levels, ${items} supported builtin palette entries`);
