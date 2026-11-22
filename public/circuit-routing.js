/**
 * Circuit editor geometry. Paths are presentation, never electrical topology.
 * Strictly orthogonal, segment-aware routing, with stable user-edited paths.
 * This file is independent of the reference platform's implementation.
 */
const EPS = 1e-6;
const norm = x => Math.round(Number(x) * 100) / 100;
const eq = (a,b) => Math.abs(a-b)<EPS;
const pointEq = (a,b) => eq(a.x,b.x)&&eq(a.y,b.y);
const manhattan=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const copyPoint=p=>({x:norm(p.x),y:norm(p.y)});
const isStraight=(a,b)=>eq(a.x,b.x)||eq(a.y,b.y);
const between=(a,b,c)=> b>=Math.min(a,c)-EPS && b<=Math.max(a,c)+EPS;

/** Eliminate duplicate corners and collinear motion, including *long* retraces.
 * A snapped target often lies 100+ units back from a clicked waypoint; leaving
 * the overshoot in the SVG paints a doubled line (even though topology is fine).
 */
function compactCollinear(points){
  const result=[];
  for(const raw of points||[]){
    if(!raw||!Number.isFinite(Number(raw.x))||!Number.isFinite(Number(raw.y)))continue;
    const p=copyPoint(raw);
    if(result.length&&pointEq(result[result.length-1],p))continue;
    result.push(p);
    while(result.length>=3){
      const [a,b,c]=result.slice(-3);
      if(pointEq(a,c)){result.splice(-2,2);continue;}
      // "b between a and c" is NOT required: a -> b -> c may overshoot
      // the final target and travel the same piece of copper in reverse.
      if((eq(a.x,b.x)&&eq(b.x,c.x))||(eq(a.y,b.y)&&eq(b.y,c.y))){
        result.splice(-2,1);continue;
      }
      break;
    }
  }
  return result;
}
/** An intersection of two NON-adjacent segments within one wire indicates a
 * removable closed loop. The shortcut uses only existing line portions, so it
 * cannot cross a component that the original path avoided.
 */
function segmentMeeting(a,b,c,d){
  if(!isStraight(a,b)||!isStraight(c,d))return null;
  const ah=eq(a.y,b.y),ch=eq(c.y,d.y);
  if(ah===ch){
    const axis=ah?'x':'y',fixed=ah?'y':'x';
    if(!eq(a[fixed],c[fixed]))return null;
    const lo=Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis]));
    const hi=Math.min(Math.max(a[axis],b[axis]),Math.max(c[axis],d[axis]));
    if(lo>hi+EPS)return null;
    // First point reached when travelling along the later segment.
    const coord=d[axis]>=c[axis]?lo:hi;
    return ah?{x:norm(coord),y:norm(a.y)}:{x:norm(a.x),y:norm(coord)};
  }
  const h=ah?{a,b}:{a:c,b:d},v=ah?{a:c,b:d}:{a,b};
  const p={x:norm(v.a.x),y:norm(h.a.y)};
  return between(h.a.x,p.x,h.b.x)&&between(v.a.y,p.y,v.b.y)?p:null;
}
const pathLength=points=>points.slice(1).reduce((total,p,i)=>total+manhattan(points[i],p),0);
export function compactPath(points){
  let route=compactCollinear(points);
  // Do not erase right-angle corners just because they LOOK close; erase only
  // proven self-intersections / coincident runs, never nearby parallel lines.
  for(let pass=0;pass<160&&route.length>=4;pass++){
    let shortened=null;
    const oldLength=pathLength(route);
    for(let j=2;j<route.length-1&&!shortened;j++){
      for(let i=0;i<j-1;i++){
        const meeting=segmentMeeting(route[i],route[i+1],route[j],route[j+1]);
        if(!meeting)continue;
        const candidate=compactCollinear([...route.slice(0,i+1),meeting,...route.slice(j+1)]);
        if(candidate.length>=2 && pathLength(candidate)<oldLength-EPS){
          shortened=candidate;break;
        }
      }
    }
    if(!shortened)break;
    route=shortened;
  }
  return route;
}
export const pointsToPath=points=>compactPath(points).map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ');
export const pathIsOrthogonal=points=>Array.isArray(points)&&points.length>=2&&points.length<=160&&
  points.every((p,i)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&
    (i===0||isStraight(points[i-1],p)));

