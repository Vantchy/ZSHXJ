/** Standalone geometry rules: nothing in this test changes electrical topology. */
import assert from 'node:assert/strict';
import {
  compactPath,routeOrthogonal,splitPathAt,projectToPath,shiftSegment,
  occupiedSegments,unrelatedOverlap,pathIsOrthogonal,pointsToPath,reanchorPath
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

// Collinear only merges when the midpoint lies *between* both neighbors.
assert.deepEqual(compactPath([{x:0,y:0},{x:50,y:0},{x:40,y:0}]),
  [{x:0,y:0},{x:50,y:0},{x:40,y:0}]);
const netA=occupiedSegments(line,'A');
assert.equal(unrelatedOverlap(line,netA,'A'),0);
assert.equal(unrelatedOverlap(line,netA,'B'),200);
const crossing=[{x:100,y:0},{x:100,y:90}];
assert.equal(unrelatedOverlap(crossing,netA,'B'),0,'Crossing is not shared copper');

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
console.log('Geometry regression PASS: precise junctions, preserved paths, 36 segment drags, orthogonal routes and unrelated-net isolation.');
