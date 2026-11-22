/** Standalone geometry rules: nothing in this test changes electrical topology. */
import assert from 'node:assert/strict';
import {
  compactPath,routeOrthogonal,splitPathAt,projectToPath,shiftSegment,
  occupiedSegments,unrelatedOverlap,collinearOverlap,pathIsOrthogonal,pointsToPath,reanchorPath,electricalJunctionPoints
} from '../public/circuit-routing.js';

const line=[{x:0,y:42},{x:200,y:42}];
for(let x=20;x<200;x+=13){
  const insertion={x,y:42};
  const pieces=splitPathAt(line,insertion);
  assert.ok(pieces);
  assert.deepEqual(compactPath([...pieces.before,...pieces.after.slice(1)]),line);
  assert.equal(pieces.point.y,42,'A junction may never snap off the original wire');
}
assert.equal(splitPathAt(line,{x:2,y:42}),null,'Endpoint-adjacent nodes are rejected');
assert.equal(splitPathAt(line,{x:100,y:45}),null,'The user must click on the actual segment');
assert.deepEqual(projectToPath({x:75,y:50},line).point,{x:75,y:42});

const angles=[
  [{x:0,y:0},{x:80,y:0},{x:80,y:50},{x:180,y:50}],
  [{x:10,y:10},{x:10,y:100},{x:90,y:100},{x:90,y:200}],
  [{x:0,y:90},{x:90,y:90},{x:90,y:0},{x:200,y:0}]
];
for(const original of angles){
  for(let segment=0;segment<original.length-1;segment++){
    for(const delta of [-48,-24,24,48]){
      const moved=shiftSegment(original,segment,delta);
      assert.ok(pathIsOrthogonal(moved),`Move segment ${segment} by ${delta}`);
      assert.deepEqual(moved[0],original[0]);
      assert.deepEqual(moved[moved.length-1],original[original.length-1]);
    }
  }
}
const reanchored=reanchorPath(line,{x:0,y:100},{x:200,y:42});
assert.ok(pathIsOrthogonal(reanchored));
assert.deepEqual(reanchored[0],{x:0,y:100});
assert.deepEqual(reanchored[reanchored.length-1],{x:200,y:42});

// Collinear U-turns are removed even when the player overshoots far beyond
// the eventual snapped terminal (the old implementation drew double copper).
assert.deepEqual(compactPath([{x:0,y:0},{x:50,y:0},{x:40,y:0}]),
  [{x:0,y:0},{x:40,y:0}]);
assert.deepEqual(compactPath([{x:0,y:0},{x:0,y:360},{x:0,y:222},{x:400,y:222}]),
  [{x:0,y:0},{x:0,y:222},{x:400,y:222}]);
assert.deepEqual(compactPath([{x:0,y:0},{x:100,y:0},{x:100,y:100},
  {x:40,y:100},{x:40,y:0},{x:180,y:0}]),
  [{x:0,y:0},{x:180,y:0}],
  'Erase self-intersecting rectangular detours returning along the same run');
const netA=occupiedSegments(line,'A');
assert.equal(unrelatedOverlap(line,netA,'A'),0);
assert.equal(unrelatedOverlap(line,netA,'B'),200);
const crossing=[{x:100,y:0},{x:100,y:90}];
assert.equal(unrelatedOverlap(crossing,netA,'B'),0,'Crossing is not shared copper');
assert.equal(collinearOverlap(crossing,netA),0,
  'A perpendicular crossing must not be penalized as a coincident run');
assert.equal(collinearOverlap(line,netA),200,
  'Score visual overlap even when two conductors belong to the same network');

const obstacles=[{x:70,y:20,w:70,h:50}];
for(let y=-25;y<=90;y+=5){
  const a={x:0,y,side:'right'},b={x:250,y,side:'left'};
  const route=routeOrthogonal(a,b,obstacles);
  assert.ok(pathIsOrthogonal(route.points));
  assert.equal(pointsToPath(route.points).startsWith('M'),true);
  assert.deepEqual(route.points[0],{x:a.x,y:a.y});
  assert.deepEqual(route.points[route.points.length-1],{x:b.x,y:b.y});
}
// Two independent routes crossing in opposite directions must have no shared run.
for(let spacing=40;spacing<120;spacing+=10){
  const a=routeOrthogonal({x:0,y:0,side:'right'},{x:300,y:spacing,side:'left'});
  const b=routeOrthogonal({x:0,y:spacing,side:'right'},{x:300,y:0,side:'left'},[],
    {occupied:occupiedSegments(a.points,'netA'),net:'netB'});
  assert.equal(unrelatedOverlap(b.points,occupiedSegments(a.points,'netA'),'netB'),0,
    `Different-net routes overlap at spacing ${spacing}`);
}
// Automatic routing must seek a different lane for same-net overlap as well;
// two physical wires on the same copper should not be painted as a thick run.
const sharedBase=[{x:0,y:0},{x:340,y:0}];
const sharedAuto=routeOrthogonal({x:40,y:0,side:'right'},
  {x:300,y:0,side:'left'},[],
  {occupied:occupiedSegments(sharedBase,'same'),net:'same'});
assert.ok(pathIsOrthogonal(sharedAuto.points));
assert.ok(collinearOverlap(sharedAuto.points,occupiedSegments(sharedBase,'same'))<100,
  'Same-net routing must avoid long coincident segments when a detour is available');
// Visually crossing independent wires are NOT an electrical node. Real shared
// wire endpoints are, including multiple conductors attached to a device pin.
const components=[{id:'A',type:'input'},{id:'B',type:'output'},
  {id:'C',type:'input'},{id:'D',type:'output'},
  {id:'E',type:'output'},{id:'J',type:'junction'}];
const pinPosition=(c,pin)=>({x:c.id==='A'?0:c.id==='J'?100:200,
  y:c.id==='A'?30:c.id==='J'?50:pin==='out'?30:70});
const edge=(c,p,d,q)=>({from:{comp:c,pin:p},to:{comp:d,pin:q}});
const twoNets=[edge('A','out','B','in'),edge('C','out','D','in')];
assert.deepEqual(projectToPath({x:100,y:42},line).point,{x:100,y:42});
assert.deepEqual(projectToPath({x:100,y:42},crossing).point,{x:100,y:42},
  'These geometries really do intersect at the same screen coordinate');
assert.deepEqual(electricalJunctionPoints(components,twoNets,pinPosition),[],
  'A geometric crossing without a common netlist endpoint gets no dot');
const branched=[...twoNets,edge('A','out','E','in')];
assert.deepEqual(electricalJunctionPoints(components,branched,pinPosition),[
  {x:0,y:30,componentId:'A',pin:'out',count:2}],
  'Two distinct conductors on one terminal produce one electrical dot');
assert.equal(electricalJunctionPoints(components,[...branched,branched[2]],pinPosition).length,1,
  'Duplicate wire records must not invent additional junctions');
const explicit=[edge('A','out','J','a'),edge('J','out','B','in'),edge('J','out','E','in')];
assert.deepEqual(electricalJunctionPoints(components,explicit,pinPosition),[],
  'Explicit junction component already draws one dot and must not get a duplicate');
console.log('Geometry regression PASS: precise junctions, preserved paths, 36 segment drags, orthogonal routes and topology-only dots.');