export function crossesRect(a,b,rect){
  const x0=rect.x,x1=rect.x+rect.w,y0=rect.y,y1=rect.y+rect.h;
  if(eq(a.x,b.x))return a.x>x0+EPS&&a.x<x1-EPS&&Math.max(a.y,b.y)>y0+EPS&&Math.min(a.y,b.y)<y1-EPS;
  if(eq(a.y,b.y))return a.y>y0+EPS&&a.y<y1-EPS&&Math.max(a.x,b.x)>x0+EPS&&Math.min(a.x,b.x)<x1-EPS;
  return true;
}
const obstaclesClear=(a,b,rects)=>isStraight(a,b)&&rects.every(r=>!crossesRect(a,b,r));
export function pathHitsObstacles(points,rectangles,clearance=8){
  if(!pathIsOrthogonal(points))return true;
  const rects=rectangles.map(r=>({x:r.x-clearance,y:r.y-clearance,w:r.w+2*clearance,h:r.h+2*clearance}));
  return points.slice(1).some((p,i)=>!obstaclesClear(points[i],p,rects));
}

/** Project mouse position onto the nearest existing segment (never guess a midpoint). */
export function projectToPath(point,points){
  let best=null;
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1];
    if(!isStraight(a,b)||pointEq(a,b))continue;
    const horizontal=eq(a.y,b.y);
    const projected=horizontal?
      {x:Math.min(Math.max(point.x,Math.min(a.x,b.x)),Math.max(a.x,b.x)),y:a.y}:
      {x:a.x,y:Math.min(Math.max(point.y,Math.min(a.y,b.y)),Math.max(a.y,b.y))};
    const distance=Math.hypot(point.x-projected.x,point.y-projected.y);
    if(best===null||distance<best.distance)
      best={point:copyPoint(projected),index:i,distance};
  }
  return best;
}
/** Splits one polyline without rerouting either half. Endpoints cannot become spurious nodes. */
export function splitPathAt(points,target,minEndDistance=10){
  const found=projectToPath(target,points);
  if(!found||found.distance>EPS)return null;
  const p=found.point;
  if(manhattan(p,points[0])<minEndDistance||manhattan(p,points[points.length-1])<minEndDistance)return null;
  const before=compactPath([...points.slice(0,found.index+1),p]);
  const after=compactPath([p,...points.slice(found.index+1)]);
  return before.length>=2&&after.length>=2?{point:p,before,after,index:found.index}:null;
}
/**
 * Find the earliest (in route traversal order) positive-length common copper
 * run with an *explicitly eligible* electrical network.  The editor supplies
 * eligibility from union-find; geometry alone must NEVER merge two networks.
 *
 * The route is oriented from the pin which will remain on the new branch to
 * the pin whose existing network we are joining.  Reverse it to handle
 * same-source fan-outs: this selects the LAST common point in drawing order,
 * where the two conductors diverge, rather than a dot beside the source pin.
 */
export function firstSharedNetworkOverlap(newPoints,wires,layouts,eligible,minEndDistance=10){
  if(!pathIsOrthogonal(newPoints)||!Array.isArray(wires)||
     !Array.isArray(layouts)||typeof eligible!=="function")return null;
  let best=null,travelled=0;
  for(let i=0;i<newPoints.length-1;i++){
    const a=newPoints[i],b=newPoints[i+1],horizontal=eq(a.y,b.y);
    const axis=horizontal?'x':'y',fixed=horizontal?'y':'x';
    const sign=b[axis]>a[axis]?1:-1;
    for(let j=0;j<wires.length;j++){
      const old=wires[j],path=Array.isArray(layouts[j])?layouts[j]:layouts[j]?.points;
      if(!pathIsOrthogonal(path)||!eligible(old,j,path,newPoints.at(-1)))continue;
      for(let k=0;k<path.length-1;k++){
        const c=path[k],d=path[k+1];
        if(horizontal!==eq(c.y,d.y)||!eq(a[fixed],c[fixed]))continue;
        const lo=Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis]));
        const hi=Math.min(Math.max(a[axis],b[axis]),Math.max(c[axis],d[axis]));
        if(hi-lo<=EPS)continue; // perpendicular intersection is NOT a tap
        // At the first shared run, prefer the first available interior point.
        // If the entry falls on an unsplittable terminal, continue inside the
        // same shared stretch rather than blindly skipping the whole overlap.
        const first=sign>0?lo:hi,second=sign>0?hi:lo;
        const probes=[first, first+sign*minEndDistance,
          first+sign*Math.min(48,Math.abs(second-first)/2),second];
        for(const pos of probes){
          if(pos<lo-EPS||pos>hi+EPS)continue;
          const point=horizontal?{x:norm(pos),y:norm(a.y)}:{x:norm(a.x),y:norm(pos)};
          const length=travelled+Math.abs(pos-a[axis]);
          if(best&&length>=best.distance-EPS)continue;
          const prefix=compactPath([...newPoints.slice(0,i+1),point]);
          if(!pathIsOrthogonal(prefix)||prefix.length<2)continue;
          const split=splitPathAt(path,point,minEndDistance);
          const reuseEndpoint=!split&&pointEq(point,path[0])?{...old.from}:
            !split&&pointEq(point,path.at(-1))?{...old.to}:null;
          if(!split&&!reuseEndpoint)continue;
          best={wireIndex:j,point:copyPoint(point),prefix,split,reuseEndpoint,
            distance:length,kind:'overlap'};
        }
      }
    }
    travelled+=manhattan(a,b);
  }
  return best;
}
/**
 * Two branches which head out of the SAME real junction can occupy almost
 * identical lanes before separating.  Suggest the FAR (source-facing) end of
 * that shared corridor as a more natural position for the junction.  Neither
 * geometry nor proximity proves connectivity: the caller must first confirm
 * that both branches really terminate at the same electrical node.
 *
 * The "lead" guard prevents a remotely parallel pair from attracting a
 * junction across the circuit, and keeps normal crossing wires untouched.
 */
