import assert from 'node:assert/strict';
import {liveDraftPath,commitDraftWaypoint,assessDraftPath,alignFixedWaypoints} from '../public/circuit-drafting.js';
import {compactPath,pathIsOrthogonal} from '../public/circuit-routing.js';
const start={x:208,y:248};
const initial=[start];
const first=liveDraftPath(initial,{x:438,y:421},{grid:12,horizontalFirst:true,startSide:'right'});
assert.deepEqual(first,[{x:208,y:248},{x:444,y:248},{x:444,y:420}]);
const firstClicked=commitDraftWaypoint(initial,{x:438,y:421},{grid:12,horizontalFirst:true,startSide:'right'});
assert.deepEqual(firstClicked,first);
const second=commitDraftWaypoint(firstClicked,{x:936,y:420},{grid:12,horizontalFirst:false});
assert.deepEqual(second,[...firstClicked,{x:936,y:420}]);
const finish=liveDraftPath(second,{x:1100,y:248},{exactTarget:true,horizontalFirst:false,endSide:'left',alignTerminal:false});
assert.deepEqual(finish,[...second,{x:936,y:248},{x:1100,y:248}]);
assert.ok(pathIsOrthogonal(finish));
assert.deepEqual(compactPath(finish),finish);
assert.equal(commitDraftWaypoint(second,{x:936,y:420}),null,'Zero-length waypoint ignored');
assert.equal(assessDraftPath(finish,[]).ok,true);
assert.equal(assessDraftPath(finish,[{x:565,y:185,w:160,h:100}]).ok,true,'Manual path avoids component');
assert.equal(assessDraftPath([{x:5,y:20},{x:205,y:20}], [{x:60,y:0,w:60,h:50}]).ok,false);
const occupied=[{a:{x:30,y:20},b:{x:200,y:20},net:'other'}];
assert.equal(assessDraftPath([{x:0,y:20},{x:240,y:20}],[],occupied,'mine').ok,false);
assert.equal(assessDraftPath([{x:0,y:20},{x:240,y:20}],[],occupied,new Set(['other'])).ok,true);
assert.equal(assessDraftPath([{x:0,y:0},{x:240,y:0}],[],occupied,'mine').ok,true);
const dogleg=liveDraftPath([{x:120,y:120}],{x:320,y:240},
  {startSide:'right',endSide:'left',exactTarget:true,horizontalFirst:true});
assert.ok(pathIsOrthogonal(dogleg));
assert.equal(dogleg[0].y,dogleg[1].y,'Wire exits source horizontally');
assert.equal(dogleg.at(-1).y,dogleg.at(-2).y,'Wire arrives at target horizontally');
// A near miss on a terminal must be taken up at the last down/right bend.
// Both preview and saved route must have no dangling stub below the new elbow.
const downRight=[{x:100,y:100},{x:100,y:210},{x:170,y:210}];
const originalDownRight=JSON.parse(JSON.stringify(downRight));
const target={x:310,y:204};
assert.deepEqual(alignFixedWaypoints(downRight,target,'left'),
  [{x:100,y:100},{x:100,y:204},{x:170,y:204}]);
assert.deepEqual(liveDraftPath(downRight,target,{exactTarget:true,endSide:'left'}),
  [{x:100,y:100},{x:100,y:204},{x:310,y:204}],
  'Absorb the six-unit mismatch into the old vertical leg; erase its overshoot');
assert.deepEqual(downRight,originalDownRight,'Preview cannot mutate committed waypoints');
const downOnly=[{x:100,y:100},{x:100,y:212}];
assert.deepEqual(liveDraftPath(downOnly,{x:300,y:199},{exactTarget:true,endSide:'left'}),
  [{x:100,y:100},{x:100,y:199},{x:300,y:199}],
  'The directly adjacent vertical segment should extend to the pin height');
const toBottom=[{x:50,y:50},{x:160,y:50},{x:160,y:220}];
assert.deepEqual(liveDraftPath(toBottom,{x:154,y:300},{exactTarget:true,endSide:'top'}),
  [{x:50,y:50},{x:154,y:50},{x:154,y:300}],
  'A vertical terminal should absorb horizontal errors symmetrically');
assert.deepEqual(alignFixedWaypoints(downRight,{x:310,y:150},'left'),
  [{x:100,y:100},{x:100,y:150},{x:170,y:150}],
  'A distant terminal must correct the nearest elbow without a 24-unit cutoff');
assert.equal(alignFixedWaypoints(downRight,{x:310,y:150},'left',24),null,
  'An explicit limited correction setting remains supported');
assert.deepEqual(alignFixedWaypoints([{x:100,y:100},{x:100,y:110}],{x:300,y:90},'left'),
  [{x:100,y:100},{x:100,y:90}],
  'Reversing an erroneous leg is allowed when the editor confirms the path is clear');
assert.equal(alignFixedWaypoints(downRight,{x:70,y:204},'left'),null,
  'Do not approach a left-side terminal from its right');
assert.deepEqual(liveDraftPath(downRight,target,{exactTarget:true,endSide:'left',alignTerminal:false}),
  [{x:100,y:100},{x:100,y:210},{x:170,y:210},{x:170,y:204},{x:310,y:204}],
  'Original route remains available as a safe fallback on a collision');
assert.deepEqual(liveDraftPath(downRight,target,{exactTarget:false,endSide:'left'}),
  liveDraftPath(downRight,target,{exactTarget:false,endSide:'left',alignTerminal:false}),
  'Free pointer movement must not silently rewrite committed waypoints');

// Real screenshot case: >130 world-unit overshoot, with a clicked low anchor.
const longFixed=[{x:174,y:65},{x:886,y:65},{x:886,y:360}];
const longTarget={x:1554,y:222};
assert.deepEqual(liveDraftPath(longFixed,longTarget,{exactTarget:true,endSide:'left'}),
  [{x:174,y:65},{x:886,y:65},{x:886,y:222},longTarget],
  'The entire 138-unit tail must vanish, not just a short nearby adjustment');
const free=liveDraftPath(longFixed,{x:1554,y:220},{exactTarget:false,endSide:'left'});
assert.ok(pathIsOrthogonal(free),'Free-pointer previews still produce an orthogonal path');
assert.deepEqual(longFixed,[{x:174,y:65},{x:886,y:65},{x:886,y:360}],
  'Snapping/preview must not mutate the earlier clicked points');
const originalObstacle=[{x:565,y:185,w:160,h:100}];
const unsafeAligned=liveDraftPath(second,{x:1100,y:248},
  {exactTarget:true,horizontalFirst:false,endSide:'left'});
assert.equal(assessDraftPath(unsafeAligned,originalObstacle).ok,false,
  'Blindly moving a distant elbow through an obstacle must be rejected by assessment');
assert.equal(assessDraftPath(finish,originalObstacle).ok,true,
  'Retain the manual detour when it is needed to avoid a component');
console.log('Live drafting geometry PASS: preview, clicked corners, absorbed terminal offsets, collision, no redundant waypoints');
