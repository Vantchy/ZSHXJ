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

/** Removes duplicate points, redundant collinear bends and immediate U-turn loops.
 * Unlike the previous version, NEVER erases a bend that doubles back past its neighbors.
 */
export function compactPath(points) {
  const result=[];
  for(const raw of points||[]){
    if(!raw||!Number.isFinite(Number(raw.x))||!Number.isFinite(Number(raw.y)))continue;
    const p=copyPoint(raw);
    if(result.length && pointEq(result[result.length-1],p))continue;
    result.push(p);
    let again=true;
    while(again&&result.length>=3){
      again=false;
      const [a,b,c]=result.slice(-3);
      if(pointEq(a,c)) {result.splice(result.length-2,2);again=true;continue;}
      if((eq(a.x,b.x)&&eq(b.x,c.x)&&between(a.y,b.y,c.y))||
         (eq(a.y,b.y)&&eq(b.y,c.y)&&between(a.x,b.x,c.x))){
        result.splice(result.length-2,1);again=true;
      }
    }
  }
  return result;
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

/** Geometrical collision score for different electrical nets.
 * Shared endpoints are okay; same-net shared stubs are tolerated.
 * Independent nets on the same segment receive a prohibitive cost.
 */
function segmentPenalty(a,b,occupied,ownNet){
  let penalty=0,conflict=0;
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
        if(distance<EPS){penalty+=overlap*(sameNet?0.2:90); if(!sameNet)conflict+=overlap;}
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
  return {penalty,conflict};
}
const expanded=(rectangles,clearance)=>rectangles.map(r=>({
  x:norm(r.x-clearance),y:norm(r.y-clearance),w:norm(r.w+2*clearance),h:norm(r.h+2*clearance)
}));
function score(points,rects,occupied,net){
  if(!pathIsOrthogonal(points))return null;
  let total=0,conflict=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(!obstaclesClear(a,b,rects))return null;
    const occ=segmentPenalty(a,b,occupied,net);
    total+=manhattan(a,b)+occ.penalty;
    conflict+=occ.conflict;
  }
  return {cost:total+Math.max(0,points.length-2)*19,conflict};
}
const uniq=xs=>[...new Set(xs.filter(Number.isFinite).map(norm))].sort((a,b)=>a-b);
class Heap {
  constructor(){this.a=[];}
  push(item){const a=this.a;a.push(item);let i=a.length-1;while(i){let p=(i-1)>>1;if(a[p].f<=item.f)break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.a,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1].f<a[j].f)j++;if(a[j].f>=last.f)break;a[i]=a[j];i=j;}a[i]=last;}return first;}
  get length(){return this.a.length;}
}
function search(start,end,rects,occupied,net){
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
      const g=cur.g+manhattan(p,q)+(cur.dir!==0&&cur.dir!==dir?19:0)+segmentPenalty(p,q,occupied,net).penalty;
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
  const sideA=start.side==='any'?null:(start.side||inferSide(start,end));
  const sideB=end.side==='any'?null:(end.side||opposite[inferSide(start,end)]);
  const da=sideA?direction[sideA]:null,db=sideB?direction[sideB]:null;
  const a=copyPoint(da?{x:start.x+da.x*stubLength,y:start.y+da.y*stubLength}:start);
  const b=copyPoint(db?{x:end.x+db.x*stubLength,y:end.y+db.y*stubLength}:end);
  const rects=expanded(rectangles,clearance);
  const x=(a.x+b.x)/2,y=(a.y+b.y)/2;
  const candidates=[
    [a,b],
    [a,{x:b.x,y:a.y},b],
    [a,{x:a.x,y:b.y},b],
    [a,{x,y:a.y},{x,y:b.y},b],
    [a,{x:a.x,y},{x:b.x,y},b]
  ];
  let best=null,bestScore=Infinity,bestConflict=Infinity;
  for(const candidate of candidates){
    const points=compactPath(candidate),stat=score(points,rects,occupied,net);
    if(stat&&stat.cost<bestScore){best=points;bestScore=stat.cost;bestConflict=stat.conflict;}
  }
  // Search when straight candidates overlap another net or no simple path exists.
  if(best===null||bestConflict>EPS){
    const found=search(a,b,rects,occupied,net);
    if(found){const stat=score(found,rects,occupied,net);
      if(stat&&stat.cost<bestScore){best=found;bestScore=stat.cost;bestConflict=stat.conflict;}
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

/** Length of collinear overlap with unrelated electrical nets. */
export function unrelatedOverlap(points,occupied,net){
  if(!pathIsOrthogonal(points))return Infinity;
  return points.slice(1).reduce((sum,p,i)=>sum+segmentPenalty(points[i],p,occupied,net).conflict,0);
}