export function nearParallelForkCandidates(left,right,{
  maxGap=18,minRun=60,maxLead=44,maxShift=330
}={}){
  if(!pathIsOrthogonal(left)||!pathIsOrthogonal(right)||
     !pointEq(left[0],right[0]))return [];
  const origin=left[0],results=[];
  const along=path=>{
    let travelled=0;const lines=[];
    for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],horizontal=eq(a.y,b.y);
      lines.push({a,b,horizontal,travelled,
        axis:horizontal?'x':'y',fixed:horizontal?'y':'x',
        direction:Math.sign(b[horizontal?'x':'y']-a[horizontal?'x':'y'])});
      travelled+=manhattan(a,b);
    }
    return lines;
  };
  const aLines=along(left),bLines=along(right);
  for(const a of aLines)for(const b of bLines){
    if(a.horizontal!==b.horizontal||a.direction!==b.direction||!a.direction)continue;
    const gap=Math.abs(a.a[a.fixed]-b.a[b.fixed]);
    if(gap<0.5||gap>maxGap)continue;
    const lo=Math.max(Math.min(a.a[a.axis],a.b[a.axis]),Math.min(b.a[b.axis],b.b[b.axis]));
    const hi=Math.min(Math.max(a.a[a.axis],a.b[a.axis]),Math.max(b.a[b.axis],b.b[b.axis]));
    const run=hi-lo;
    if(run<minRun)continue;
    const first=a.direction>0?lo:hi,last=a.direction>0?hi:lo;
    const leadA=a.travelled+Math.abs(first-a.a[a.axis]);
    const leadB=b.travelled+Math.abs(first-b.a[b.axis]);
    if(leadA>maxLead||leadB>maxLead)continue;
    // Leave a short approach for terminals at the far edge of the corridor.
    for(const retreat of [0,24]){
      if(run-retreat<minRun/2)continue;
      const at=last-a.direction*retreat;
      const point=a.horizontal?{x:norm(at),y:norm(a.a.y)}:
        {x:norm(a.a.x),y:norm(at)};
      const shift=manhattan(point,origin);
      if(shift<30||shift>maxShift)continue;
      results.push({point,run,gap,shift,lead:Math.max(leadA,leadB)});
    }
  }
  const unique=new Map();
  for(const c of results){
    const key=`${c.point.x}:${c.point.y}`;
    const prev=unique.get(key);
    if(!prev||c.run>prev.run)unique.set(key,c);
  }
  return [...unique.values()].sort((a,b)=>b.run-a.run||a.gap-b.gap||a.shift-b.shift);
}

/** Backwards-compatible same-terminal specialization (same-target fan-in). */
export function firstSharedTerminalOverlap(newPoints,targetPin,wires,layouts,minEndDistance=10){
  if(!targetPin)return null;
  const matches=p=>p?.comp===targetPin.comp&&p?.pin===targetPin.pin;
  return firstSharedNetworkOverlap(newPoints,wires,layouts,(wire,index,path,target)=>{
    if(!matches(wire?.from)&&!matches(wire?.to))return false;
    return pointEq(matches(wire.from)?path[0]:path.at(-1),target);
  },minEndDistance);
}
/**
 * Suggest geometrically conservative trunk tap points.  Near-parallel wires
 * qualify ONLY if their electrical network was already verified by the editor.
 * A common terminal additionally permits a tap farther along the first leg,
 * so a 24-unit escape stub becomes a clean fan-out in the middle of the trunk.
 * No mutation, no implicit crossing or electrical union happens here.
 */
