import assert from 'node:assert/strict';
import {firstSharedTerminalOverlap,splitPathAt,compactPath,electricalJunctionPoints} from '../public/circuit-routing.js';

const wire=(a,p,b,q)=>({from:{comp:a,pin:p},to:{comp:b,pin:q}});
const target={comp:'Y',pin:'in'};
const base=wire('A','out','Y','in');
const old=[{x:100,y:0},{x:300,y:0}];
const newWire=[{x:0,y:120},{x:160,y:120},{x:160,y:0},{x:300,y:0}];
const join=firstSharedTerminalOverlap(newWire,target,[base],[{points:old}]);
assert.ok(join,'Same-terminal positive-length overlap must produce a proposed branch');
assert.equal(join.wireIndex,0);
assert.deepEqual(join.point,{x:160,y:0},'Meet at first shared point, not at the terminal');
assert.deepEqual(join.prefix,[{x:0,y:120},{x:160,y:120},{x:160,y:0}],
  'No coincident tail should remain on the new wire');
assert.deepEqual(join.split.before,[{x:100,y:0},{x:160,y:0}]);
assert.deepEqual(join.split.after,[{x:160,y:0},{x:300,y:0}]);

const reversed=firstSharedTerminalOverlap(newWire,target,
  [wire('Y','in','A','out')],[{points:[...old].reverse()}]);
assert.deepEqual(reversed.point,join.point,'Target pin may be stored at either end of an old wire');
assert.deepEqual(reversed.split.before,[{x:300,y:0},{x:160,y:0}]);

const existingJunction=firstSharedTerminalOverlap(newWire,target,
  [wire('J1','out','Y','in')],[{points:[{x:160,y:0},{x:300,y:0}]}]);
assert.equal(existingJunction.split,null,
  'A shared segment beginning exactly at an existing junction must not be split');
assert.deepEqual(existingJunction.reuseEndpoint,{comp:'J1',pin:'out'},
  'Attach to the already-connected endpoint instead of piling up new dots');
assert.deepEqual(existingJunction.point,{x:160,y:0});

const multiple=firstSharedTerminalOverlap(newWire,target,
  [wire('C','out','Y','in'),base],
  [[{x:180,y:0},{x:300,y:0}],old]);
assert.equal(multiple.wireIndex,1,'Select the first overlap along NEW wire, not first wire in array');
assert.deepEqual(multiple.point,{x:160,y:0});

const differentEnd=firstSharedTerminalOverlap(newWire,target,
  [wire('A','out','Z','in')],[{points:old}]);
assert.equal(differentEnd,null,'Shared geometry with a DIFFERENT destination may not auto-connect');
const differentPin=firstSharedTerminalOverlap(newWire,target,
  [wire('A','out','Y','other')],[{points:old}]);
assert.equal(differentPin,null,'An identical-looking but different pin is a different endpoint');
const differentCoordinate=firstSharedTerminalOverlap(newWire,target,[base],
  [{points:[{x:100,y:0},{x:301,y:0}]}]);
assert.equal(differentCoordinate,null,'Old wire must actually meet the destination on canvas');
const crossingOnly=[{x:0,y:100},{x:160,y:100},{x:160,y:-80},
  {x:350,y:-80},{x:350,y:0},{x:300,y:0}];
assert.equal(firstSharedTerminalOverlap(crossingOnly,target,[base],[old]),null,
  'A perpendicular crossing or mere endpoint touch never creates an electrical node');
const noOverlap=[{x:0,y:120},{x:320,y:120},{x:320,y:0},{x:300,y:0}];
assert.equal(firstSharedTerminalOverlap(noOverlap,target,[base],[old]),null,
  'Only touching the same terminal is not positive-length wire overlap');

const junction={id:'J1',type:'junction',x:146,y:-14};
const components=[{id:'A',type:'input'},{id:'B',type:'input'},
  {id:'Y',type:'output'},junction];
const tied=[wire('A','out','J1','a'),wire('J1','out','Y','in'),wire('B','out','J1','out')];
assert.deepEqual(electricalJunctionPoints(components,tied,()=>({x:160,y:0})),[],
  'Explicit junction paints its own dot, not a double marker');
assert.equal(compactPath(join.prefix).length,3);
assert.ok(splitPathAt(old,join.point,10));
console.log('Shared-terminal junction geometry PASS: first overlap, reversed, crossing, distinct end and genuine netlist junction');
