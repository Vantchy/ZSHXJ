/**
 * Live circuit drafting geometry (independent implementation).
 * Every mouse move is a preview; only a click commits a waypoint. The resulting
 * orthogonal SVG path is presentation metadata and never defines electrical
 * connectivity on its own.
 */
import { compactPath, pathIsOrthogonal, pathHitsObstacles } from './circuit-routing.js';

const EPS = 0.01;
const equal = (a,b) => a && b && Math.abs(a.x-b.x)<EPS && Math.abs(a.y-b.y)<EPS;
const horizontalSide = side => side === 'left' || side === 'right';
const verticalSide = side => side === 'top' || side === 'bottom';
const copy = p => ({x:Number(p.x),y:Number(p.y)});
export const gridPoint = (p,step=12) => ({x:Math.round(p.x/step)*step,y:Math.round(p.y/step)*step});

/** Route one hand-drawn leg. Pointer movement updates this path without saving. */
export function liveDraftPath(fixed, target, options={}) {
  if(!fixed?.length || !target || !Number.isFinite(target.x) || !Number.isFinite(target.y))
    return fixed?.map(copy) || [];
  const dest=options.exactTarget?copy(target):gridPoint(target,options.grid||12);
  let points=fixed.map(copy);
  const first=points.length===1;
  let start=points[points.length-1];
  if(equal(start,dest))return points;
  const startSide=first?options.startSide:null;
  const endSide=options.endSide||null;
  let horizontalFirst=Boolean(options.horizontalFirst);
  // A target pin must be approached along its own terminal axis.
  // When the cursor is free, preserve the direction selected by the player.
  if(horizontalSide(endSide))horizontalFirst=false;
  if(verticalSide(endSide))horizontalFirst=true;
  if(!endSide&&horizontalSide(startSide))horizontalFirst=true;
  if(!endSide&&verticalSide(startSide))horizontalFirst=false;
  if(startSide){
    const axis=horizontalSide(startSide)?'x':'y';
    const sign=startSide==='right'||startSide==='bottom'?1:-1;
    const distance=(dest[axis]-start[axis])*sign;
    // The short escape stub prevents wires from entering the body of a device.
    // For a nearby terminal on the same axis, avoid an artificial detour.
    const needsStub=distance<=20 || (!horizontalFirst&&horizontalSide(startSide)) ||
      (horizontalFirst&&verticalSide(startSide));
    if(needsStub){
      start={x:start.x+(axis==='x'?sign*24:0),y:start.y+(axis==='y'?sign*24:0)};
      points.push(start);
    }
  }
  if(!equal(start,dest)){
    if(start.x!==dest.x&&start.y!==dest.y){
      const elbow=horizontalFirst?{x:dest.x,y:start.y}:{x:start.x,y:dest.y};
      points.push(elbow);
    }
    points.push(dest);
  }
  points=compactPath(points);
  // If source and target terminal axes both demand a certain orientation,
  // a single elbow may not satisfy both. Use a compact dogleg as necessary.
  if(first&&startSide&&endSide&&points.length>=2){
    const firstSegment=[points[0],points[1]];
    const lastSegment=[points[points.length-2],points[points.length-1]];
    const sourceOk=horizontalSide(startSide)?firstSegment[0].y===firstSegment[1].y:firstSegment[0].x===firstSegment[1].x;
    const targetOk=horizontalSide(endSide)?lastSegment[0].y===lastSegment[1].y:lastSegment[0].x===lastSegment[1].x;
    if(!sourceOk||!targetOk){
      const a=fixed[0], b=dest;
      const sa=horizontalSide(startSide)?{x:a.x+(startSide==='right'?24:-24),y:a.y}:{x:a.x,y:a.y+(startSide==='bottom'?24:-24)};
      const eb=horizontalSide(endSide)?{x:b.x+(endSide==='right'?24:-24),y:b.y}:{x:b.x,y:b.y+(endSide==='bottom'?24:-24)};
      const elbow=(horizontalSide(startSide)?{x:eb.x,y:sa.y}:{x:sa.x,y:eb.y});
      points=compactPath([a,sa,elbow,eb,b]);
    }
  }
  return points;
}

/** A click fixes the currently previewed path; no circuit wire is created. */
export function commitDraftWaypoint(fixed, target, options={}) {
  const result=liveDraftPath(fixed,target,{...options,exactTarget:false});
  if(!pathIsOrthogonal(result)||result.length<2||result.length>80)return null;
  const oldLast=fixed[fixed.length-1],newLast=result[result.length-1];
  if(equal(oldLast,newLast))return null;
  // A click on a previously fixed vertex is not a new waypoint.
  if(fixed.some((p,i)=>i<fixed.length-1&&equal(p,newLast)))return null;
  return result;
}

/** Validation for finishing a path. Interim waypoints are deliberately editable. */
export function assessDraftPath(points,obstacles=[],otherSegments=[],ownNet=null){
  if(!pathIsOrthogonal(points))return {ok:false,message:'线路必须由水平和垂直线段构成'};
  if(pathHitsObstacles(points,obstacles,4))return {ok:false,message:'线路穿过其他元件，请点击空白处增加转折点绕开'};
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],ah=a.y===b.y;
    for(const s of otherSegments){
      if(s.net===ownNet || (ownNet instanceof Set && ownNet.has(s.net)))continue;
      const c=s.a,d=s.b,ch=c.y===d.y;
      if(ah!==ch)continue;
      const axis=ah?'y':'x',vary=ah?'x':'y';
      if(Math.abs(a[axis]-c[axis])>EPS)continue;
      const overlap=Math.min(Math.max(a[vary],b[vary]),Math.max(c[vary],d[vary]))-
                    Math.max(Math.min(a[vary],b[vary]),Math.min(c[vary],d[vary]));
      if(overlap>EPS)return {ok:false,message:'与另一独立电气网络的导线重叠，请调整走线'};
    }
  }
  return {ok:true,message:''};
}