export function nearbyTrunkTaps(nearPath,oldPath,commonPoint=null,maxGap=18){
  if(!pathIsOrthogonal(nearPath)||!pathIsOrthogonal(oldPath))return [];
  const candidates=[];const seen=new Set();
  const collect=(p,reason,gap=0)=>{
    const point=copyPoint(p),id=`${point.x}:${point.y}`;
    if(seen.has(id))return;
    const split=splitPathAt(oldPath,point,12);
    if(!split)return;
    // Visible dot placed *on* a pin or 12 units from it looks like a mistake.
    if(manhattan(point,oldPath[0])<32||manhattan(point,oldPath.at(-1))<32)return;
    seen.add(id);candidates.push({point,split,reason,gap});
  };
  if(commonPoint){
    const first=pointEq(oldPath[0],commonPoint),last=pointEq(oldPath.at(-1),commonPoint);
    if(first||last){
      const p=first?oldPath:[...oldPath].reverse();
      const leg=p[1],head=p[0],distance=manhattan(head,leg);
      if(distance>=72){
        const t=Math.min(distance-32,Math.max(46,Math.min(96,distance*0.45)))/distance;
        collect({x:head.x+(leg.x-head.x)*t,y:head.y+(leg.y-head.y)*t},'shared-terminal');
      }
    }
  }
  // A pre-existing elbow is a better electrical fork than a new dot a few
  // pixels before it. Consider only corners on the first portion of a trunk
  // that actually shares a terminal; do not attract unrelated nearby routes.
  if(commonPoint && (pointEq(oldPath[0],commonPoint)||
      pointEq(oldPath.at(-1),commonPoint))){
    const trunk=pointEq(oldPath[0],commonPoint)?oldPath:[...oldPath].reverse();
    let travelled=0;
    for(let k=1;k<trunk.length-1;k++){
      travelled+=manhattan(trunk[k-1],trunk[k]);
      if(travelled>196)break;
      const nearby=projectToPath(trunk[k],nearPath);
      if(nearby&&nearby.distance<=88)
        collect(trunk[k],'existing-elbow',nearby.distance);
    }
  }
  // Also consider pre-existing elbows on another branch of this SAME
  // proven network (whose terminal is connected indirectly through a prior
  // junction). The drawn preview may not cross that elbow, yet joining there
  // can remove a long doubled leg below an earlier shared starting point.
  // Limit to a short corridor; this is not a global graph beautifier.
  if(!commonPoint){
    for(const corner of oldPath.slice(1,-1)){
      const near=projectToPath(corner,nearPath);
      if(near&&near.distance<=92)
        collect(corner,'existing-elbow',near.distance);
    }
  }
  // A same-network perpendicular crossing is a legitimate candidate only
  // when the *caller* has proved this whole trunk eligible. The returned tap
  // still needs to pass netlist and obstacle checks before it is committed.
  for(let i=1;i<nearPath.length;i++)for(let j=1;j<oldPath.length;j++){
    const a=nearPath[i-1],b=nearPath[i],c=oldPath[j-1],d=oldPath[j];
    if(eq(a.y,b.y)===eq(c.y,d.y))continue;
    const h=eq(a.y,b.y)?{a,b}:{a:c,b:d};
    const v=eq(a.x,b.x)?{a,b}:{a:c,b:d};
    const x=v.a.x,y=h.a.y;
    if(between(h.a.x,x,h.b.x)&&between(v.a.y,y,v.b.y))
      collect({x,y},'same-net-crossing');
  }
  for(let i=1;i<nearPath.length;i++)for(let j=1;j<oldPath.length;j++){
    const a=nearPath[i-1],b=nearPath[i],c=oldPath[j-1],d=oldPath[j];
    const ah=eq(a.y,b.y),ch=eq(c.y,d.y);
    if(ah!==ch)continue;
    const fixed=ah?'y':'x',vary=ah?'x':'y';
    const gap=Math.abs(a[fixed]-c[fixed]);
    if(gap>maxGap+EPS)continue;
    const lo=Math.max(Math.min(a[vary],b[vary]),Math.min(c[vary],d[vary]));
    const hi=Math.min(Math.max(a[vary],b[vary]),Math.max(c[vary],d[vary]));
    if(hi-lo<24)continue;
    // Prefer the midpoint of a substantial shared corridor; short approaches
    // and one-point crossings must not create electrical junctions.
    const midpoint=(lo+hi)/2;
    collect(ah?{x:midpoint,y:c.y}:{x:c.x,y:midpoint},'near-parallel',gap);
  }
  return candidates.slice(0,24);
}

/** Drag an entire straight segment while keeping endpoint pins anchored. */
export function shiftSegment(points,index,delta){
  if(!pathIsOrthogonal(points)||index<0||index>=points.length-1||!Number.isFinite(delta))return null;
  const a=points[index],b=points[index+1],horizontal=eq(a.y,b.y);
  const newAxis=norm((horizontal?a.y:a.x)+delta);
  const p=points.map(copyPoint);
  if(index===0){
    const old=p[0];
    const newA=horizontal?{x:old.x,y:newAxis}:{x:newAxis,y:old.y};
    p.splice(1,0,newA);
    index++;
  }
  if(index===p.length-2){
    const old=p[p.length-1];
    const newB=horizontal?{x:old.x,y:newAxis}:{x:newAxis,y:old.y};
    p.splice(p.length-1,0,newB);
  }
  if(horizontal){p[index].y=newAxis;p[index+1].y=newAxis;}
  else {p[index].x=newAxis;p[index+1].x=newAxis;}
  const compacted=compactPath(p);
  return pathIsOrthogonal(compacted)?compacted:null;
}

/** Geometrical collision score for existing wires.
 * A junction can share a pin; sharing a long stretch of an existing wire is
 * visually ambiguous even when the two wires belong to the same electrical net.
 * Independent nets receive a prohibitive coincidence cost.
 */
function segmentPenalty(a,b,occupied,ownNet){
  let penalty=0,conflict=0,shared=0;
  const horizontal=eq(a.y,b.y),amin=horizontal?Math.min(a.x,b.x):Math.min(a.y,b.y);
  const amax=horizontal?Math.max(a.x,b.x):Math.max(a.y,b.y);
  for(const segment of occupied){
    const c=segment.a,d=segment.b,otherHorizontal=eq(c.y,d.y),sameNet=segment.net===ownNet;
    if(horizontal===otherHorizontal){
      const distance=horizontal?Math.abs(a.y-c.y):Math.abs(a.x-c.x);
      const start=horizontal?Math.max(amin,Math.min(c.x,d.x)):Math.max(amin,Math.min(c.y,d.y));
      const end=horizontal?Math.min(amax,Math.max(c.x,d.x)):Math.min(amax,Math.max(c.y,d.y));
      const overlap=Math.max(0,end-start);
      if(overlap>EPS){
        if(distance<EPS){
          // Same-net fan-outs remain legal; discourage long coincident runs.
          penalty+=overlap*(sameNet?3.5:90);
          if(sameNet)shared+=overlap;else conflict+=overlap;
        }
        else if(distance<12 && !sameNet)penalty+=overlap*9;
      }
    } else if(!sameNet){
      const h=horizontal?{a,b}:{a:c,b:d};
      const v=horizontal?{a:c,b:d}:{a,b};
      const xx=v.a.x,yy=h.a.y;
      if(between(h.a.x,xx,h.b.x)&&between(v.a.y,yy,v.b.y)){
        // A single clear crossing is better than a long coincident run.
        if(![a,b,c,d].some(p=>eq(p.x,xx)&&eq(p.y,yy)))penalty+=19;
      }
    }
  }
  return {penalty,conflict,shared};
}
const expanded=(rectangles,clearance)=>rectangles.map(r=>({
  x:norm(r.x-clearance),y:norm(r.y-clearance),w:norm(r.w+2*clearance),h:norm(r.h+2*clearance)
}));
/** Soft congestion cost: prefer corridors with room for later branches.
 * It NEVER changes electrical topology and never overrides collision checks.
 * We use only parallel proximity: a clean perpendicular crossing is legal.
 */
export function routeCongestion(points,rects=[],occupied=[],net='',clearance=0){
  if(!pathIsOrthogonal(points))return Infinity;
  let penalty=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],horizontal=eq(a.y,b.y);
    const axis=horizontal?'x':'y',fixed=horizontal?'y':'x';
    const lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]);
    for(const rect of rects){
      const min=horizontal?rect.x-clearance:rect.y-clearance;
      const max=horizontal?rect.x+rect.w+clearance:rect.y+rect.h+clearance;
      const shared=Math.max(0,Math.min(hi,max)-Math.max(lo,min));
      if(shared<=EPS)continue;
      const rlo=horizontal?rect.y-clearance:rect.x-clearance;
      const rhi=horizontal?rect.y+rect.h+clearance:rect.x+rect.w+clearance;
      const gap=a[fixed]<rlo?rlo-a[fixed]:a[fixed]>rhi?a[fixed]-rhi:0;
      if(gap<34)penalty+=shared*(34-gap)/34*0.74;
    }
    for(const line of occupied){
      const c=line.a,d=line.b;
      if(horizontal!==eq(c.y,d.y))continue;
      const gap=Math.abs(a[fixed]-c[fixed]);
      if(gap<EPS||gap>=42)continue; // Exact overlap belongs to segmentPenalty.
      const overlap=Math.max(0,Math.min(hi,Math.max(c[axis],d[axis]))-
        Math.max(lo,Math.min(c[axis],d[axis])));
      if(overlap>EPS)penalty+=overlap*(42-gap)/42*(line.net===net?0.22:0.54);
    }
  }
  return penalty;
}
function score(points,rects,occupied,net,policy={}){
  if(!pathIsOrthogonal(points))return null;
  let total=0,conflict=0,shared=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(!obstaclesClear(a,b,rects))return null;
    const occ=segmentPenalty(a,b,occupied,net);
    if(policy.forbidForeignOverlap&&occ.conflict>EPS)return null;
    total+=manhattan(a,b)+occ.penalty;
    conflict+=occ.conflict;
    shared+=occ.shared;
  }
  if(policy.preferSparse)total+=routeCongestion(points,rects,occupied,net);
  return {cost:total+Math.max(0,points.length-2)*19,conflict,shared};
}
const uniq=xs=>[...new Set(xs.filter(Number.isFinite).map(norm))].sort((a,b)=>a-b);
class Heap {
  constructor(){this.a=[];}
  push(item){const a=this.a;a.push(item);let i=a.length-1;while(i){let p=(i-1)>>1;if(a[p].f<=item.f)break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.a,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1].f<a[j].f)j++;if(a[j].f>=last.f)break;a[i]=a[j];i=j;}a[i]=last;}return first;}
  get length(){return this.a.length;}
}
function search(start,end,rects,occupied,net,policy={}){
  const margin=20;
  const xs=uniq([start.x,end.x,(start.x+end.x)/2,start.x-24,start.x+24,end.x-24,end.x+24,
    ...rects.flatMap(r=>[r.x,r.x+r.w,r.x-margin,r.x+r.w+margin]),
    ...occupied.flatMap(s=>[s.a.x,s.b.x,s.a.x-12,s.a.x+12,s.b.x-12,s.b.x+12])]);
  const ys=uniq([start.y,end.y,(start.y+end.y)/2,start.y-24,start.y+24,end.y-24,end.y+24,
    ...rects.flatMap(r=>[r.y,r.y+r.h,r.y-margin,r.y+r.h+margin]),
    ...occupied.flatMap(s=>[s.a.y,s.b.y,s.a.y-12,s.a.y+12,s.b.y-12,s.b.y+12])]);
  if(xs.length*ys.length>20000)return null;
  const w=xs.length,h=ys.length,id=(i,j)=>j*w+i,xy=n=>({x:xs[n%w],y:ys[Math.floor(n/w)]});
  const valid=new Uint8Array(w*h);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const p={x:xs[i],y:ys[j]};
    if(rects.every(r=>p.x<=r.x+EPS||p.x>=r.x+r.w-EPS||p.y<=r.y+EPS||p.y>=r.y+r.h-EPS))valid[id(i,j)]=1;
  }
  const from=id(xs.indexOf(norm(start.x)),ys.indexOf(norm(start.y)));
  const to=id(xs.indexOf(norm(end.x)),ys.indexOf(norm(end.y)));
  if(!valid[from]||!valid[to])return null;
  const distance=new Map(),parent=new Map(),heap=new Heap();
  const key=(n,dir)=>n*3+dir;const startKey=key(from,0);
  distance.set(startKey,0);heap.push({id:from,dir:0,k:startKey,g:0,f:manhattan(start,end)});
  let found=null,steps=0;
  while(heap.length&&steps++<110000){
    const cur=heap.pop();if(cur.g!==distance.get(cur.k))continue;
    if(cur.id===to){found=cur.k;break;}
    const i=cur.id%w,j=Math.floor(cur.id/w),p=xy(cur.id);
    for(const [di,dj,dir] of [[-1,0,1],[1,0,1],[0,-1,2],[0,1,2]]){
      const ii=i+di,jj=j+dj;if(ii<0||jj<0||ii>=w||jj>=h)continue;
      const next=id(ii,jj);if(!valid[next])continue;
      const q=xy(next);if(!obstaclesClear(p,q,rects))continue;
      const overlap=segmentPenalty(p,q,occupied,net);
      if(policy.forbidForeignOverlap&&overlap.conflict>EPS)continue;
      const crowd=policy.preferSparse?routeCongestion([p,q],rects,occupied,net):0;
      const g=cur.g+manhattan(p,q)+(cur.dir!==0&&cur.dir!==dir?19:0)+overlap.penalty+crowd;
      const k=key(next,dir);
      if(g>=(distance.get(k)??Infinity)-EPS)continue;
      distance.set(k,g);parent.set(k,cur.k);
      heap.push({id:next,dir,k,g,f:g+manhattan(q,end)});
    }
  }
  if(found===null)return null;
  const path=[];for(let k=found;k!==undefined;k=parent.get(k))path.push(xy(Math.floor(k/3)));
  return compactPath(path.reverse());
}
const direction={left:{x:-1,y:0},right:{x:1,y:0},top:{x:0,y:-1},bottom:{x:0,y:1}};
const inferSide=(a,b)=>Math.abs(a.x-b.x)>=Math.abs(a.y-b.y)?(a.x<=b.x?'right':'left'):(a.y<=b.y?'bottom':'top');
const opposite={left:'right',right:'left',top:'bottom',bottom:'top'};

/**
 * Route one pair of ports, considering other wires through options.occupied.
 * Endpoint 'any' is used by junction dots and does NOT introduce a stub.
 * options.occupied: [{a:{x,y}, b:{x,y}, net:string}]
 */
export function routeOrthogonal(start,end,rectangles=[],options={}){
  const clearance=options.clearance??14;
  const stubLength=Math.max(clearance+10,options.stubLength??30);
  const occupied=options.occupied||[],net=options.net??'';
  const policy={preferSparse:options.preferSparse===true,
    forbidForeignOverlap:options.forbidForeignOverlap===true};
  const sideA=start.side==='any'?null:(start.side||inferSide(start,end));
  const sideB=end.side==='any'?null:(end.side||opposite[inferSide(start,end)]);
  const da=sideA?direction[sideA]:null,db=sideB?direction[sideB]:null;
  const a=copyPoint(da?{x:start.x+da.x*stubLength,y:start.y+da.y*stubLength}:start);
  const b=copyPoint(db?{x:end.x+db.x*stubLength,y:end.y+db.y*stubLength}:end);
  const rects=expanded(rectangles,clearance);
  const x=(a.x+b.x)/2,y=(a.y+b.y)/2;
  const middleX=[a,{x,y:a.y},{x,y:b.y},b];
  const middleY=[a,{x:a.x,y},{x:b.x,y},b];
  const bothHorizontal=Boolean(sideA&&sideB&&['left','right'].includes(sideA)&&
    ['left','right'].includes(sideB));
  const bothVertical=Boolean(sideA&&sideB&&['top','bottom'].includes(sideA)&&
    ['top','bottom'].includes(sideB));
  // Equal-length doglegs are common. Prefer the centred bend over a corner
  // only 24–30 units from a pin. Collision and overlap scoring still decides.
  const candidates=[
    [a,b],
    ...(bothHorizontal?[middleX]:bothVertical?[middleY]:[]),
    [a,{x:b.x,y:a.y},b],
    [a,{x:a.x,y:b.y},b],
    ...(!bothHorizontal?[middleX]:[]),
    ...(!bothVertical?[middleY]:[])
  ];
  // Compare full visual turn counts, INCLUDING the two obligatory pin stubs.
  // Otherwise a bend 30 units from an input seems cheaper than an identical
  // two-bend route through the centre, merely because the stub's turn was
  // excluded from the local A* score.
  const visualScore=(points,stat)=>stat.cost-
    Math.max(0,points.length-2)*19+
    Math.max(0,compactPath([start,...points,end]).length-2)*19;
  let best=null,bestScore=Infinity,bestConflict=Infinity,bestShared=Infinity;
  for(const candidate of candidates){
    const points=compactPath(candidate),stat=score(points,rects,occupied,net,policy);
    if(stat&&visualScore(points,stat)<bestScore-EPS){
      best=points;bestScore=visualScore(points,stat);
      bestConflict=stat.conflict;bestShared=stat.shared;
    }
  }
  // The ordinary candidates may be collision-free yet reuse another wire for
  // a long distance. Try a grid detour then, not only on a different-net clash.
  if(best===null||bestConflict>EPS||bestShared>32||options.forceSearch===true){
    const found=search(a,b,rects,occupied,net,policy);
    if(found){const stat=score(found,rects,occupied,net,policy);
      if(stat&&visualScore(found,stat)<bestScore-EPS){
        best=found;bestScore=visualScore(found,stat);
        bestConflict=stat.conflict;bestShared=stat.shared;
      }
    }
  }
  const avoided=best!==null;
  if(!best)best=[a,{x:a.x,y:b.y},b];
  const points=compactPath([start,...best,end]);
  // Endpoint stubs can never be treated as independent electrical branches.
  const overlaps=points.slice(1).reduce((sum,p,i)=>sum+segmentPenalty(points[i],p,occupied,net).conflict,0);
  return {points,path:pointsToPath(points),avoided,overlaps};
}
/** Serialize a rendered route as occupied orthogonal segments for subsequent nets. */
export function occupiedSegments(points,net){
  const lines=[];
  for(let i=1;i<points.length;i++)if(!pointEq(points[i-1],points[i]))lines.push({a:points[i-1],b:points[i],net});
  return lines;
}

/** Reconnect a moved or rotated pin while preserving the rest of its original path. */
export function reanchorPath(points,newStart,newEnd){
  if(!pathIsOrthogonal(points))return null;
  const p=points.map(copyPoint);
  if(!pointEq(p[0],newStart)){
    const next=p[1],wasHorizontal=eq(p[0].y,next.y);
    p.splice(0,1,copyPoint(newStart),wasHorizontal?
      {x:newStart.x,y:next.y}:{x:next.x,y:newStart.y});
  }
  if(!pointEq(p[p.length-1],newEnd)){
    const last=p[p.length-1],prev=p[p.length-2],wasHorizontal=eq(last.y,prev.y);
    const bridge=wasHorizontal?{x:newEnd.x,y:prev.y}:{x:prev.x,y:newEnd.y};
    p.splice(p.length-1,1,bridge,copyPoint(newEnd));
  }
  const result=compactPath(p);
  return pathIsOrthogonal(result)?result:null;
}

/** Conservative alternatives for moving one endpoint of an EXISTING wire.
 *
 * Unlike routeOrthogonal (which draws a new wire), these retain the old path
 * from the nearest feasible anchor to the fixed endpoint. A pre-existing
 * crossing is part of the player's arrangement, not a reason to redraw it.
 * The caller still checks components / *new* foreign-net coincidence before
 * accepting any geometry. Pure function; safe to use during drag previews.
 */
export function junctionReanchorCandidates(outward,newJunction,{maxAnchors=7,maxSpan=580}={}){
  if(!pathIsOrthogonal(outward)||!newJunction||
     !Number.isFinite(newJunction.x)||!Number.isFinite(newJunction.y))return [];
  const original=outward.map(copyPoint),at=copyPoint(newJunction);
  const end=original[original.length-1],results=[],seen=new Set();
  const add=(raw,preservedFrom,kind)=>{
    const path=compactPath(raw);
    if(!pathIsOrthogonal(path)||!pointEq(path[0],at)||
       !pointEq(path.at(-1),end))return;
    const key=JSON.stringify(path);
    if(seen.has(key))return;
    seen.add(key);results.push({points:path,preservedFrom,kind});
  };
  if(pointEq(at,original[0]))add(original,0,'unchanged');
  const first=reanchorPath(original,at,end);
  if(first)add(first,1,'preserve-first-bend');
  let walked=0;
  for(let k=1;k<original.length&&k<=maxAnchors;k++){
    walked+=manhattan(original[k-1],original[k]);
    if(walked>maxSpan&&k>2)break;
    const anchor=original[k],tail=original.slice(k+1);
    // The far-end suffix is untouched. Only the lead-in to the anchor moves.
    add([at,{x:at.x,y:anchor.y},anchor,...tail],k,'join-horizontal');
    add([at,{x:anchor.x,y:at.y},anchor,...tail],k,'join-vertical');
    // Attach at the closest point on the preceding segment. This preserves
    // a long hand-authored trunk when dragging its junction along that trunk.
    const projected=projectToPath(at,[original[k-1],anchor]);
    if(projected){
      const p=projected.point;
      add([at,{x:at.x,y:p.y},p,anchor,...tail],k,'project-horizontal');
      add([at,{x:p.x,y:at.y},p,anchor,...tail],k,'project-vertical');
    }
  }
  return results;
}

/** Length of collinear overlap with unrelated electrical nets. */
export function unrelatedOverlap(points,occupied,net){
  if(!pathIsOrthogonal(points))return Infinity;
  return points.slice(1).reduce((sum,p,i)=>sum+segmentPenalty(points[i],p,occupied,net).conflict,0);
}
/** Total length shared with any existing copper, regardless of its electrical
 * net. Useful for comparing valid alternative routes (never for determining
 * whether two circuits are electrically connected).
 */
export function collinearOverlap(points,occupied){
  if(!pathIsOrthogonal(points))return Infinity;
  return points.slice(1).reduce((sum,p,i)=>{
    const hit=segmentPenalty(points[i],p,occupied,null);
    return sum+hit.conflict+hit.shared;
  },0);
}

/**
 * Electrical junction markers are derived from NETLIST ENDPOINTS, never from
 * visual line intersections.  An explicit junction component already paints
 * its own dot; here we add dots for a pin shared by two or more distinct wires.
 * Separate components (even at identical coordinates) remain separate nets.
 */
export function electricalJunctionPoints(components,wires,pinPosition){
  const byId=new Map((components||[]).map(c=>[c.id,c]));
  const connections=new Map(),seen=new Set();
  for(const wire of wires||[]){
    if(!wire?.from||!wire?.to)continue;
    const id=e=>`${e.comp}:${e.pin}`;
    const key=[id(wire.from),id(wire.to)].sort().join('|');
    if(seen.has(key))continue;
    seen.add(key);
    for(const end of [wire.from,wire.to]){
      const component=byId.get(end.comp);
      if(!component||component.type==='junction')continue;
      const k=id(end);
      const record=connections.get(k)||{component,pin:end.pin,count:0};
      record.count++;
      connections.set(k,record);
    }
  }
  const result=[];
  for(const {component,pin,count} of connections.values()){
    if(count<2)continue;
    const point=pinPosition(component,pin);
    if(point&&Number.isFinite(point.x)&&Number.isFinite(point.y))
      result.push({x:point.x,y:point.y,componentId:component.id,pin,count});
  }
  return result;
}
