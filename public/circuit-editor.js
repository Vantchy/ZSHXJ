import { transitionEditorMode, checkConnection } from "./circuit-interactions.js";
import { routeOrthogonal, compactPath, pointsToPath, pathIsOrthogonal, projectToPath, splitPathAt, shiftSegment, reanchorPath, pathHitsObstacles, occupiedSegments, unrelatedOverlap, collinearOverlap, junctionReanchorCandidates, electricalJunctionPoints, firstSharedNetworkOverlap, nearbyTrunkTaps, routeCongestion, nearParallelForkCandidates } from "./circuit-routing.js";
import { liveDraftPath, commitDraftWaypoint, assessDraftPath, alignFixedWaypoints } from "./circuit-drafting.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const LABELS = {
  input:"输入开关", output:"输出灯", vdd:"电源", gnd:"地", junction:"接点",
  nmos:"NMOS", pmos:"PMOS", not:"非门", nand:"与非门", nor:"或非门",
  and:"与门", or:"或门", xor:"异或门", xnor:"同或门", mux2:"二选一选择器",
  sr_latch:"SR锁存器", dff:"D触发器"
};
const FAMILY_ORDER = ["input","output","vdd","gnd","junction","nmos","pmos","not","nand","nor","and","or","xor","xnor","mux2","sr_latch","dff"];
const $ = (tag, cls, parent, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.append(n);
  return n;
};
const svgEl = (tag, attrs={}, parent) => {
  const n = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k,v]) => n.setAttribute(k, String(v)));
  if (parent) parent.append(n);
  return n;
};
const deep = x => JSON.parse(JSON.stringify(x));

export const mount = async ctx => {
  const {container, api, chapter, level, state, saveProgress, exit, signal} = ctx;
  const levelId = level.id;
  const registryReply = await api("GET", "/api/circuit/components");
  if (signal?.aborted) return;
  container.setAttribute('data-level-description', level.description || '');
  const registry = registryReply.types || {};
  const packages = registryReply.packages || [];
  const packageByType = new Map(packages.map(p => [p.type,p]));
  const shapes = type => {
    if (registry[type]) return registry[type];
    const pkg = packageByType.get(type);
    return pkg ? {name:pkg.name,family:"package",pins:pkg.pins} : {name:type,family:"package",pins:[]};
  };
  const allowed = new Set(level.allowedTypes || []);
  const allowedPackages = new Set(level.allowedPackages || []);
  const paletteTypes = FAMILY_ORDER.filter(t => allowed.has(t));
  const palettePackages = packages.filter(p => allowedPackages.has(p.symbol) && p.isCurrent);
  const saved = state.circuitLevels?.[levelId];
  let graph = deep(saved?.graph || level.initialGraph || {schemaVersion:1,components:[],wires:[]});
  let simState = deep(saved?.simulationState || {});
  let inputValues = {};
  let pinValues = {};
  let outputValues = {};
  let selected = null;
  let selectedPalette = null;
  let wireStart = null;
  // Temporary, user-authored path; only a completed connection changes graph.wires.
  let draftPoints = [];
  let horizontalFirst = true;
  let hoverEndpoint = null;
  let hoverWire = null;
  let pointerWorld = null;
  // An explicit 'insert junction' mode never mutates topology before the user
  // points to the desired position. Geometry is versioned separately from the
  // schema-1 electrical netlist (which remains authoritative for evaluation).
  let tapWireKey = null;
  let tapPreview = null;
  const routeCache = new Map();
  const undoStack = [], redoStack = [];
  let committedGraph = deep(graph);
  const endpointId = p => `${p.comp}:${p.pin}`;
  const wireKey = w => [endpointId(w.from),endpointId(w.to)].sort().join('|');
  const ensureEditorLayout = () => {
    if (!graph.editorLayout || graph.editorLayout.version !== 1 ||
        !graph.editorLayout.paths || typeof graph.editorLayout.paths !== 'object' ||
        Array.isArray(graph.editorLayout.paths)) graph.editorLayout = {version:1,paths:{}};
    if(!graph.editorLayout.manualPaths || typeof graph.editorLayout.manualPaths !== "object")
      graph.editorLayout.manualPaths={};
    return graph.editorLayout.paths;
  };
  ensureEditorLayout();
  let zoom = 1, panX = 0, panY = 0;
  // A finite 7200 × 4500 work surface supports advanced circuits.
  // Its minimum zoom is calculated from the surface size, so even at the
  // smallest scale there is NEVER a visible outer margin or paper frame.
  const VIEW_WIDTH=1600, VIEW_HEIGHT=1000, MAX_ZOOM=2;
  const COMPONENT_PADDING=84, GRID_STEP=12;
  const workspace={minX:-2800,minY:-1750,maxX:4400,maxY:2750};
  let drag = null;
  let contextMenu = null;
  let dirty = false; // merely opening a level is not an unsaved change
  let submitting = false;
  let best = null;
  let resultData = null;
  let lastSimError = null;
  let simWarnings = [];
  let blockedRoutes = 0;
  let simTimer = 0;
  let previewRaf = 0;
  let junctionDragRaf = 0;
  let junctionDragTimer = 0;
  let simEpoch = 0; // only newest request updates visual status
  let simGeneration = 0; // topology changes or reset invalidate old requests
  let simQueue = Promise.resolve(); // serialize input switch ticks to preserve latch memory
  let changeSerial = 0; // keep unsaved edits dirty if saving overlaps an edit
  let saveInProgress = null;
  let disposed = false;

  const host = container;
  host.classList.add("circuit-editor-host");
  const top = $("section","ce-top",host);
  const heading = $("div","ce-heading",top);
  const titleWrap = $("div","",heading);
  $("p","ce-kicker",titleWrap,`${chapter.title} · ${level.layer === "transistor" ? "晶体管层" : level.layer === "gate" ? "逻辑门层" : "时序逻辑层"}`);
  $("h2","",titleWrap,level.title);
  $("p","ce-objective",titleWrap,level.description || `搭建电路，使 ${level.interface.inputs.map(x=>x.name).join("、")} 对应正确的 ${level.interface.outputs.map(x=>x.name).join("、")} 输出。`);
  const bestText=$("p","ce-best",heading,"最佳记录：读取中…");
  const actions=$("div","ce-actions",top);
  const saveBtn=$("button","ce-button ce-button--primary",actions,"保存进度");
  const runBtn=$("button","ce-button",actions,"▶ 运行电路");
  const submitBtn=$("button","ce-button ce-button--accent",actions,"提交评测");
  const clearBtn=$("button","ce-button",actions,"清空画布");
  const backBtn=$("button","ce-button",actions,ctx.returnLabel || "返回关卡列表");

  const feedback=$("p","ce-feedback",host);
  feedback.setAttribute("role","status");
  feedback.setAttribute("aria-live","polite");
  feedback.textContent="拖入元件，点击数字 0/1 切换输入；点击端子画线，移动鼠标预览，单击固定拐点。空格切方向，Esc 取消。";
  feedback.title=feedback.textContent;
  const layout=$("div","ce-layout",host);
  const palette=$("aside","ce-palette",layout);
  $("h3","ce-section-title",palette,"元件道具栏");
  const builtinGroup=$("div","ce-palette-group",palette);
  $("h4","",builtinGroup,"本层元件");
  const paletteList=$("div","ce-palette-list",builtinGroup);
  const pkgGroup=palettePackages.length ? $("div","ce-palette-group",palette) : null;
  if (pkgGroup) { $("h4","",pkgGroup,"我的封装"); }
  const pkgList=pkgGroup ? $("div","ce-palette-list",pkgGroup) : null;

  const stage=$("main","ce-stage",layout);
  const toolbar=$("div","ce-toolbar",stage);
  const toolHint=$("span","ce-toolbar-label",toolbar,"接线编辑");
  const undoBtn=$("button","ce-icon-button",toolbar,"↶ 撤销");
  const redoBtn=$("button","ce-icon-button",toolbar,"↷ 重做");
  const directionBtn=$("button","ce-icon-button ce-dir-toggle",toolbar,"横向优先");
  directionBtn.title="接线中按空格键切换转弯方向";
  const deleteBtn=$("button","ce-icon-button ce-tool-danger",toolbar,"删除选中");
  deleteBtn.title="删除当前元件或连线（Delete）";
  deleteBtn.disabled=true;
  undoBtn.disabled=true;redoBtn.disabled=true;
  const toolSpacer=$("span","ce-toolbar-spacer",toolbar);
  const zoomOut=$("button","ce-icon-button",toolbar,"−");
  const zoomLabel=$("span","ce-zoom-label",toolbar,"100%");
  const zoomIn=$("button","ce-icon-button",toolbar,"＋");
  const fitBtn=$("button","ce-icon-button",toolbar,"定位电路");
  const canvasWrap=$("div","ce-canvas-wrap",stage);
  const svg=svgEl("svg",{class:"ce-canvas",viewBox:"0 0 1600 1000",
    preserveAspectRatio:"xMidYMid slice",role:"img","aria-label":"电路设计画布"},canvasWrap);
  const defs=svgEl("defs",{},svg);
  const pattern=svgEl("pattern",{id:"ce-grid",width:24,height:24,patternUnits:"userSpaceOnUse"},defs);
  svgEl("circle",{cx:2,cy:2,r:1.15,class:"ce-grid-dot"},pattern);
  const world=svgEl("g",{class:"ce-world"},svg);
  // The paper and grid move together. The workspace remains bounded in
  // world coordinates, but its outer edge is never drawn on screen.
  const paper=svgEl("rect",{class:"ce-workspace-paper","pointer-events":"none"},world);
  const paperGrid=svgEl("rect",{class:"ce-workspace-grid",fill:"url(#ce-grid)",
    "pointer-events":"none"},world);
  const wiresLayer=svgEl("g",{class:"ce-wires"},world);
  const previewLayer=svgEl("g",{class:"ce-wire-preview","pointer-events":"none"},world);
  const compsLayer=svgEl("g",{class:"ce-components"},world);
  // The drag ghost is deliberately independent of the main renderer. Pointer
  // motion must never run full-circuit A* searches or replace the entire SVG.
  const junctionDragLayer=svgEl("g",{class:"ce-junction-drag-overlay",
    "pointer-events":"none","aria-hidden":"true"},world);
  const right=$("aside","ce-inspector",layout);
  $("h3","ce-section-title",right,"状态与提示");
  const detail=$("section","ce-detail",right);
  const warnings=$("section","ce-warnings",right);
  const legend=$("section","ce-legend",right);
  $("h4","",legend,"电平图例");
  const highLegend=$("p","ce-legend-item ce-high",legend,"● 高电平（1）");
  const lowLegend=$("p","ce-legend-item ce-low",legend,"● 低电平（0）");
  $("p","ce-legend-item ce-unknown",legend,"◆ 未知 / 冲突（X）");
  $("p","ce-legend-item ce-floating",legend,"○ 悬空 / 高阻（Z）");
  const resetSim=$("button","ce-button",right,"复位模拟");
  const result=$("section","ce-result",host);
  result.hidden=true;

  const pinInfo=(type,name)=>shapes(type).pins.find(p=>p.name===name);
  const pinLookup = endpoint => {
    const component=graph.components.find(c=>c.id===endpoint.comp);
    return component ? pinInfo(component.type,endpoint.pin) : null;
  };
  const status=(message,kind="info")=>{
    feedback.textContent=message;
    feedback.title=message; // full text remains available when status bar is truncated
    feedback.dataset.kind=kind;
  };
  /** 所有 UI 入口通过同一模式转换，禁止放置与连线状态并存。 */
  function intent(type,value=null){
    const transition=transitionEditorMode(
      {palette:selectedPalette,pin:wireStart,selection:selected},
      {type,value});
    selectedPalette=transition.state.palette;
    wireStart=transition.state.pin;
    selected=transition.state.selection;
    palette.querySelectorAll(".ce-palette-item").forEach(item=>{
      const active=item.dataset.type===selectedPalette;
      item.classList.toggle("is-active",active);
      item.setAttribute("aria-pressed",String(active));
    });
    if (type !== "SELECT" && type !== "WIRE_DONE" && type !== "PLACED") {
      tapWireKey=null;tapPreview=null;
    }
    if(!wireStart){draftPoints=[];hoverEndpoint=null;hoverWire=null;}
    stage.dataset.mode=tapWireKey?"junction":wireStart?"wire":selectedPalette?"place":"select";
    deleteBtn.disabled=!selected;
    undoBtn.disabled=!undoStack.length; redoBtn.disabled=!redoStack.length;
    toolHint.textContent=tapWireKey?"选择接点位置":wireStart?"实时布线 · 单击固定拐点":selectedPalette?"放置元件":"接线编辑";
    return transition.effect;
  }
  function recordHistory(){
    const next=JSON.stringify(graph);
    if(next!==JSON.stringify(committedGraph)){
      undoStack.push(committedGraph);if(undoStack.length>70)undoStack.shift();
      committedGraph=deep(graph);redoStack.length=0;
    }
    undoBtn.disabled=!undoStack.length;redoBtn.disabled=!redoStack.length;
  }
  function markChanged({resetState=true}={}){
    recordHistory();routeCache.clear();
    changeSerial++;
    simGeneration++;
    dirty=true;
    result.hidden=true; // prior submission is not the score of the edited graph
    pinValues={};outputValues={};simWarnings=[];lastSimError=null;
    if(resetState) simState={};
  }
  function markGeometryChanged(){
    recordHistory();routeCache.clear();changeSerial++;dirty=true;
  }
  const nodeById=()=>new Map(graph.components.map(c=>[c.id,c]));
  const baseDims=comp=>{
    const shape=shapes(comp.type);
    if (comp.type==="junction") return {w:28,h:28};
    const n=Math.max(shape.pins.filter(p=>p.direction==="in").length,
                     shape.pins.filter(p=>p.direction==="out").length);
    const w=comp.type==="input"||comp.type==="output"?128:
      comp.type==="vdd"||comp.type==="gnd"?116:156;
    return {w,h:Math.max(76,n*28+34)};
  };
  const dims=comp=>{
    const base=baseDims(comp),rotation=comp.rotation||0;
    return rotation%180===90?{w:base.h,h:base.w}:base;
  };
  // Old saves may already contain components outside the new default sheet.
  // Enlarge ONCE to fit those saved components without moving or losing data.
  for(const c of graph.components){
    if(!Number.isFinite(c.x)||!Number.isFinite(c.y))continue;
    const box=dims(c);
    workspace.minX=Math.min(workspace.minX,Math.floor((c.x-420)/GRID_STEP)*GRID_STEP);
    workspace.minY=Math.min(workspace.minY,Math.floor((c.y-420)/GRID_STEP)*GRID_STEP);
    workspace.maxX=Math.max(workspace.maxX,Math.ceil((c.x+box.w+420)/GRID_STEP)*GRID_STEP);
    workspace.maxY=Math.max(workspace.maxY,Math.ceil((c.y+box.h+420)/GRID_STEP)*GRID_STEP);
  }
  for(const rect of [paper,paperGrid]){
    rect.setAttribute("x",workspace.minX);
    rect.setAttribute("y",workspace.minY);
    rect.setAttribute("width",workspace.maxX-workspace.minX);
    rect.setAttribute("height",workspace.maxY-workspace.minY);
  }
  const restrictComponent=(comp,x,y)=>{
    const {w,h}=dims(comp);
    const minX=Math.ceil((workspace.minX+COMPONENT_PADDING)/GRID_STEP)*GRID_STEP;
    const minY=Math.ceil((workspace.minY+COMPONENT_PADDING)/GRID_STEP)*GRID_STEP;
    const maxX=Math.floor((workspace.maxX-w-COMPONENT_PADDING)/GRID_STEP)*GRID_STEP;
    const maxY=Math.floor((workspace.maxY-h-COMPONENT_PADDING)/GRID_STEP)*GRID_STEP;
    return {x:Math.max(minX,Math.min(maxX,Math.round(x/GRID_STEP)*GRID_STEP)),
      y:Math.max(minY,Math.min(maxY,Math.round(y/GRID_STEP)*GRID_STEP))};
  };
  const withinWorkspace=point=>point&&
    point.x>=workspace.minX&&point.x<=workspace.maxX&&
    point.y>=workspace.minY&&point.y<=workspace.maxY;
  // Cover, not "contain": the lowest scale makes the paper fill the whole
  // viewport, and higher scales allow panning only while paper still covers it.
  // The default 7200x4500 sheet fits exactly at 2/9 (≈22.2%).
  const minZoom=()=>Math.max(
    VIEW_WIDTH/(workspace.maxX-workspace.minX),
    VIEW_HEIGHT/(workspace.maxY-workspace.minY));
  const constrainPan=()=>{
    const clampAxis=(value,screen,min,max)=>{
      const low=screen-zoom*max,high=-zoom*min;
      if(low>high)return (low+high)/2; // floating point rounding safeguard
      return Math.max(low,Math.min(high,value));
    };
    panX=clampAxis(panX,VIEW_WIDTH,workspace.minX,workspace.maxX);
    panY=clampAxis(panY,VIEW_HEIGHT,workspace.minY,workspace.maxY);
  };
  const zoomText=()=>`${Number((zoom*100).toFixed(1))}%`;

  const rotateVector=(x,y,rotation)=>{
    if(rotation===90)return {x:-y,y:x};
    if(rotation===180)return {x:-x,y:-y};
    if(rotation===270)return {x:y,y:-x};
    return {x,y};
  };
  const rotateSide=(side,rotation)=>{
    const order=["right","bottom","left","top"];
    return side==="any"?side:order[(order.indexOf(side)+rotation/90)%4];
  };
  const getPinPoint=(comp,pin)=>{
    const base=baseDims(comp),box=dims(comp);
    if(comp.type==="junction")return {x:comp.x+box.w/2,y:comp.y+box.h/2,side:"any"};
    const shape=shapes(comp.type),inputs=shape.pins.filter(p=>p.direction==="in"),
      outputs=shape.pins.filter(p=>p.direction==="out");
    const group=pin.direction==="in"?inputs:outputs;
    const index=group.findIndex(p=>p.name===pin.name);
    let px=pin.direction==="in"?0:base.w;
    let py=base.h/2+(index-(group.length-1)/2)*28;
    let side=pin.direction==="in"?"left":"right";
    // The electrical endpoint is the visible end of the circuit symbol's lead,
    // never an invisible corner of an enclosing UI card.
    if((comp.type==="nmos"||comp.type==="pmos")&&pin.name==="gate"){
      px=0;py=base.h/2;side="left";
    }else if((comp.type==="nmos"||comp.type==="pmos")&&pin.name==="source"){
      px=base.w/2+34;py=0;side="top";
    }else if((comp.type==="nmos"||comp.type==="pmos")&&pin.name==="drain"){
      px=base.w/2+34;py=base.h;side="bottom";
    }else if(comp.type==="vdd"){
      px=base.w/2;py=base.h;side="bottom";
    }else if(comp.type==="gnd"){
      px=base.w/2;py=0;side="top";
    }
    const rotation=comp.rotation||0;
    const vec=rotateVector(px-base.w/2,py-base.h/2,rotation);
    return {x:comp.x+box.w/2+vec.x,y:comp.y+box.h/2+vec.y,
            side:rotateSide(side,rotation)};
  };
  const toWorld=e=>{
    const p=svg.createSVGPoint(); p.x=e.clientX; p.y=e.clientY;
    const m=world.getScreenCTM(); return m ? p.matrixTransform(m.inverse()) : {x:0,y:0};
  };

  // Snap distances are measured in on-screen pixels, not SVG viewBox units.
  // This keeps terminals usable when the whole 1600x1000 canvas is scaled down.
  const PIN_START_SNAP_PX=10;
  const PIN_FINISH_SNAP_PX=12;
  const WIRE_SNAP_PX=9;
  const SNAP_TIE_PX=2.5;
  const worldUnitsPerScreenPixel=()=>{
    const matrix=world.getScreenCTM();
    const scale=matrix?Math.hypot(matrix.a??1,matrix.b??0):zoom;
    return 1/Math.max(scale,0.0001);
  };
  const pinSnapAt=(point,maxPx=PIN_FINISH_SNAP_PX,target=null)=>{
    if(!point)return null;
    const explicit=target?.closest?.("[data-pin-comp]");
    if(explicit){
      const component=nodeById().get(explicit.dataset.pinComp);
      const pin=component&&pinInfo(component.type,explicit.dataset.pin);
      if(pin){
        const position=getPinPoint(component,pin);
        return {endpoint:{comp:component.id,pin:pin.name},
          point:position,side:position.side,distance:0,explicit:true};
      }
    }
    const unit=worldUnitsPerScreenPixel(),radius=maxPx*unit;
    let best=null,second=Infinity;
    for(const comp of graph.components){
      const allPins=shapes(comp.type).pins||[];
      // Historical junction pins a/b/c/d/out have one *visible* terminal.
      const pins=comp.type==="junction"?allPins.filter(p=>p.name==="out"):allPins;
      for(const pin of pins){
        const position=getPinPoint(comp,pin);
        const distance=Math.hypot(position.x-point.x,position.y-point.y);
        if(distance>radius)continue;
        if(!best||distance<best.distance){
          if(best)second=Math.min(second,best.distance);
          best={endpoint:{comp:comp.id,pin:pin.name},point:position,
            side:position.side,distance};
        }else second=Math.min(second,distance);
      }
    }
    // Close, equally plausible terminals must not silently choose the wrong pin.
    return best&&second-best.distance>SNAP_TIE_PX*unit?best:null;
  };
  const wireSnapAt=(point,onlyIndex=null)=>{
    if(!point)return null;
    const unit=worldUnitsPerScreenPixel(),radius=WIRE_SNAP_PX*unit;
    let best=null,second=Infinity;
    graph.wires.forEach((wire,index)=>{
      if(onlyIndex!==null&&index!==onlyIndex)return;
      const projected=projectToPath(point,getWireLayout(wire,index).points);
      if(!projected||projected.distance>radius)return;
      if(!best||projected.distance<best.distance){
        if(best)second=Math.min(second,best.distance);
        best={index,point:projected.point,distance:projected.distance};
      }else second=Math.min(second,projected.distance);
    });
    // A visual crossing does not imply an electrical junction.
    return best&&second-best.distance>SNAP_TIE_PX*unit?best:null;
  };
  const wiringSnapAt=(point,target=null,altKey=false)=>{
    const pin=altKey?null:pinSnapAt(point,PIN_FINISH_SNAP_PX,target);
    const wire=wireSnapAt(point);
    const unit=worldUnitsPerScreenPixel();
    // A directly clicked or visibly close terminal wins over a nearby wire.
    if(pin&&(pin.explicit||!wire||pin.distance<=6*unit||pin.distance<=wire.distance+2*unit))
      return {pin,wire:null};
    return {pin:null,wire};
  };
  function electricalNets(){
    // Union-find includes the five equivalent pins of a junction component.
    const parent=new Map();
    const find=x=>{if(!parent.has(x))parent.set(x,x);const p=parent.get(x);
      if(p!==x)parent.set(x,find(p));return parent.get(x);};
    const union=(a,b)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent.set(rb,ra);};
    graph.components.filter(c=>c.type==="junction").forEach(c=>{
      const pins=shapes(c.type).pins;
      for(const pin of pins)union(`${c.id}:out`,`${c.id}:${pin.name}`);
    });
    graph.wires.forEach(w=>union(endpointId(w.from),endpointId(w.to)));
    return {ids:graph.wires.map(w=>find(endpointId(w.from))),
      endpointNet:p=>find(endpointId(p))};
  }
  const electricalNetIds=()=>electricalNets().ids;
  function wireEndpoints(wire,nodes=nodeById()){
    const a=nodes.get(wire.from.comp),b=nodes.get(wire.to.comp);
    const ap=a&&pinInfo(a.type,wire.from.pin),bp=b&&pinInfo(b.type,wire.to.pin);
    return a&&b&&ap&&bp?{a:getPinPoint(a,ap),b:getPinPoint(b,bp)}:null;
  }
  const sameXY=(a,b)=>a&&b&&Math.abs(a.x-b.x)<0.01&&Math.abs(a.y-b.y)<0.01;
  function ensureRoutes(){
    if(routeCache.size===graph.wires.length &&
       graph.wires.every(w=>routeCache.has(wireKey(w))))
      return graph.wires.map(w=>routeCache.get(wireKey(w)));
    const paths=ensureEditorLayout(),nodes=nodeById();
    const nets=electricalNetIds();const occupied=[];const layouts=[];
    const allObstacles=graph.components.filter(c=>c.type!=="junction")
      .map(c=>({id:c.id,x:c.x,y:c.y,...dims(c)}));
    graph.wires.forEach((w,i)=>{
      const key=wireKey(w),ends=wireEndpoints(w,nodes);
      if(!ends){layouts.push({points:[],path:"",avoided:false,overlaps:0});return;}
      let points=paths[key];
      const otherObstacles=allObstacles.filter(c=>c.id!==w.from.comp&&c.id!==w.to.comp);
      if(pathIsOrthogonal(points)){
        points=compactPath(points);
        if(!sameXY(points[0],ends.a)||!sameXY(points[points.length-1],ends.b))
          points=reanchorPath(points,ends.a,ends.b);
        // The player owns a manually drawn path. Never silently reroute it.
        if(points && !graph.editorLayout.manualPaths[key] && drag?.kind!=="component" &&
          (pathHitsObstacles(points,otherObstacles,10) || unrelatedOverlap(points,occupied,nets[i])>0))points=null;
      } else points=null;
      if(!points){
        const generated=routeOrthogonal(ends.a,ends.b,allObstacles.map(({id,...r})=>r),{occupied,net:nets[i]});
        points=generated.points;
      }
      paths[key]=points;
      const overlap=occupiedSegments(points,nets[i]);
      const overlapCount=unrelatedOverlap(points,occupied,nets[i]);
      const layout={points,path:pointsToPath(points),avoided:!pathHitsObstacles(points,otherObstacles,0),overlaps:overlapCount};
      occupied.push(...overlap);
      layouts.push(layout);
      routeCache.set(key,layout);
    });
    // Do not carry orphan geometry across deletions or edge rewrites.
    const active=new Set(graph.wires.map(wireKey));
    for(const key of Object.keys(paths))if(!active.has(key)){
      delete paths[key];delete graph.editorLayout.manualPaths[key];
    }
    return layouts;
  }
  const getWireLayout=(wire,index)=>routeCache.get(wireKey(wire)) || ensureRoutes()[index] ||
    {path:"",points:[],avoided:false};
  function insertWirePath(w,points){
    ensureEditorLayout()[wireKey(w)]=compactPath(points);
    graph.editorLayout.manualPaths[wireKey(w)]=true;
    routeCache.clear();
  }
  const setWorldTransform=()=>{
    constrainPan();
    const spacing=zoom<.35?96:zoom<.7?48:24;
    pattern.setAttribute("width",spacing);
    pattern.setAttribute("height",spacing);
    world.setAttribute("transform",`translate(${panX} ${panY}) scale(${zoom})`);
  };
  // One lightweight menu for both object types. It lives in the unscaled
  // canvas wrapper, so zooming never shrinks the buttons or moves their hitbox.
  const closeContextMenu=()=>{
    if(!contextMenu)return;
    contextMenu.remove();
    contextMenu=null;
  };
  const onContextPointerDown=e=>{
    if(contextMenu&&!contextMenu.contains(e.target))closeContextMenu();
  };
  const onContextViewportChange=()=>closeContextMenu();
  host.addEventListener("pointerdown",onContextPointerDown,true);
  window.addEventListener("resize",onContextViewportChange);

  function showContextMenu(e,target){
    closeContextMenu();
    const menu=$("div","ce-context-menu",canvasWrap);
    contextMenu=menu;
    menu.setAttribute("role","menu");
    menu.setAttribute("aria-label",target.kind==="wire"?"导线快捷操作":"元件快捷操作");
    // Do not let the browser's own context menu replace ours.
    menu.addEventListener("contextmenu",event=>event.preventDefault());
    menu.addEventListener("keydown",event=>{
      if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
      const items=[...menu.querySelectorAll("button")];
      const current=items.indexOf(document.activeElement);
      if(!items.length)return;
      const index=event.key==="Home"?0:event.key==="End"?items.length-1:
        (current+(event.key==="ArrowDown"?1:-1)+items.length)%items.length;
      items[index].focus({preventScroll:true});
      event.preventDefault();event.stopPropagation();
    });

    const addAction=(label,icon,danger,activate)=>{
      const item=$("button","ce-context-action"+(danger?" is-danger":""),menu);
      item.type="button";
      item.setAttribute("role","menuitem");
      item.setAttribute("data-context-action",activate);
      const graphic=$("span","ce-context-icon",item,icon);
      graphic.setAttribute("aria-hidden","true");
      $("span","ce-context-label",item,label);
      item.addEventListener("click",event=>{
        event.preventDefault();event.stopPropagation();
        closeContextMenu();
        if(submitting||disposed)return;
        if(target.kind==="component"){
          if(!nodeById().has(target.id))return;
          intent("SELECT",{kind:"component",id:target.id});
          if(activate==="rotate")rotateSelected();
          else deleteSelected();
        }else{
          const index=graph.wires.findIndex(w=>wireKey(w)===target.key);
          if(index<0)return;
          intent("SELECT",{kind:"wire",index});
          if(activate==="junction")branchFromWire(index,target.point);
          else deleteSelected();
        }
      });
      return item;
    };
    if(target.kind==="component"){
      const c=nodeById().get(target.id);
      if(!c){closeContextMenu();return;}
      if(c.type!=="junction")addAction("顺时针旋转 90°","↻",false,"rotate");
      addAction("删除元件","×",true,"delete");
    }else{
      addAction("添加连接点","⊕",false,"junction");
      addAction("删除导线","×",true,"delete");
    }
    // Use client coordinates (not SVG world units) and clamp to the viewport.
    const rect=canvasWrap.getBoundingClientRect();
    const width=menu.offsetWidth||196,height=menu.offsetHeight||98;
    const left=e.clientX-rect.left+3,top=e.clientY-rect.top+3;
    menu.style.left=`${Math.max(6,Math.min(left,Math.max(6,rect.width-width-6)))}px`;
    menu.style.top=`${Math.max(6,Math.min(top,Math.max(6,rect.height-height-6)))}px`;
    menu.querySelectorAll("button")[0]?.focus?.({preventScroll:true});
  }
  const freshId=type=>{
    const idBase=type.startsWith("pkg:")?"pkg":type.replace(/[^a-z0-9]/gi,"");
    let i=1,id=`${idBase}${i}`;
    const used=new Set(graph.components.map(c=>c.id));
    while(used.has(id))id=`${idBase}${++i}`;
    return id;
  };
  const addComponent=(type,point)=>{
    if(graph.components.length>=300){status("画布最多允许300个元件，请先删除不用的元件。","error");return;}
    const id=freshId(type);
    const sample={type},d=dims(sample);
    const c={id,type,x:Math.round((point.x-d.w/2)/12)*12,y:Math.round((point.y-d.h/2)/12)*12};
    if(type==="input") { const names=level.interface.inputs.map(x=>x.name); const name=names.find(n=>!graph.components.some(x=>x.type==="input"&&x.name===n)); if(!name){status("本关所需输入开关已全部放置");return;} c.name=name; }
    if(type==="output") { const names=level.interface.outputs.map(x=>x.name); const name=names.find(n=>!graph.components.some(x=>x.type==="output"&&x.name===n)); if(!name){status("本关所需输出灯已全部放置");return;} c.name=name; }
    Object.assign(c,restrictComponent(c,c.x,c.y));
    graph.components.push(c);
    intent("PLACED",{kind:"component",id});
    markChanged();
    status(`已放置 ${shapes(type).name || LABELS[type] || type}（${id}）${selectedPalette?"；继续点击空白处可放置，点引脚将切换为接线。":"。"}`,"success");
    render(); scheduleSim();
  };
  const renderPaletteItem=(type,name,parent,packageItem)=>{
    const item=$("div","ce-palette-item",parent);
    item.setAttribute("role","button");
    item.setAttribute("tabindex","0");
    item.setAttribute("aria-pressed","false");
    item.draggable=true; item.dataset.type=type;
    const icon=$("span","ce-mini-symbol",item);
    const preview=svgEl("svg",{viewBox:"0 0 160 100",class:"ce-palette-symbol",
      role:"img","aria-label":`${name || LABELS[type] || type} 符号`},icon);
    drawSymbol(preview,{type,name:""},shapes(type),160,100);
    $("span","",item,name || LABELS[type] || type);
    const arm=()=>{
      if(submitting)return;
      intent("PALETTE",type);
      status(selectedPalette?`正在连续放置「${name||LABELS[type]||type}」：点击空白处落子，Esc 取消；点引脚自动开始接线。`:"已退出元件放置模式。");
      render();
    };
    item.addEventListener("click",arm);
    item.addEventListener("keydown",e=>{
      if(e.target===item&&(e.key==="Enter"||e.key===" ")){
        e.preventDefault(); e.stopPropagation(); arm();
      }
    });
    item.addEventListener("dragstart",e=>{
      if(submitting){e.preventDefault();return;}
      e.dataTransfer.setData("text/circuit-type",type);
      e.dataTransfer.effectAllowed="copy";
    });
    if(packageItem){
      const inspect=$("button","ce-package-inspect",item,"内");
      inspect.title="查看封装内部"; inspect.addEventListener("click",e=>{e.stopPropagation();showPackage(packageItem);});
      item.addEventListener("contextmenu",e=>{e.preventDefault();showPackage(packageItem);});
    }
  };
  paletteTypes.forEach(t=>renderPaletteItem(t,registry[t]?.name||LABELS[t],paletteList));
  palettePackages.forEach(p=>renderPaletteItem(p.type,p.name,pkgList,p));

  /** IEC/ANSI-inspired diagrammatic glyphs, constructed from native SVG paths.
   * The visible leads end at the SAME coordinates as getPinPoint(); there is no
   * permanent decorative component card. The familiar rectangular IEC block is
   * kept only for complex / packaged function units, where it is the symbol.
   */
  function drawSymbol(group,c,shape,w,h){
    const type=c.type,cx=w/2,cy=h/2;
    const inputs=(shape.pins||[]).filter(p=>p.direction==="in");
    const outputs=(shape.pins||[]).filter(p=>p.direction==="out");
    const pinY=(i,count)=>cy+(i-(count-1)/2)*28;
    const path=(d,cls="ce-symbol-stroke")=>svgEl("path",{d,class:cls},group);
    const dot=(x,y)=>svgEl("circle",{cx:x,cy:y,r:4.4,class:"ce-symbol-terminal"},group);
    const text=(x,y,value,cls="ce-symbol-label",anchor="middle")=>
      {svgEl("text",{x,y,"text-anchor":anchor,class:cls},group).textContent=value;};
    if(type==="junction"){
      svgEl("circle",{cx,cy,r:5.3,class:"ce-junction-dot"},group);
      return;
    }
    if(type==="input"){
      // A clickable single-bit digital source (actual value is live, not an icon).
      svgEl("rect",{x:12,y:cy-24,width:82,height:48,rx:2,class:"ce-digital-display"},group);
      const bit=inputValues[c.name]??0;
      text(53,cy+14,String(bit),`ce-symbol-value ce-digit ${bit===1?"is-high":"is-low"}`);
      path(`M 94 ${cy} H ${w}`);
      dot(w,cy);
      return;
    }
    if(type==="output"){
      // A digital output probe, drawn as the traditional circle-with-cross lamp.
      const lampX=cx+3,r=23;
      path(`M 0 ${cy} H ${lampX-r}`);
      svgEl("circle",{cx:lampX,cy,r,class:`ce-lamp ${outputValues[c.name]===1?"is-on":outputValues[c.name]==="X"?"is-unknown":outputValues[c.name]==="Z"?"is-floating":""}`},group);
      path(`M ${lampX-15} ${cy-15} L ${lampX+15} ${cy+15} M ${lampX+15} ${cy-15} L ${lampX-15} ${cy+15}`,"ce-lamp-cross");
      dot(0,cy);
      return;
    }
    if(type==="vdd"){
      // Power symbol: upward voltage arrow, terminal below.
      path(`M ${cx} ${h} V ${cy-18} M ${cx-14} ${cy-4} L ${cx} ${cy-20} L ${cx+14} ${cy-4}`);
      dot(cx,h);text(cx,cy-29,"VDD");
      return;
    }
    if(type==="gnd"){
      // Conventional earth ground, terminal above.
      path(`M ${cx} 0 V ${cy} M ${cx-19} ${cy} H ${cx+19} M ${cx-12} ${cy+9} H ${cx+12} M ${cx-5} ${cy+18} H ${cx+5}`);
      dot(cx,0);return;
    }
    if(["nmos","pmos"].includes(type)){
      const gx=cx-9,channel=cx+10,sx=cx+34;
      const upper=cy-25,lower=cy+25;
      // Gate and insulated channel, drain/source pins are at x=cx+34 and y=0/h.
      path(`M 0 ${cy} H ${gx-6} M ${gx} ${upper} V ${lower} M ${channel} ${upper} V ${lower} M ${channel} ${upper} H ${sx} V 0 M ${channel} ${lower} H ${sx} V ${h}`);
      if(type==="pmos")svgEl("circle",{cx:gx-13,cy,r:5.3,class:"ce-invert-bubble"},group);
      // Small body arrow, a recognizable MOSFET distinction without extra leads.
      path(type==="nmos"?`M ${channel} ${cy+11} l 9 -5 l -1 6`:`M ${channel+10} ${cy-7} l -10 5 l 0 -7`,"ce-transistor-arrow");
      dot(0,cy);dot(sx,0);dot(sx,h);
      return;
    }
    if(["not","and","nand","or","nor","xor","xnor"].includes(type)){
      const half=Math.max(29,(inputs.length-1)*14+15);
      const left=52,top=cy-half,bottom=cy+half;
      inputs.forEach((p,i)=>{
        const y=pinY(i,inputs.length);
        // Curved OR/XOR bodies meet the input at about x=59, not x=52.
        const leadEnd=["or","nor","xor","xnor"].includes(type)?60:left;
        path(`M 0 ${y} H ${leadEnd}`,"ce-symbol-lead");dot(0,y);
      });
      if(type==="not"){
        path(`M ${left} ${top} L 115 ${cy} L ${left} ${bottom} Z`,"ce-gate-shape");
      }else if(type==="and"||type==="nand"){
        path(`M ${left} ${top} H 82 A 34 ${half} 0 0 1 82 ${bottom} H ${left} Z`,"ce-gate-shape");
      }else{
        path(`M ${left} ${top} Q 84 ${cy-half*.85} 116 ${cy} Q 84 ${cy+half*.85} ${left} ${bottom} Q 70 ${cy} ${left} ${top} Z`,"ce-gate-shape");
        if(type==="xor"||type==="xnor")path(`M 43 ${top} Q 61 ${cy} 43 ${bottom}`,"ce-gate-extra");
      }
      let outFrom=116;
      if(["not","nand","nor","xnor"].includes(type)){
        svgEl("circle",{cx:123,cy,r:7,class:"ce-invert-bubble"},group);
        outFrom=130;
      }
      path(`M ${outFrom} ${cy} H ${w}`,"ce-symbol-lead");dot(w,cy);
      return;
    }
    // A trapezoid for the multi-input selection unit.
    if(type==="mux2"){
      const top=14,bottom=h-14;
      path(`M 52 ${top} L 113 ${top+14} L 113 ${bottom-14} L 52 ${bottom} Z`,"ce-iec-block");
      inputs.forEach((p,i)=>{const y=pinY(i,inputs.length);
        path(`M 0 ${y} H 52`,"ce-symbol-lead");dot(0,y);
        });
      path(`M 113 ${cy} H ${w}`,"ce-symbol-lead");dot(w,cy);
      text(85,cy+6,"MUX","ce-block-mark");return;
    }
    // IEC rectangular function symbol for latches, flip-flops, custom packages.
    const pad=11,left=49,right=w-40;
    svgEl("rect",{x:left,y:pad,width:right-left,height:h-2*pad,rx:1,class:"ce-iec-block"},group);
    inputs.forEach((p,i)=>{
      const y=pinY(i,inputs.length);
      path(`M 0 ${y} H ${left}`,"ce-symbol-lead");dot(0,y);
      // Standard IEC rising-edge clock wedge, including official packages
      // whose public pin is capitalized "CLK" rather than built-in "clk".
      if(String(p.name).toLowerCase()==="clk")
        path(`M ${left} ${y-8} l 8 8 l -8 8`,"ce-clock-mark");
    });
    outputs.forEach((p,i)=>{
      const y=pinY(i,outputs.length);
      path(`M ${right} ${y} H ${w}`,"ce-symbol-lead");dot(w,y);
    });
    // Concise IEC-style function abbreviations; the palette and tooltips
    // retain the full Chinese names. No proprietary/nonstandard icons.
    const officialSymbol=/^pkg:(mao_rs|mao_d_latch|mao_edge_dff|mao_register4)@/.exec(type)?.[1];
    const officialMarks={
      mao_rs:"RS", mao_d_latch:"D LATCH",
      mao_edge_dff:"D FF", mao_register4:"REG4"
    };
    const mark=officialMarks[officialSymbol]||
      (type==="dff"?"D FF":type==="sr_latch"?"SR":(shape.name||LABELS[type]||type));
    text(cx,cy+5,mark,"ce-block-mark");
  }
  function isConnected(component,pin){
    return graph.wires.some(w=>[w.from,w.to].some(e=>e.comp===component&&e.pin===pin));
  }
  function startDraft(endpoint){
    const c=nodeById().get(endpoint.comp),pin=c&&pinInfo(c.type,endpoint.pin);
    if(!c||!pin){draftPoints=[];return;}
    const pt=getPinPoint(c,pin);
    draftPoints=[{x:pt.x,y:pt.y}];
    horizontalFirst=pt.side!=="top"&&pt.side!=="bottom";
    hoverEndpoint=null;hoverWire=null;
    directionBtn.textContent=horizontalFirst?"横向优先":"纵向优先";
  }
  function draftRouteTo(target,targetSide=null,exact=false,alignTerminal=true){
    if(!wireStart||!draftPoints.length)return null;
    return liveDraftPath(draftPoints,target,{horizontalFirst,grid:12,
      startSide:wireStart?getPinPoint(nodeById().get(wireStart.comp),
        pinInfo(nodeById().get(wireStart.comp).type,wireStart.pin)).side:null,
      endSide:targetSide,exactTarget:exact,alignTerminal});
  }
  /**
   * Convert a redundant run into one actual electrical trunk and a branch.
   * A connection may share its SOURCE (fan-out), DESTINATION (fan-in), or an
   * already-connected piece of either electrical net. Never use geometric
   * proximity to decide connectivity: all eligible wires are first checked
   * against graph union-find. The other endpoint is kept on the new branch.
   *
   * For automatically drawn lines, small near-parallel same-net corridors can
   * be joined at a clear interior point of the old trunk. Manually fixed
   * waypoints are only shortened at a PROVEN exact overlap; never guessed.
   */
  function sharedNetworkJoin(points,endpoint){
    if(!wireStart||!endpoint||!pathIsOrthogonal(points)||
       !checkConnection(wireStart,endpoint,pinLookup).valid)return null;
    const alreadyLinked=graph.wires.some(w=>
      (sameEndpoint(w.from,wireStart)&&sameEndpoint(w.to,endpoint))||
      (sameEndpoint(w.from,endpoint)&&sameEndpoint(w.to,wireStart)));
    if(alreadyLinked)return null;
    const {ids,endpointNet}=electricalNets();
    const startNet=endpointNet(wireStart),endNet=endpointNet(endpoint);
    // An existing closed net should not acquire decorative internal loops.
    if(startNet===endNet)return null;
    const oldRoutes=ensureRoutes(),tapPin=pinInfo('junction','out');
    if(!tapPin)return null;
    const occupied=oldRoutes.flatMap((layout,i)=>occupiedSegments(layout.points,ids[i]));
    const candidates=[];
    const distanceOf=p=>p.slice(1).reduce((n,pt,i)=>n+
      Math.abs(pt.x-p[i].x)+Math.abs(pt.y-p[i].y),0);
    const visualCost=p=>distanceOf(p)+Math.max(0,p.length-2)*19+
      collinearOverlap(p,occupied)*4;
    const baselineCost=visualCost(points),baselineLength=distanceOf(points);
    for(const side of ['target','source']){
      const common=side==='target'?endpoint:wireStart;
      const attach=side==='target'?wireStart:endpoint;
      const net=side==='target'?endNet:startNet;
      const attachPin=pinLookup(attach),attachComp=nodeById().get(attach.comp);
      if(!attachPin||attachPin.width!==tapPin.width||!attachComp)continue;
      const attachPosition=getPinPoint(attachComp,attachPin);
      const commonComp=nodeById().get(common.comp),commonPin=pinLookup(common);
      const commonPosition=commonComp&&commonPin&&getPinPoint(commonComp,commonPin);
      const oriented=side==='target'?points:[...points].reverse();
      const eligible=(wire,i)=>ids[i]===net &&
        Boolean(wire&&pinLookup(wire.from)?.width===tapPin.width &&
          pinLookup(wire.to)?.width===tapPin.width);
      const record=(candidate,kind)=>{
        if(!candidate)return;
        const oldWire=graph.wires[candidate.wireIndex];
        if(!oldWire||!eligible(oldWire,candidate.wireIndex))return;
        const oldLayout=oldRoutes[candidate.wireIndex]?.points;
        const split=candidate.split||null,reuseEndpoint=candidate.reuseEndpoint||null;
        if(!split&&!reuseEndpoint)return;
        // A junction may only replace an interior point of this existing wire
        // or reuse a real endpoint. Never insert a visually detached dot.
        if(!pathIsOrthogonal(candidate.prefix)||candidate.prefix.length<2||
           !sameXY(candidate.prefix[0],attachPosition)||
           !sameXY(candidate.prefix.at(-1),candidate.point)||
           !candidate.prefix.every(withinWorkspace))return;
        if(reuseEndpoint){
          if(sameEndpoint(attach,reuseEndpoint)||
             !checkConnection(attach,reuseEndpoint,pinLookup).valid||
             graph.wires.some(w=>(sameEndpoint(w.from,attach)&&sameEndpoint(w.to,reuseEndpoint))||
               (sameEndpoint(w.to,attach)&&sameEndpoint(w.from,reuseEndpoint))))return;
        }
        if(split && oldRoutes.some((layout,k)=>ids[k]!==net&&
          projectToPath(candidate.point,layout.points)?.distance<6))return;
        const verdict=draftAssessment(candidate.prefix,null,oldWire,attach);
        if(!verdict.ok)return;
        // The existing route must be truly at the pinned wire endpoints;
        // stale geometry from a component drag is never safe to split.
        const ends=wireEndpoints(oldWire);
        if(!ends||!sameXY(oldLayout[0],ends.a)||
           !sameXY(oldLayout.at(-1),ends.b))return;
        const oldEnd=split?Math.min(distanceOf(split.before),distanceOf(split.after)):0;
        // Junctions crowded against a component pin read like extra solder
        // balls. Prefer a short shared trunk with its fork in open space.
        const pinCrowding=split&&oldEnd<40?Math.max(0,40-oldEnd)*2.8:0;
        const commonDistance=commonPosition?
          Math.abs(candidate.point.x-commonPosition.x)+Math.abs(candidate.point.y-commonPosition.y):Infinity;
        const positionPenalty=commonDistance<40&&!reuseEndpoint?36:0;
        const structuralBonus=kind==='existing-elbow'?44:
          kind==='same-net-crossing'?26:kind==='existing-junction'?33:0;
        const cost=visualCost(candidate.prefix)+positionPenalty+pinCrowding+
          (reuseEndpoint?-8:15)-structuralBonus;
        candidates.push({...candidate,attach,side,kind,verdict,cost,
          sharedOrigin:sameEndpoint(oldWire.from,common)||sameEndpoint(oldWire.to,common),
          oldEnd});
      };
      // For source-side joins the route is REVERSED: its earliest shared point
      // is the visible fork farthest from the source, not a dot beside the pin.
      record(firstSharedNetworkOverlap(oriented,graph.wires,oldRoutes,eligible,22),'overlap');
      if(draftPoints.length!==1)continue;
      // For near-parallel runs, sample only the already-connected net. Exact
      // same-terminal fan-outs are allowed a slightly longer common trunk,
      // even if auto-drafting initially placed a corner 24 units from the pin.
      let autoTapAttempts=0;
      for(let i=0;i<graph.wires.length;i++){
        if(autoTapAttempts>=16)break; // Preview must remain responsive on large nets.
        const oldWire=graph.wires[i];
        if(!eligible(oldWire,i))continue;
        const oldPath=oldRoutes[i]?.points;
        const samePin=sameEndpoint(oldWire.from,common)||sameEndpoint(oldWire.to,common);
        const taps=nearbyTrunkTaps(points,oldPath,samePin?commonPosition:null,18);
        // Non-shared-terminal near-parallel lanes are eligible only with an
        // overlapping run in the actual planned path, not remote same-net wires.
        const obstacles=graph.components.filter(c=>c.type!=='junction'&&
          c.id!==attach.comp).map(c=>({x:c.x,y:c.y,...dims(c)}));
        for(const tap of taps){
          if(autoTapAttempts>=16)break;
          if(tap.reason==='shared-terminal'&&!samePin)continue;
          // A true node on another net's crossing would LOOK shorted, even
          // though it isn't. Avoid that ambiguous placement where possible.
          const onUnrelatedWire=oldRoutes.some((layout,k)=>ids[k]!==net&&
            projectToPath(tap.point,layout.points)?.distance<7);
          if(onUnrelatedWire)continue;
          autoTapAttempts++;
          const routed=routeOrthogonal({...tap.point,side:'any'},attachPosition,
            obstacles,{occupied,net:net,clearance:4,stubLength:24});
          const prefix=compactPath([...routed.points].reverse());
          if(!pathIsOrthogonal(prefix)||!sameXY(prefix[0],attachPosition)||
             !sameXY(prefix.at(-1),tap.point))continue;
          // A small cost increase is acceptable to remove an ugly fan-out,
          // but never send a wire on a large unnecessary detour.
          const candidateCost=visualCost(prefix);
          if(distanceOf(prefix)>baselineLength*1.14+24||
             candidateCost>baselineCost+36)continue;
          record({wireIndex:i,point:tap.point,split:tap.split,
            reuseEndpoint:null,prefix,distance:distanceOf(prefix),gap:tap.gap},tap.reason);
        }
      }
      // Once a fan-out has a genuine junction, new branches should consider
      // that existing fork even when the newly planned wire runs 12–40 units
      // beside the short A->junction lead. This avoids a second identical
      // outgoing conductor with no dot at its point of divergence.
      if(draftPoints.length===1){
        for(const node of graph.components){
          if(node.type!=='junction'||endpointNet({comp:node.id,pin:'out'})!==net)continue;
          const oldIndex=graph.wires.findIndex((w,i)=>eligible(w,i)&&
            (w.from.comp===node.id||w.to.comp===node.id));
          if(oldIndex<0)continue;
          const pinPoint=getPinPoint(node,tapPin);
          const near=projectToPath(pinPoint,points);
          if(!near||near.distance>92||
             Math.abs(pinPoint.x-attachPosition.x)+
             Math.abs(pinPoint.y-attachPosition.y)<36)continue;
          const obstacles=graph.components.filter(c=>c.type!=='junction'&&
            c.id!==attach.comp).map(c=>({x:c.x,y:c.y,...dims(c)}));
          const routed=routeOrthogonal({...pinPoint,side:'any'},attachPosition,
            obstacles,{occupied,net,clearance:4,stubLength:24});
          const prefix=compactPath([...routed.points].reverse());
          if(!pathIsOrthogonal(prefix)||
             distanceOf(prefix)>baselineLength*1.15+24||
             visualCost(prefix)>baselineCost+30)continue;
          record({wireIndex:oldIndex,point:pinPoint,
            reuseEndpoint:{comp:node.id,pin:'out'},prefix},'existing-junction');
        }
      }
    }
    if(!candidates.length)return null;
    const exact=candidates.filter(c=>c.kind==='overlap');
    const soft=candidates.filter(c=>c.kind!=='overlap');
    // Preserve the proven same-target join when no suitable source trunk
    // exists, and prefer existing junctions over inventing near-identical ones.
    const sort=(a,b)=>a.cost-b.cost||
      Number(Boolean(b.reuseEndpoint))-Number(Boolean(a.reuseEndpoint))||
      a.wireIndex-b.wireIndex;
    exact.sort(sort);soft.sort(sort);
    const bestExact=exact[0],bestSoft=soft[0];
    if(bestSoft&&(!bestExact ||
        (bestSoft.side==='source'&&bestSoft.sharedOrigin&&
         bestSoft.cost<=bestExact.cost+45&&
         (bestExact.side!=='source'||bestExact.oldEnd<40)) ||
        bestSoft.cost+18<bestExact.cost))return bestSoft;
    return bestExact||bestSoft;
  }
  // Terminal correction is unlimited in distance. Confirm its geometric
  // safety before choosing it; fallback keeps the user's earlier waypoints.
  // For a snapped target, an obstacle-aware suffix may also route around
  // an existing wire instead of superimposing two coincident conductors.
  function safeDraftRoute(target,targetSide,exact,endpoint=null,targetWire=null){
    let route=draftRouteTo(target,targetSide,exact);
    let verdict=route&&draftAssessment(route,endpoint,targetWire);
    if(exact&&targetSide&&draftPoints.length>1&&verdict&&!verdict.ok){
      const unaligned=draftRouteTo(target,targetSide,exact,false);
      const originalVerdict=unaligned&&draftAssessment(unaligned,endpoint,targetWire);
      if(originalVerdict?.ok){route=unaligned;verdict=originalVerdict;}
    }
    if(!exact||!route||!wireStart||!target)return {route,verdict};
    // Same destination: reuse the shared tail, inserting an actual electrical
    // node at the earliest overlap. Different destinations still use the
    // normal overlap-aware avoidance route below.
    if(endpoint && !targetWire && (verdict?.ok||draftPoints.length===1)){
      const join=sharedNetworkJoin(route,endpoint);
      if(join)return {route:join.prefix,verdict:join.verdict,join};
    }
    const {ids,endpointNet}=electricalNets();
    const occupied=ensureRoutes().flatMap((layout,i)=>occupiedSegments(layout.points,ids[i]));
    const cost=points=>points.slice(1).reduce((n,p,i)=>
      n+Math.abs(p.x-points[i].x)+Math.abs(p.y-points[i].y),0)+
      Math.max(0,points.length-2)*19+collinearOverlap(points,occupied)*4;
    const baselineOverlap=collinearOverlap(route,occupied);
    if(verdict?.ok&&baselineOverlap<0.01)return {route,verdict};
    const omitted=new Set([wireStart.comp,endpoint?.comp]);
    if(targetWire){omitted.add(targetWire.from.comp);omitted.add(targetWire.to.comp);}
    const obstacles=graph.components.filter(c=>c.type!=="junction"&&!omitted.has(c.id))
      .map(c=>({x:c.x,y:c.y,...dims(c)}));
    const source=nodeById().get(wireStart.comp);
    const sourcePin=source&&pinInfo(source.type,wireStart.pin);
    const startSide=sourcePin&&getPinPoint(source,sourcePin).side;
    // Preserve manually chosen legs unless a segment is proven to retrace
    // itself. The endpoint-aware prefix may move the nearest existing elbow.
    const aligned=targetSide?alignFixedWaypoints(draftPoints,target,targetSide):null;
    // Once a snapped terminal can safely absorb a clicked elbow, that
    // correction is part of the user's intention. Never let a slightly
    // cheaper autoroute resurrect the old overshoot or short zigzag.
    const alignedPath=aligned?compactPath([...aligned,target]):null;
    const alignedSafe=alignedPath&&draftAssessment(alignedPath,endpoint,targetWire).ok;
    const prefixes=aligned?(alignedSafe?[aligned]:[aligned,draftPoints]):[draftPoints];
    for(const fixed of prefixes){
      const last=fixed[fixed.length-1];
      const autorouted=routeOrthogonal({...last,side:fixed.length===1?startSide:"any"},
        {...target,side:targetSide||"any"},obstacles,
        {occupied,net:endpointNet(wireStart),clearance:4,stubLength:24});
      const candidate=compactPath([...fixed.slice(0,-1),...autorouted.points]);
      if(candidate.length<2||!candidate.every(withinWorkspace))continue;
      // Automatic avoidance must not attach to the wrong side of a terminal.
      if(targetSide){
        const lastStep=candidate[candidate.length-2],end=candidate.at(-1);
        const legal=targetSide==="left"?lastStep.y===end.y&&lastStep.x<end.x:
          targetSide==="right"?lastStep.y===end.y&&lastStep.x>end.x:
          targetSide==="top"?lastStep.x===end.x&&lastStep.y<end.y:
          lastStep.x===end.x&&lastStep.y>end.y;
        if(!legal)continue;
      }
      const assessment=draftAssessment(candidate,endpoint,targetWire);
      if(!assessment.ok)continue;
      if(!verdict?.ok||cost(candidate)<cost(route)-0.01){
        route=candidate;verdict=assessment;
      }
    }
    return {route,verdict};
  }
  function draftAssessment(points,endpoint=null,targetWire=null,attachPin=null){
    const nodes=nodeById();
    const omitted=new Set([wireStart?.comp,endpoint?.comp,attachPin?.comp]);
    if(targetWire){omitted.add(targetWire.from.comp);omitted.add(targetWire.to.comp);}
    const obstacles=graph.components.filter(c=>c.type!=="junction"&&!omitted.has(c.id))
      .map(c=>({x:c.x,y:c.y,...dims(c)}));
    const {ids,endpointNet}=electricalNets();
    const allowed=new Set([endpointNet(wireStart)]);
    if(endpoint)allowed.add(endpointNet(endpoint));
    if(attachPin)allowed.add(endpointNet(attachPin));
    if(targetWire)allowed.add(endpointNet(targetWire.from));
    const others=ensureRoutes().flatMap((layout,i)=>occupiedSegments(layout.points,ids[i]));
    return assessDraftPath(points,obstacles,others,allowed);
  }
  function fallbackDirectRoute(target,targetSide,endpoint=null,targetWire=null){
    if(!wireStart||draftPoints.length!==1||!target)return null;
    const source=graph.components.find(c=>c.id===wireStart.comp);
    const p=source&&pinInfo(source.type,wireStart.pin);
    if(!p)return null;
    const omitted=new Set([wireStart.comp,endpoint?.comp]);
    if(targetWire){omitted.add(targetWire.from.comp);omitted.add(targetWire.to.comp);}
    const rects=graph.components.filter(c=>c.type!=="junction"&&!omitted.has(c.id))
      .map(c=>({x:c.x,y:c.y,...dims(c)}));
    const {ids,endpointNet}=electricalNets();
    const allowable=new Set([endpointNet(wireStart)]);
    if(endpoint)allowable.add(endpointNet(endpoint));
    if(targetWire)allowable.add(endpointNet(targetWire.from));
    const occupied=ensureRoutes().flatMap((layout,i)=>occupiedSegments(layout.points,
      allowable.has(ids[i])?endpointNet(wireStart):ids[i]));
    const route=routeOrthogonal(getPinPoint(source,p),{...target,side:targetSide||"any"},
      rects,{occupied,net:endpointNet(wireStart)});
    return route.points.length>=2&&draftAssessment(route.points,endpoint,targetWire).ok?route.points:null;
  }
  function commitCorner(point){
    if(!wireStart||!draftPoints.length||submitting)return;
    const c=nodeById().get(wireStart.comp);
    const pin=c&&pinInfo(c.type,wireStart.pin);
    const proposed=commitDraftWaypoint(draftPoints,point,{grid:12,horizontalFirst,
      startSide:pin&&getPinPoint(c,pin).side});
    if(!proposed){status("请在另一处指定转折点；点击端子可完成连线。","info");return;}
    draftPoints=proposed;
    const a=draftPoints[draftPoints.length-2],b=draftPoints[draftPoints.length-1];
    horizontalFirst=Math.abs(a.y-b.y)<0.01?false:true;
    directionBtn.textContent=horizontalFirst?"横向优先":"纵向优先";
    status("转折点已固定；继续移动鼠标，单击空白确定下一点，点击端子或已有导线完成。","success");
    renderPreview();
  }
  function renderPreview(){
    previewLayer.replaceChildren();
    if(tapWireKey && pointerWorld){
      const index=graph.wires.findIndex(w=>wireKey(w)===tapWireKey);
      const hit=index>=0?wireSnapAt(pointerWorld,index):null;
      tapPreview=hit?{index,point:hit.point}:null;
      if(hit){
        const pixel=worldUnitsPerScreenPixel();
        svgEl("circle",{cx:hit.point.x,cy:hit.point.y,r:6*pixel,class:"ce-tap-preview"},previewLayer);
        svgEl("circle",{cx:hit.point.x,cy:hit.point.y,r:12*pixel,class:"ce-tap-preview-ring"},previewLayer);
      }
    } else tapPreview=null;
    if(wireStart&&draftPoints.length){
      const target=hoverEndpoint?hoverEndpoint.point:hoverWire?hoverWire.point:pointerWorld;
      const targetSide=hoverEndpoint?.side||null;
      const endpoint=hoverEndpoint?.endpoint||null;
      const wire=hoverWire?graph.wires[hoverWire.index]:null;
      const exact=Boolean(hoverEndpoint||hoverWire);
      let route=null,verdict=null,join=null;
      if(target){
        ({route,verdict,join}=safeDraftRoute(target,targetSide,exact,endpoint,wire));
        if(route&&!verdict.ok&&draftPoints.length===1){
          const fallback=fallbackDirectRoute(target,targetSide,endpoint,wire);
          if(fallback){route=fallback;verdict={ok:true};}
        }
      }
      // Draw ONE full route: painting the old fixed trace *under* the corrected
      // route leaves a hanging tail after an overshot anchor, even if the
      // corrected path has already been compacted perfectly.
      const shown=route?.length>=2?route:draftPoints;
      if(shown.length>=2){
        svgEl("path",{d:pointsToPath(shown),class:route?
          `ce-wire ce-wire--preview ${verdict?.ok?"":"is-invalid"}`:
          "ce-wire ce-wire--fixed"},previewLayer);
      }
      const aligned=exact&&targetSide?
        alignFixedWaypoints(draftPoints,target,targetSide):null;
      const fixedMarkers=aligned&&route&&
        pointsToPath(route)===pointsToPath([...aligned,target])?aligned:draftPoints;
      for(const point of fixedMarkers.slice(1)){
        // A clicked point erased by a retrace must not remain as a floating
        // marker below/above the visible conductor.
        if(route&&projectToPath(point,route)?.distance>0.01)continue;
        svgEl("rect",{x:point.x-3.5/zoom,y:point.y-3.5/zoom,
          width:7/zoom,height:7/zoom,class:"ce-waypoint"},previewLayer);
      }
      if(route?.length>=2&&exact){
        const p=route[route.length-1];
        if(join)svgEl("circle",{cx:p.x,cy:p.y,r:5.3,
          class:"ce-electrical-junction ce-electrical-junction--preview",
          "pointer-events":"none"},previewLayer);
        svgEl("circle",{cx:p.x,cy:p.y,r:9/zoom,
          class:`ce-draft-target ${verdict?.ok?"is-valid":"is-invalid"}`},previewLayer);
      }
    }
  }
  function queuePreview(){
    if(previewRaf)return;
    if(typeof requestAnimationFrame!=="function"){renderPreview();return;}
    previewRaf=requestAnimationFrame(()=>{
      previewRaf=0;
      if(!disposed)renderPreview();
    });
  }
  function render(){
    undoBtn.disabled=!undoStack.length;redoBtn.disabled=!redoStack.length;
    setWorldTransform();
    wiresLayer.replaceChildren();compsLayer.replaceChildren();previewLayer.replaceChildren();
    // Moving a component must never reroute or mutate its stored wire geometry.
    // The last committed routes stay cached until pointerup/pointercancel.
    const movingId=(drag?.kind==="component"||drag?.kind==="junction") && drag.moved ? drag.id : null;
    const movingIds=new Set(movingId?[movingId]:[]);
    if(drag?.kind==='component'&&drag.moved)
      for(const f of drag.activeFollowers||[])movingIds.add(f.id);
    const layouts=movingId
      ? graph.wires.map(w=>routeCache.get(wireKey(w)))
      : ensureRoutes();
    blockedRoutes=0;
    let overlappingRoutes=0;
    graph.wires.forEach((w,i)=>{
      // Hide connected wires, including their pointer hit areas, during drag.
      if(movingIds.has(w.from.comp)||movingIds.has(w.to.comp))return;
      const layout=layouts[i];
      if(!layout?.path)return;
      if(!layout?.avoided)blockedRoutes++;
      if(layout?.overlaps>0)overlappingRoutes++;
      const from=pinValues[w.from.comp]?.[w.from.pin];
      const to=pinValues[w.to.comp]?.[w.to.pin];
      const bit=from??to;
      const colour=bit===1?"is-high":bit===0?"is-low":bit==="X"?"is-unknown":bit==="Z"?"is-floating":"";
      svgEl("path",{d:layout.path,
        class:`ce-wire ${selected?.kind==="wire"&&selected.index===i?"is-selected":""} ${colour} ${layout.avoided?"":"has-obstacle"}`,
        "data-wire":i},wiresLayer);
      svgEl("path",{d:layout.path,class:"ce-wire-hit-area","data-wire":i},wiresLayer);
    });
    if(drag?.kind==='component'&&drag.moved){
      // Show the moved copper as a non-interactive preview.  This never writes
      // to saved paths during pointermove (Esc can restore the exact layout).
      graph.wires.forEach((w,i)=>{
        if(!movingIds.has(w.from.comp)&&!movingIds.has(w.to.comp))return;
        const before=drag.originRoutes?.[i]?.points;
        if(!pathIsOrthogonal(before))return;
        const fromComp=nodeById().get(w.from.comp),toComp=nodeById().get(w.to.comp),
          fp=pinLookup(w.from),tp=pinLookup(w.to);
        const from=fromComp&&fp&&getPinPoint(fromComp,fp);
        const to=toComp&&tp&&getPinPoint(toComp,tp);
        if(!from||!to)return;
        const dx=from.x-before[0].x,dy=from.y-before[0].y;
        const both=movingIds.has(w.from.comp)&&movingIds.has(w.to.comp)&&
          sameXY({x:before.at(-1).x+dx,y:before.at(-1).y+dy},to);
        const points=both?before.map(p=>({x:p.x+dx,y:p.y+dy})):
          reanchorPath(before,from,to);
        if(pathIsOrthogonal(points))svgEl('path',{d:pointsToPath(points),
          class:'ce-wire ce-wire--preview','pointer-events':'none'},wiresLayer);
      });
    }
    renderPreview();
    graph.components.forEach(c=>{
      const shape=shapes(c.type), {w,h}=dims(c),base=baseDims(c);
      const floating=shape.pins.some(p=>p.direction==="in" && !isConnected(c.id,p.name) && c.type!=="junction");
      const g=svgEl("g",{class:`ce-component ${selected?.kind==="component"&&selected.id===c.id?"is-selected":""} ${floating?"has-floating":""}`,
        "data-component":c.id,transform:`translate(${c.x} ${c.y})`},compsLayer);
      if(c.type!=="junction")svgEl("rect",{x:0,y:0,width:w,height:h,rx:3,class:"ce-component-hit"},g);
      const rotation=c.rotation||0;
      const symbol=rotation?svgEl("g",{transform:`translate(${w/2} ${h/2}) rotate(${rotation}) translate(${-base.w/2} ${-base.h/2})`},g):g;
      drawSymbol(symbol,c,shape,base.w,base.h);
      if(c.type!=="junction"){
        // Captions sit OUTSIDE the electrical symbol; never put the symbol in a UI box.
        const caption=c.name||((shape.family==="package"||["sr_latch","dff","mux2"].includes(c.type))?"":(LABELS[c.type]||shape.name||c.type));
        if(caption)svgEl("text",{x:w/2,y:h+15,"text-anchor":"middle",class:"ce-component-label ce-component-caption"},g).textContent=caption;
      }
      if(c.type==="input"){
        g.classList.add("ce-input-component");
        g.setAttribute("role","button");g.setAttribute("tabindex","0");
        g.setAttribute("aria-label",`输入 ${c.name||c.id}，当前 ${inputValues[c.name]??0}，点击切换`);
        g.setAttribute("title","点击数字 0 / 1 切换输入；拖动空白区域移动开关");
      }
      if(c.type==="junction"){
        // Old saved junction.a/b/c/d/out all meet at the same visual point.
        // The single hit target exposes junction.out for arbitrary new taps.
        const bit=pinValues[c.id]?.out;
        const selectedHere=wireStart?.comp===c.id;
        svgEl("circle",{cx:w/2,cy:h/2,r:17,class:`ce-junction-hit ${selectedHere?"is-start":""} ${drag?.kind==='junction'&&drag.id===c.id&&drag.moved?'is-dragging':''} ${bit===1?"is-high":bit===0?"is-low":bit==="X"?"is-unknown":""}`,
          "data-pin-comp":c.id,"data-pin":"out","aria-label":`接点 ${c.id}：单击接线；按住沿线路拖动；拖到同一电气网络的另一接点可合并`},g);
        return;
      }
      shape.pins.forEach(p=>{
        const pos=getPinPoint(c,p),px=pos.x-c.x,py=pos.y-c.y;
        const isStart=wireStart&&wireStart.comp===c.id&&wireStart.pin===p.name;
        const legal=wireStart&&checkConnection(wireStart,{comp:c.id,pin:p.name},pinLookup).valid;
        const bit=pinValues[c.id]?.[p.name];
        const pinFloating=p.direction==="in"&&!isConnected(c.id,p.name);
        const signal=bit===1?"is-high":bit===0?"is-low":bit==="X"?"is-unknown":bit==="Z"?"is-undriven":"";
        const pinG=svgEl("g",{class:`ce-pin ${p.direction==="in"?"is-input":"is-output"} ${legal?"is-legal":""} ${isStart?"is-start":""} ${pinFloating?"is-floating":""} ${signal}`,
          "data-pin-comp":c.id,"data-pin":p.name},g);
        svgEl("circle",{cx:px,cy:py,r:14,class:"ce-pin-hit"},pinG);
        svgEl("circle",{cx:px,cy:py,r:4.8,class:"ce-pin-dot"},pinG);
        const side=pos.side;
        const textX=px+(side==="left"?12:side==="right"?-12:0);
        const textY=py+(side==="top"?18:side==="bottom"?-13:-10);
        svgEl("title",{},pinG).textContent=`${shape.name||LABELS[c.type]||c.type} · ${p.name}`;
        // Standard gate terminals are unambiguous, so leave their stubs clean.
        // Advanced blocks keep concise G/S/D, S/R/Q and clock identifiers.
        if(!["input","output","vdd","gnd","not","and","nand","or","nor","xor","xnor"].includes(c.type)){
          const short={gate:"G",source:"S",drain:"D",qbar:"Q'",sel:"SEL",clk:"CLK"};
          const label=short[p.name]||p.name.toUpperCase();
          svgEl("text",{x:textX,y:textY,"text-anchor":side==="left"?"start":side==="right"?"end":"middle",class:"ce-pin-label"},pinG).textContent=label;
        }
      });
    });
    // A painted crossing is not an electrical connection. Mark only real
    // netlist junctions: explicit junction components (drawn above) or pins
    // to which at least two distinct wires have actually been connected.
    for(const joint of electricalJunctionPoints(graph.components,graph.wires,(c,pinName)=>{
      const pin=pinInfo(c.type,pinName);
      return pin?getPinPoint(c,pin):null;
    })){
      const bit=pinValues[joint.componentId]?.[joint.pin];
      const signal=bit===1?"is-high":bit===0?"is-low":bit==="X"?"is-unknown":"";
      const active=wireStart?.comp===joint.componentId&&wireStart.pin===joint.pin;
      svgEl("circle",{cx:joint.x,cy:joint.y,r:5.3,
        class:`ce-electrical-junction ${active?"is-start":signal}`,
        "data-electrical-node":`${joint.componentId}:${joint.pin}`,
        "pointer-events":"none","aria-hidden":"true"},compsLayer);
    }
    renderDetail();renderWarnings();
    if(drag?.kind==='junction'&&drag.moved)queueJunctionDragVisual();
    if(overlappingRoutes){$("p","ce-warning",warnings,`${overlappingRoutes} 条线与其他电气网络存在重叠。请移动元件或拖动线段整理。`);}
  }
  function renderDetail(){
    detail.replaceChildren();
    if(tapWireKey){$("p","ce-status-message",detail,"移动鼠标到选中的导线上，预览出现后在你指定的位置单击，才会创建接点。按 Esc 取消。");return;}
    if(wireStart){$("p","ce-status-message",detail,`正在从 ${wireStart.comp}.${wireStart.pin} 接线。鼠标移动实时预览；单击空白确定转折点；点击另一端子或已有线路完成。`);
      $("p","ce-help",detail,"空格：切换走线方向 · Esc / 右键：取消。未完成的线路不会进入存档或仿真。");return;}
    if(selectedPalette){$("p","ce-status-message",detail,`放置模式：${shapes(selectedPalette).name || LABELS[selectedPalette] || selectedPalette}`);$("p","ce-help",detail,"点击画布空白处连续放置；拖动空白处平移视图。点引脚即切换为连线模式。");return;}
    if(!selected){$("p","ce-muted",detail,"选择元件或连线查看信息。");$("p","ce-help",detail,"单击引脚开始连线；导线可创建分支，交叉不自动连接。拖动元件可以重新走线，R 旋转元件。");return;}
    if(selected.kind==="wire"){
      $("strong","",detail,`连线 ${selected.index+1}`);
      $("p","ce-muted",detail,"拖动导线可调整整段折线；交叉默认不连接，添加分支时不会改变原路径。");
      const branch=$("button","ce-button",detail,"在导线上添加分支");
      branch.addEventListener("click",()=>{
        const w=graph.wires[selected.index];if(!w)return;
        tapWireKey=wireKey(w);tapPreview=null;wireStart=null;selectedPalette=null;
        stage.dataset.mode="junction";toolHint.textContent="选择接点位置";
        status("请移动到这根导线上的目标位置，看到接点预览后单击确认。Esc 取消。","info");
        render();
      });
      const del=$("button","ce-button ce-button--danger",detail,"删除连线（Delete）");del.addEventListener("click",deleteSelected);return;
    }
    const c=nodeById().get(selected.id);if(!c)return;
    $("strong","",detail,`${c.id} · ${shapes(c.type).name||LABELS[c.type]||c.type}`);
    if(c.type==="input"){
      const toggle=$("button","ce-button",detail,`输入 ${inputValues[c.name]??0} · 点击翻转`);toggle.addEventListener("click",()=>toggleInput(c));
    }
    if(c.type==='junction')$("p","ce-help",detail,
      "单击接点可开始接线；按住可沿原导线滑动，拖到同网络的另一接点会合并。接近的平行分支只在明显减少重复线路时整理。");
    if(c.type!=="junction"){
      const rotate=$("button","ce-button",detail,"顺时针旋转 90°（R）");
      rotate.addEventListener("click",()=>rotateSelected());
    }
    const del=$("button","ce-button ce-button--danger",detail,"删除元件");del.addEventListener("click",deleteSelected);
  }
  function renderWarnings(){
    warnings.replaceChildren();$("h4","",warnings,"模拟警告");
    if(lastSimError)$("p","ce-warning",warnings,lastSimError);
    if(blockedRoutes)$("p","ce-warning",warnings,
      `有 ${blockedRoutes} 条线无法完全自动避让障碍；电气连接仍然有效，请移动元件留出走线空间。`);
    const list=simWarnings;
    if(!list.length && !lastSimError && !blockedRoutes){$("p","ce-muted",warnings,"暂无模拟警告。");return;}
    list.forEach(w=>$("p","ce-warning",warnings,w.message||String(w)));
  }
  function toggleInput(component){
    if(submitting || !component || component.type!=="input")return;
    inputValues[component.name]=1-(inputValues[component.name]??0);
    status(`输入开关 ${component.name} 已切换到 ${inputValues[component.name]}；正在模拟。`);
    render(); scheduleSim(true);
  }
  /** Remove redundant branch markers after explicit wire/component deletion.
   * An ordinary two-way junction must not leave a visual dot or extra elbows.
   */
  function tidyDanglingJunctions(){
    const paths=ensureEditorLayout();
    let repeat=true;
    while(repeat){
      repeat=false;
      const nodes=graph.components.filter(c=>c.type==="junction");
      for(const junction of nodes){
        const id=junction.id;
        const edges=graph.wires.map((w,i)=>({w,i})).filter(o=>
          o.w.from.comp===id||o.w.to.comp===id);
        if(edges.length>2)continue;
        if(edges.length===2){
          const [a,b]=edges.map(o=>o.w);
          const aEnd=a.from.comp===id?a.to:a.from;
          const bEnd=b.from.comp===id?b.to:b.from;
          const aPts=paths[wireKey(a)],bPts=paths[wireKey(b)];
          const one=a.from.comp===id?[...(aPts||[])].reverse():[...(aPts||[])];
          const two=b.to.comp===id?[...(bPts||[])].reverse():[...(bPts||[])];
          const joined=compactPath([...one,...two.slice(1)]);
          const duplicate=graph.wires.some(w=>w!==a&&w!==b&&
            ((sameEndpoint(w.from,aEnd)&&sameEndpoint(w.to,bEnd))||
             (sameEndpoint(w.from,bEnd)&&sameEndpoint(w.to,aEnd))));
          const newEdge={from:{...aEnd},to:{...bEnd}};
          const wasManual=[a,b].some(e=>graph.editorLayout.manualPaths[wireKey(e)]);
          for(const old of [a,b]){delete paths[wireKey(old)];delete graph.editorLayout.manualPaths[wireKey(old)];}
          graph.wires=graph.wires.filter(w=>w!==a&&w!==b);
          if(!sameEndpoint(aEnd,bEnd)&&!duplicate){
            graph.wires.push(newEdge);
            if(pathIsOrthogonal(joined)){paths[wireKey(newEdge)]=joined;
              if(wasManual)graph.editorLayout.manualPaths[wireKey(newEdge)]=true;}
          }
        }else{
          edges.forEach(({w})=>delete paths[wireKey(w)]);
          graph.wires=graph.wires.filter(w=>!edges.some(e=>e.w===w));
        }
        graph.components=graph.components.filter(c=>c.id!==id);
        repeat=true;break;
      }
    }
    routeCache.clear();
  }
  function restoreHistory(direction){
    if(submitting)return;
    const from=direction==="undo"?undoStack:redoStack;
    const to=direction==="undo"?redoStack:undoStack;
    if(!from.length)return;
    to.push(deep(graph));graph=deep(from.pop());ensureEditorLayout();
    committedGraph=deep(graph);routeCache.clear();
    intent("RESET");tapWireKey=null;tapPreview=null;
    changeSerial++;simGeneration++;dirty=true;simState={};pinValues={};outputValues={};simWarnings=[];
    result.hidden=true;
    status(direction==="undo"?"已撤销上一步编辑。":"已恢复下一步编辑。","success");
    render();scheduleSim();
  }
  function deleteSelected(){
    if(!selected || submitting)return;
    if(selected.kind==="wire") graph.wires.splice(selected.index,1);
    else {
      const required=graph.components.find(c=>c.id===selected.id);
      if((required?.type==="input"||required?.type==="output")
        && !window.confirm("这是本关必需的输入/输出端口，删除后必须重新放置才能保存。确定删除吗？"))return;
      const id=selected.id;
      graph.components=graph.components.filter(c=>c.id!==id);
      graph.wires=graph.wires.filter(w=>w.from.comp!==id&&w.to.comp!==id);
    }
    tidyDanglingJunctions();
    intent("RESET"); markChanged();
    status("已删除选中对象及其关联连线，并自动清理多余的接点。","success");
    render(); scheduleSim();
  }
  function rotateSelected(){
    if(submitting||selected?.kind!=="component")return;
    const component=graph.components.find(c=>c.id===selected.id);
    if(!component||component.type==="junction")return;
    component.rotation=((component.rotation||0)+90)%360;
    if(!component.rotation)delete component.rotation;
    markChanged({resetState:false});
    status(`已旋转 ${component.id}；各引脚身份与电气连接保持不变。`,"success");
    render();scheduleSim();
  }
  const sameEndpoint=(a,b)=>a.comp===b.comp&&a.pin===b.pin;
  function connect(a,b){
    const outcome=checkConnection(a,b,pinLookup);
    if(!outcome.valid){
      status(`${outcome.message}。保留原起点；请选择其他合法端口或按 Esc 取消。`,"error");
      render();return;
    }
    const {from,to}=outcome;
    const existing=graph.wires.some(w=>(sameEndpoint(w.from,from)&&sameEndpoint(w.to,to))||
                                       (sameEndpoint(w.from,to)&&sameEndpoint(w.to,from)));
    if(existing){
      intent("WIRE_DONE");status("这两个引脚已经相连，不需要重复接线。");render();return;
    }
    if(graph.wires.length>=1200){status("画布最多允许1200条线。","error");return;}
    const target=getPinPoint(nodeById().get(b.comp),pinLookup(b));
    let {route:newPath,verdict,join}=safeDraftRoute(target,target.side,true,b);
    if(verdict&&!verdict.ok && draftPoints.length===1){
      const fallback=fallbackDirectRoute(target,target.side,b);
      if(fallback){newPath=fallback;verdict={ok:true};}
    }
    if(verdict&&!verdict.ok){
      status(verdict.message+"。连线起点及已固定转折点均已保留。","error");renderPreview();return;
    }
    if(join){
      // An old endpoint may already be a real junction/device pin. Reuse it;
      // otherwise split the old wire and attach to the new three-way node.
      // The preview has already stopped at the first common point.
      if(join.reuseEndpoint){
        const outcome=checkConnection(join.attach,join.reuseEndpoint,pinLookup);
        if(outcome.valid && !graph.wires.some(w=>
          (sameEndpoint(w.from,outcome.from)&&sameEndpoint(w.to,outcome.to))||
          (sameEndpoint(w.to,outcome.from)&&sameEndpoint(w.from,outcome.to)))){
          const edge={from:outcome.from,to:outcome.to};
          graph.wires.push(edge);
          insertWirePath(edge,sameEndpoint(outcome.from,join.attach)?join.prefix:[...join.prefix].reverse());
          intent("WIRE_DONE");markChanged();
          status("已连到现有汇流点，未增加重复节点或重合导线。","success");
          render();scheduleSim();return;
        }
      }else if(branchFromWire(join.wireIndex,join.point,join.attach,join.prefix))return;
      status("汇流节点自动建立失败，原接线仍保留；请调整线路重试。","error");
      renderPreview();return;
    }
    const newWire={from,to};graph.wires.push(newWire);
    if(newPath){
      const oriented=sameEndpoint(from,a)?newPath:[...newPath].reverse();
      insertWirePath(newWire,oriented);
    }
    intent("WIRE_DONE");markChanged();
    status("连线已建立。多根线可以连接同一端子；若多个输出发生驱动冲突，模拟器将给出警告。","success");
    render();scheduleSim();
  }
  /** A freshly AUTO-created fork may start at the end of a 12-18-unit wide
   * duplicated corridor.  Consolidate only that local near-parallel case.
   * A user who deliberately clicked a wire to place a node retains the exact
   * location of their click (no unsolicited global "tidy" operation).
   */
  function consolidateAutomaticFork(id){
    const joint=nodeById().get(id);
    if(joint?.type!=='junction')return false;
    const layouts=ensureRoutes().map(r=>({points:r.points.map(p=>({...p}))}));
    const paths=new Map();
    for(const {w,index} of junctionEdges(id))
      if(pathIsOrthogonal(layouts[index]?.points))
        paths.set(wireKey(w),layouts[index].points);
    const origin={point:junctionCentre(joint),paths,snapWireIndex:-1};
    const refined=absorbJunctionOverlaps(id,layouts,origin);
    return refined?.kind==='absorbed-near-parallel'&&
      !sameXY(refined.point,origin.point)&&applyJunctionMove(id,refined);
  }
  /** Insert a tap at the EXACT projected click location. Never reroute the
   * original path, never snap a point off its segment, never pre-create a node.
   */
  function branchFromWire(index,point,attach=null,preparedPath=null){
    if(submitting||index<0||index>=graph.wires.length||!point)return false;
    if(graph.components.length>=300||graph.wires.length>=1199){
      status("元件或连线达到上限，请先整理画布。","error");return false;
    }
    const source=graph.wires[index],layout=getWireLayout(source,index);
    let attachPath=null;
    if(attach){
      const info=pinLookup(attach),jpin=shapes("junction").pins.find(p=>p.name==="out");
      if(!info||!jpin||info.width!==jpin.width){
        status("接线引脚的位宽不一致，无法接入当前导线。","error");return false;
      }
    }
    const projection=projectToPath(point,layout.points);
    if(!projection||projection.distance>WIRE_SNAP_PX*worldUnitsPerScreenPixel()){
      status("请靠近导线选择接点位置。","error");return false;
    }
    const halves=splitPathAt(layout.points,projection.point,10);
    if(!halves){status("接点距离线路端口过近。请在线段中间选择位置。","error");return false;}
    if(attach){
      let verdict;
      if(preparedPath){
        // A shared-terminal join reuses the exact geometry shown in preview.
        // Do not call auto-routing again or accidentally paint the shared tail.
        attachPath=compactPath(preparedPath);
        const originComp=nodeById().get(attach.comp),originPin=pinLookup(attach);
        const origin=originComp&&originPin&&getPinPoint(originComp,originPin);
        if(!origin||!pathIsOrthogonal(attachPath)||
           !sameXY(attachPath[0],origin)||!sameXY(attachPath.at(-1),halves.point)){
          status("自动汇流路径已经变化，请重新连接。","error");return false;
        }
        verdict=draftAssessment(attachPath,null,source,attach);
      }else{
        ({route:attachPath,verdict}=safeDraftRoute(halves.point,"any",true,null,source));
        if(verdict&&!verdict.ok&&draftPoints.length===1){
          const fallback=fallbackDirectRoute(halves.point,"any",null,source);
          if(fallback){attachPath=fallback;verdict={ok:true};}
        }
      }
      if(!verdict?.ok){status((verdict?.message||"线路无效")+"；请调整走线路径后再连接。","error");return false;}
    }
    const id=freshId("junction"),oldKey=wireKey(source);
    const junction={id,type:"junction",x:halves.point.x-14,y:halves.point.y-14};
    const first={from:{...source.from},to:{comp:id,pin:"a"}};
    const second={from:{comp:id,pin:"out"},to:{...source.to}};
    graph.components.push(junction);
    graph.wires.splice(index,1,first,second);
    const paths=ensureEditorLayout();
    const wasManual=Boolean(graph.editorLayout.manualPaths[oldKey]);
    delete paths[oldKey];delete graph.editorLayout.manualPaths[oldKey];
    paths[wireKey(first)]=halves.before;
    paths[wireKey(second)]=halves.after;
    if(wasManual){graph.editorLayout.manualPaths[wireKey(first)]=true;graph.editorLayout.manualPaths[wireKey(second)]=true;}
    if(attach){
      const outcome=checkConnection(attach,{comp:id,pin:"out"},pinLookup);
      if(outcome.valid && !graph.wires.some(w=>
        (sameEndpoint(w.from,outcome.from)&&sameEndpoint(w.to,outcome.to))||
        (sameEndpoint(w.to,outcome.from)&&sameEndpoint(w.from,outcome.to))))
      { const edge={from:outcome.from,to:outcome.to};
        graph.wires.push(edge);
        if(attachPath)insertWirePath(edge,sameEndpoint(outcome.from,attach)?attachPath:[...attachPath].reverse());
      }
    }
    if(attach&&preparedPath){
      routeCache.clear();
      consolidateAutomaticFork(id);
    }
    intent("RESET");
    markChanged({resetState:false});
    if(!attach){intent("PIN",{comp:id,pin:"out"});startDraft({comp:id,pin:"out"});}
    status(attach?(preparedPath?"已在导线最早重合点建立真实电气汇流节点，公共线段仅保留一份。":"已将端口准确接入选定的导线位置。原线路保持不变。"):
      "已在指定位置插入接点，原线保持原样；点击另一端口可拉出分支。","success");
    render();scheduleSim();return true;
  }
  function handlePin(endpoint){
    if(submitting)return;
    const effect=intent("PIN",endpoint);
    if(effect==="wire-start"){
      startDraft(endpoint);
      status(`从 ${endpoint.comp}.${endpoint.pin} 开始布线；移动鼠标预览，单击空白固定转折点，点击端子完成。`);
    }
    else if(effect==="wire-cancel") status("已取消这根未完成的连线，未向电路写入任何数据。");
    else if(effect && effect.type==="wire-attempt"){
      const targetComp=nodeById().get(endpoint.comp),targetPin=targetComp&&pinInfo(targetComp.type,endpoint.pin);
      const target=targetPin&&getPinPoint(targetComp,targetPin);
      connect(effect.from,effect.to);return;
    }
    render();
  }
  function renderResult(data){
    result.hidden=false;result.replaceChildren();
    const sub=data.submission||data;
    const line=$("div","ce-result-score",result,`通过 ${sub.passedCount} / 共 ${sub.totalCount} ${sub.unit||"组"}`);
    if(sub.completed) $("span","ce-complete-tag",line,"全部通过");
    if(sub.firstFailure){
      const f=sub.firstFailure;const box=$("div","ce-failure",result);
      $("h4","",box,"第一组失败");
      $("p","",box,`${f.kind==="step"?"时序脚本":"测试组"} ${f.groupNumber||f.stepNumber||""} · 输入：${JSON.stringify(f.inputs||{})}`);
      const table=$("div","ce-output-compare",box);
      Object.keys(f.expectedOutputs||{}).forEach(name=>$("p","",table,`${name}：期望 ${f.expectedOutputs[name]} / 实际 ${f.actualOutputs?.[name]??"无法稳定"}`));
    }
    (sub.warnings||[]).forEach(w=>$("p","ce-warning",result,w.message||String(w)));
    const count=$("p","",result,`本次元件数 ${sub.componentCount} · 最简元件数 ${sub.minimalComponentCount}`);
    if(sub.componentCount===sub.minimalComponentCount)$("span","ce-complete-tag",count,"精简");
    if(sub.completed){$("p","ce-success",result,"关卡完成！");if(data.package?.fresh)$("p","ce-success",result,`你封装了新元件：${data.package.name}`);}
    resultData=data;
  }
  function scheduleSim(advance=false){
    clearTimeout(simTimer);
    const epoch=++simEpoch;
    const generation=simGeneration;
    const graphSnapshot=deep(graph),inputSnapshot=deep(inputValues);
    const enqueue=()=>{
      // Input changes are simulated in click order, not merged away by debounce.
      // Topology edits invalidate older requests, but ordinary input toggles don't.
      simQueue=simQueue.catch(()=>{}).then(()=>simulate(epoch,generation,graphSnapshot,inputSnapshot,advance));
    };
    if(advance)enqueue();
    else simTimer=setTimeout(enqueue,160);
  }
  async function simulate(epoch,generation,graphSnapshot,inputSnapshot,advance){
    if(disposed||generation!==simGeneration)return;
    try{
      const r=await api("POST",`/api/levels/${encodeURIComponent(levelId)}/simulate`,{
        levelVersion:level.levelVersion,graph:graphSnapshot,inputs:inputSnapshot,
        state:deep(simState),cycles:advance?1:0,
      });
      if(disposed || generation!==simGeneration)return;
      // Even if a newer click happened, its simulation must inherit this state.
      simState=r.state||simState;
      if(epoch!==simEpoch)return;
      pinValues=r.pins||{};outputValues=r.outputs||{};
      simWarnings=r.warnings||[];lastSimError=null;
      render();
    }catch(e){
      if(disposed || generation!==simGeneration || epoch!==simEpoch)return;
      lastSimError=e.message||"模拟失败";simWarnings=[];pinValues={};outputValues={};
      if(e.code==="SHORT_CIRCUIT")lastSimError="电源短路："+lastSimError;
      render();
    }
  }
  async function save(){
    if(saveInProgress)return saveInProgress;
    const atSerial=changeSerial;
    const snapshot=deep(graph);
    const progress=deep(state);
    progress.circuitLevels??={};
    progress.circuitLevels[levelId]={levelVersion:level.levelVersion,graph:snapshot};
    saveBtn.disabled=true;
    const pending=(async()=>{
      try{
        await saveProgress(progress,"circuit_level_save");
        state.circuitLevels=progress.circuitLevels;
        dirty=changeSerial!==atSerial;
        status(dirty?"已保存提交时的版本；此后仍有新修改需要再次保存。":"电路图已保存。调试开关值不进入存档。","success");
        return true;
      }catch(e){
        status(e.code==="REVISION_CONFLICT"?"存档冲突：另一端已修改进度。为避免覆盖，请返回并刷新后重新进入。":`保存失败：${e.message||"请稍后重试"}`,"error");
        throw e;
      }finally{saveBtn.disabled=false;saveInProgress=null;}
    })();
    saveInProgress=pending;
    return pending;
  }
  async function submit(){
    if(submitting)return;
    submitting=true;submitBtn.disabled=true;saveBtn.disabled=true;runBtn.disabled=true;
    clearBtn.disabled=true;backBtn.disabled=true;
    submitBtn.textContent="评测中…";
    try{
      await save();
      if(dirty)await save(); // 手动保存与本次提交交错时，不提交尚未落库的新图
      const submittedGraph=deep(graph);
      const attempt=await api("POST",`/api/levels/${encodeURIComponent(levelId)}/attempts/start`,{levelVersion:level.levelVersion});
      const data=await api("POST",`/api/levels/${encodeURIComponent(levelId)}/submit`,{
        attemptId:attempt.attemptId,levelVersion:level.levelVersion,graph:submittedGraph
      });
      if(disposed)return;
      renderResult(data);
      status("评测完成。通过组数与首次失败详情均来自服务端。","success");
      if(data.record)bestText.textContent=`最佳记录：${data.record.bestPassedCount??data.passedCount}/${data.record.totalCount??"—"} ${data.record.unit||"组"}`;
      if(data.package?.fresh)status(`评测通过！你封装了新元件：${data.package.name}。`,"success");
      if(data.submission?.completed && ctx.completionHint)status(ctx.completionHint,"success");
    }catch(e){if(!disposed && e.code!=="REVISION_CONFLICT")status(`提交失败：${e.message||"请稍后重试"}`,"error");}
    finally{
      if(!disposed){submitting=false;submitBtn.disabled=false;saveBtn.disabled=false;runBtn.disabled=false;clearBtn.disabled=false;backBtn.disabled=false;submitBtn.textContent="提交评测";}
    }
  }
  function showPackage(pkg){
    api("GET",`/api/circuit/components/${encodeURIComponent(pkg.symbol)}/${pkg.version}`).then(reply=>{
      if(disposed)return;
      const overlay=$("div","ce-modal",host),panel=$("section","ce-modal-panel",overlay);
      $("h3","",panel,`封装内部：${reply.component.name}`);
      $("p","ce-muted",panel,"只读视图 · 引脚顺序与封装定义保持一致");
      const preview=svgEl("svg",{class:"ce-package-preview",viewBox:"0 0 1100 680",role:"img","aria-label":"封装内部电路只读预览"},panel);
      const inner=reply.component.graph;
      const nodes=new Map(inner.components.map(c=>[c.id,c]));
      const getInnerPoint=(comp,pin)=>getPinPoint(comp,pin);
      const offsetX=100,offsetY=80;
      inner.wires.forEach(w=>{
        const a=nodes.get(w.from.comp),b=nodes.get(w.to.comp);if(!a||!b)return;
        const pa=getInnerPoint(a,{...pinInfo(a.type,w.from.pin),name:w.from.pin});
        const pb=getInnerPoint(b,{...pinInfo(b.type,w.to.pin),name:w.to.pin});
        const layout=routeOrthogonal(pa,pb,inner.components.map(c=>({x:c.x,y:c.y,...dims(c)})));
        svgEl("path",{d:layout.path,class:"ce-wire",transform:`translate(${offsetX} ${offsetY})`},preview);
      });
      inner.components.forEach(c=>{
        const shape=shapes(c.type),d=dims(c),g=svgEl("g",{transform:`translate(${c.x+offsetX} ${c.y+offsetY})`,class:"ce-component"},preview);
        if(c.type!=="junction")svgEl("rect",{x:0,y:0,width:d.w,height:d.h,rx:8,class:"ce-component-hit"},g);
        const base=baseDims(c),angle=c.rotation||0;
        const symbol=angle?svgEl("g",{transform:`translate(${d.w/2} ${d.h/2}) rotate(${angle}) translate(${-base.w/2} ${-base.h/2})`},g):g;
        drawSymbol(symbol,c,shape,base.w,base.h);
        if(c.type!=="junction")svgEl("text",{x:d.w/2,y:d.h-4,"text-anchor":"middle",class:"ce-component-label"},g).textContent=shape.name||LABELS[c.type]||c.type;
        if(c.type!=="junction")shape.pins.forEach(pin=>{
          const pos=getInnerPoint(c,pin);
          svgEl("circle",{cx:pos.x-c.x,cy:pos.y-c.y,r:4,class:"ce-pin-dot"},g);
          svgEl("text",{x:pos.x-c.x+(pos.side==="left"?10:pos.side==="right"?-10:0),y:pos.y-c.y-8,
            "text-anchor":pos.side==="left"?"start":pos.side==="right"?"end":"middle",class:"ce-pin-label"},g).textContent=pin.name;
        });
      });
      const close=$("button","ce-button",panel,"关闭");close.addEventListener("click",()=>overlay.remove());
    }).catch(e=>status(e.message||"封装读取失败"));
  }
  function clearCanvas(){
    if(submitting)return;
    if(!window.confirm("确定清空画布？所有连线与内部元件将被移除，关卡要求的输入/输出端口会保留。"))return;
    const initialPorts=(level.initialGraph?.components||[]).filter(c=>c.type==="input"||c.type==="output");
    graph={schemaVersion:level.circuitSchemaVersion||1,components:deep(initialPorts),wires:[]};
    arrangePorts();
    intent("RESET"); markChanged();
    status("画布已清空。已保留关卡必需的输入/输出端口，以便继续保存和提交。","success");
    render();scheduleSim();
  }

  saveBtn.addEventListener("click",()=>{void save().catch(()=>{});});
  runBtn.addEventListener("click",()=>{
    if(submitting)return;
    status("正在运行当前电路：输入开关可随时切换；完整成绩请使用「提交评测」。");
    scheduleSim();
  });
  deleteBtn.addEventListener("click",()=>deleteSelected());
  undoBtn.addEventListener("click",()=>restoreHistory("undo"));
  redoBtn.addEventListener("click",()=>restoreHistory("redo"));
  directionBtn.addEventListener("click",()=>{
    horizontalFirst=!horizontalFirst;
    directionBtn.textContent=horizontalFirst?"横向优先":"纵向优先";
    status("已切换布线方向；移动鼠标查看折线预览。","info");renderPreview();
  });
  submitBtn.addEventListener("click",()=>{void submit();});
  clearBtn.addEventListener("click",clearCanvas);
  const canLeave=()=>!(submitting || saveInProgress)
    && (!dirty || window.confirm("当前电路尚未保存，仍要退出吗？"));
  backBtn.addEventListener("click",async()=>{
    if(!canLeave())return;
    try{await exit();}catch(e){status(`退出失败：${e.message||"请重试"}`,"error");}
  });
  resetSim.addEventListener("click",()=>{
    if(submitting)return;
    simGeneration++;simState={};pinValues={};outputValues={};
    status("已清零时序状态，正在重新模拟。");scheduleSim();render();
  });
  function changeZoom(next,point){
    const target=Math.max(minZoom(),Math.min(MAX_ZOOM,Math.round(next*100)/100));
    if(target===zoom)return;
    const svgPoint=svg.createSVGPoint();
    if(point){svgPoint.x=point.clientX;svgPoint.y=point.clientY;}
    else{const bounds=svg.getBoundingClientRect();svgPoint.x=bounds.left+bounds.width/2;svgPoint.y=bounds.top+bounds.height/2;}
    const inv=svg.getScreenCTM()?.inverse();
    const canvasPoint=inv?svgPoint.matrixTransform(inv):{x:800,y:500};
    const worldPoint={x:(canvasPoint.x-panX)/zoom,y:(canvasPoint.y-panY)/zoom};
    zoom=target;panX=canvasPoint.x-worldPoint.x*zoom;panY=canvasPoint.y-worldPoint.y*zoom;
    zoomLabel.textContent=zoomText();setWorldTransform();
  }
  // Relocate all circuit components after exploring a large, bounded page.
  function fitCircuit(){
    if(!graph.components.length){
      zoom=1;panX=0;panY=0;
    }else{
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const c of graph.components){
        const {w,h}=dims(c);
        minX=Math.min(minX,c.x);minY=Math.min(minY,c.y);
        maxX=Math.max(maxX,c.x+w);maxY=Math.max(maxY,c.y+h);
      }
      const width=Math.max(maxX-minX,200),height=Math.max(maxY-minY,140);
      const candidate=Math.min((VIEW_WIDTH-320)/width,(VIEW_HEIGHT-280)/height);
      zoom=Math.max(minZoom(),Math.min(1.25,Math.round(candidate*100)/100));
      panX=VIEW_WIDTH/2-zoom*(minX+maxX)/2;
      panY=VIEW_HEIGHT/2-zoom*(minY+maxY)/2;
    }
    zoomLabel.textContent=zoomText();
    setWorldTransform();
  }
  fitBtn.title="定位全部元件（快捷键 F）";
  zoomIn.addEventListener("click",()=>changeZoom(zoom+.1));
  zoomOut.addEventListener("click",()=>changeZoom(zoom-.1));
  fitBtn.addEventListener("click",fitCircuit);
  canvasWrap.addEventListener("dragover",e=>{e.preventDefault();e.dataTransfer.dropEffect="copy";});
  canvasWrap.addEventListener("drop",e=>{
    e.preventDefault();if(submitting)return;
    const type=e.dataTransfer.getData("text/circuit-type");
    if(!type || !(paletteTypes.includes(type)||palettePackages.some(p=>p.type===type)))return;
    intent("DROP");addComponent(type,toWorld(e));
  });
  /** A real junction is a movable electrical vertex, not a decorative dot.
   * Moving it must reanchor *every* incident wire in one transaction, while
   * keeping unrelated nets and the far ends of those wires unchanged.
   */
  const junctionCentre=c=>({x:c.x+14,y:c.y+14});
  const junctionEdges=id=>graph.wires.map((w,index)=>({w,index}))
    .filter(({w})=>w.from.comp===id||w.to.comp===id);
  /** A component owns nearby junctions only when the connection visibly
   * forms a short escape from that component.  Distant shared trunks and
   * junctions sitting beside ANOTHER component remain stationary.
   */
  function componentFollowerCandidates(id,layouts){
    const component=nodeById().get(id);
    if(!component||component.type==='junction')return [];
    const candidates=[];
    for(const {w,index} of graph.wires.map((w,index)=>({w,index}))){
      const source=w.from.comp===id?w.from:w.to.comp===id?w.to:null;
      if(!source)continue;
      const other=w.from.comp===id?w.to:w.from;
      const joint=nodeById().get(other.comp),pin=pinLookup(source);
      if(joint?.type!=='junction'||!pin)continue;
      const centre=junctionCentre(joint),out=getPinPoint(component,pin),
        distance=Math.hypot(centre.x-out.x,centre.y-out.y);
      if(distance>114||distance<15||junctionEdges(joint.id).length<3)continue;
      const route=layouts[index]?.points;
      if(!pathIsOrthogonal(route)||pathDistance(route)>180)continue;
      // Do not drag a junction that has already become another device's
      // connector.  Such shared structure belongs to the stationary circuit.
      const anotherNearbyDevice=junctionEdges(joint.id).some(({w:edge})=>{
        const neighbour=edge.from.comp===joint.id?edge.to:edge.from;
        if(neighbour.comp===id)return false;
        const c=nodeById().get(neighbour.comp),p=pinLookup(neighbour);
        if(!c||c.type==='junction'||!p)return false;
        const at=getPinPoint(c,p);
        return Math.hypot(at.x-centre.x,at.y-centre.y)<85;
      });
      if(anotherNearbyDevice)continue;
      if(!candidates.some(x=>x.id===joint.id))
        candidates.push({id:joint.id,origin:{x:joint.x,y:joint.y},distance});
    }
    return candidates.sort((a,b)=>a.distance-b.distance).slice(0,2);
  }
  /** Check prospective follower centres without mutating topology. */
  function followersCanMove(followers,offset,componentId,baseLayouts){
    if(!followers.length)return false;
    const moving=new Set([componentId,...followers.map(f=>f.id)]);
    const {ids,endpointNet}=electricalNets();
    return followers.every(f=>{
      const point={x:f.origin.x+14+offset.x,y:f.origin.y+14+offset.y};
      if(!withinWorkspace(point))return false;
      if(graph.components.some(c=>!moving.has(c.id)&&
        (c.type==='junction'?Math.hypot(c.x+14-point.x,c.y+14-point.y)<22:
          point.x>c.x-12&&point.x<c.x+dims(c).w+12&&
          point.y>c.y-12&&point.y<c.y+dims(c).h+12)))return false;
      const net=endpointNet({comp:f.id,pin:'out'});
      return !graph.wires.some((w,i)=>!moving.has(w.from.comp)&&
        !moving.has(w.to.comp)&&ids[i]!==net&&
        (projectToPath(point,baseLayouts[i]?.points||[])?.distance??Infinity)<8);
    });
  }
  /** Commit a component+junction translation only if *every* changed leg can
   * reconnect safely. Otherwise the component still moves on its own, while
   * the follower nodes and their old geometry remain untouched.
   */
  function componentFollowerPaths(active){
    const followers=active.activeFollowers||[];
    if(!followers.length)return null;
    const moved=new Set([active.id,...followers.map(f=>f.id)]);
    const {ids}=electricalNets(),old=active.originRoutes;
    const untouched=graph.wires.flatMap((w,i)=>moved.has(w.from.comp)||moved.has(w.to.comp)?[]:
      occupiedSegments(old[i]?.points||[],ids[i]));
    const planned=new Map(),occupied=[...untouched];
    const byId=nodeById();
    for(let i=0;i<graph.wires.length;i++){
      const w=graph.wires[i];
      if(!moved.has(w.from.comp)&&!moved.has(w.to.comp))continue;
      const previous=old[i]?.points;
      if(!pathIsOrthogonal(previous))return null;
      const fromComponent=byId.get(w.from.comp),toComponent=byId.get(w.to.comp);
      const fp=pinLookup(w.from),tp=pinLookup(w.to);
      const from=fromComponent&&fp&&getPinPoint(fromComponent,fp);
      const to=toComponent&&tp&&getPinPoint(toComponent,tp);
      if(!from||!to||sameXY(from,to))return null;
      // Exclude both true terminal components; all other devices and copper
      // nodes remain physical obstacles.
      const rects=graph.components.filter(c=>c.id!==w.from.comp&&c.id!==w.to.comp)
        .map(c=>c.type==='junction'?{x:c.x+5,y:c.y+5,w:18,h:18}:
          {x:c.x,y:c.y,...dims(c)});
      const isBoth=moved.has(w.from.comp)&&moved.has(w.to.comp);
      const dx=from.x-previous[0].x,dy=from.y-previous[0].y;
      const translated=isBoth&&Math.abs(to.x-previous.at(-1).x-dx)<0.01&&
        Math.abs(to.y-previous.at(-1).y-dy)<0.01?
        previous.map(p=>({x:p.x+dx,y:p.y+dy})):null;
      const candidate=translated||reanchorPath(previous,from,to);
      let route=safeLegPath(candidate,from,to,rects,occupied,ids[i])?candidate:null;
      if(!route){
        const rerouted=routeOrthogonal(from,to,rects,{occupied,net:ids[i],
          clearance:8,preferSparse:true,forbidForeignOverlap:true,forceSearch:true});
        if(rerouted.avoided&&safeLegPath(rerouted.points,from,to,rects,occupied,ids[i]))
          route=rerouted.points;
      }
      // Do not translate the node if doing so would badly rearrange another
      // existing route; that is a normal component drag, not a safe follower.
      if(!route||pathDistance(route)>pathDistance(previous)*1.45+90||
        Math.max(0,route.length-previous.length)>2)return null;
      planned.set(wireKey(w),compactPath(route));
      occupied.push(...occupiedSegments(route,ids[i]));
    }
    return planned;
  }
  const pathDistance=path=>path.slice(1).reduce((sum,p,i)=>sum+
    Math.abs(p.x-path[i].x)+Math.abs(p.y-path[i].y),0);
  const pathTurnCost=path=>Math.max(0,compactPath(path).length-2)*24;
  const normalizedPoint=p=>({x:Math.round(p.x*100)/100,y:Math.round(p.y*100)/100});
  // A foreign junction dot is a physical visual obstacle, not merely a zero-
  // sized component. Never run another net's new wire through its centre.
  const junctionLegObstacles=(movingId,otherId)=>graph.components
    .filter(c=>c.id!==movingId&&c.id!==otherId)
    .map(c=>c.type==='junction'
      ? {x:c.x+5,y:c.y+5,w:18,h:18}
      : {x:c.x,y:c.y,...dims(c)});
  // Intentional node-on-node drags merge existing copper only within the SAME
  // already-connected electrical net.  A near miss on a foreign net can never
  // silently short two circuit signals.
  const nearestMergeNode=(id,point)=>{
    const radius=Math.min(34,Math.max(18,16*worldUnitsPerScreenPixel()));
    return graph.components.filter(c=>c.type==='junction'&&c.id!==id)
      .map(c=>({id:c.id,point:junctionCentre(c),distance:Math.hypot(
        junctionCentre(c).x-point.x,junctionCentre(c).y-point.y)}))
      .filter(hit=>hit.distance<=radius)
      .sort((a,b)=>a.distance-b.distance)[0]||null;
  };
  const safeLegPath=(points,from,to,obstacles,occupied,net)=>
    pathIsOrthogonal(points)&&sameXY(points[0],from)&&sameXY(points.at(-1),to)&&
    points.every(withinWorkspace)&&!pathHitsObstacles(points,obstacles,4)&&
    unrelatedOverlap(points,occupied,net)<0.01;
  function junctionMergePlan(id,targetId,baseLayouts){
    const byId=nodeById(),source=byId.get(id),target=byId.get(targetId);
    if(source?.type!=='junction'||target?.type!=='junction'||id===targetId)return null;
    const {ids,endpointNet}=electricalNets();
    const net=endpointNet({comp:id,pin:'out'});
    if(net!==endpointNet({comp:targetId,pin:'out'}))return null;
    const point=junctionCentre(target),incident=junctionEdges(id);
    const occupied=graph.wires.flatMap((w,i)=>incident.some(e=>e.index===i)?[]:
      occupiedSegments(baseLayouts[i]?.points||[],ids[i]));
    const routes=new Map(),previous=[];
    // Even when the two dots are on opposite sides of crowded circuitry, the
    // existing net already contains a physically routed connection between
    // them. It is a guaranteed topology-preserving fallback when A* cannot
    // reconstruct every branch directly to the surviving dot.
    const canonical=e=>`${e.comp}:${byId.get(e.comp)?.type==='junction'?'out':e.pin}`;
    const adjacency=new Map();
    graph.wires.forEach((wire,i)=>{
      if(ids[i]!==net||!pathIsOrthogonal(baseLayouts[i]?.points))return;
      const a=canonical(wire.from),b=canonical(wire.to),route=baseLayouts[i].points;
      if(!adjacency.has(a))adjacency.set(a,[]);
      if(!adjacency.has(b))adjacency.set(b,[]);
      adjacency.get(a).push({to:b,points:route,weight:pathDistance(route)});
      adjacency.get(b).push({to:a,points:[...route].reverse(),weight:pathDistance(route)});
    });
    const networkPath=()=>{
      const start=`${targetId}:out`,end=`${id}:out`;
      const costs=new Map([[start,0]]),previousLink=new Map(),queue=[start];
      while(queue.length){
        queue.sort((a,b)=>costs.get(a)-costs.get(b));
        const at=queue.shift();
        if(at===end)break;
        for(const step of adjacency.get(at)||[]){
          const cost=costs.get(at)+step.weight;
          if(cost>=(costs.get(step.to)??Infinity))continue;
          costs.set(step.to,cost);previousLink.set(step.to,{from:at,points:step.points});
          if(!queue.includes(step.to))queue.push(step.to);
        }
      }
      if(!costs.has(end))return null;
      const sections=[];let at=end;
      while(at!==start){const step=previousLink.get(at);if(!step)return null;
        sections.unshift(step.points);at=step.from;}
      const combined=compactPath(sections.flatMap((section,i)=>i?section.slice(1):section));
      return pathIsOrthogonal(combined)?combined:null;
    };
    let existingPath=null;
    for(const {w,index} of incident){
      const far=w.from.comp===id?w.to:w.from;
      if(far.comp===targetId)continue; // this connecting leg disappears
      const old=baseLayouts[index]?.points;
      if(!pathIsOrthogonal(old))return null;
      const from=w.from.comp===id?point:old[0];
      const to=w.to.comp===id?point:old.at(-1);
      if(sameXY(from,to))return null;
      const obstacles=graph.components.filter(c=>c.id!==targetId&&c.id!==id&&
        c.id!==far.comp).map(c=>c.type==='junction'?{x:c.x+5,y:c.y+5,w:18,h:18}:
          {x:c.x,y:c.y,...dims(c)});
      const conductors=[...occupied,...previous];
      const candidate=reanchorPath(old,from,to);
      let best=safeLegPath(candidate,from,to,obstacles,conductors,net)?candidate:null;
      if(!best){
        const farComp=byId.get(far.comp),farPin=pinLookup(far);
        const farPoint=farComp&&farPin?getPinPoint(farComp,farPin):null;
        if(!farPoint)return null;
        for(const clearance of [12,4]){
          const route=routeOrthogonal(
            w.from.comp===id?{...point,side:'any'}:farPoint,
            w.to.comp===id?{...point,side:'any'}:farPoint,
            obstacles,{occupied:conductors,net,clearance,preferSparse:true,
              forbidForeignOverlap:true,forceSearch:true});
          if(route.avoided&&safeLegPath(route.points,from,to,obstacles,conductors,net)){
            best=route.points;break;
          }
        }
      }
      if(!best){
        if(existingPath===null)existingPath=networkPath();
        if(existingPath){
          const outward=w.from.comp===id?old:[...old].reverse();
          const along=compactPath([...existingPath,...outward.slice(1)]);
          const via=w.from.comp===id?along:[...along].reverse();
          // This route uses ONLY wires that already belong to this net;
          // do not fabricate a new path across a foreign conductor or device.
          const nonElectricalObstacles=graph.components.filter(c=>
            c.type!=='junction'&&c.id!==far.comp).map(c=>({x:c.x,y:c.y,...dims(c)}));
          if(pathIsOrthogonal(via)&&via.length>=2&&
             sameXY(via[0],from)&&sameXY(via.at(-1),to)&&
             via.every(withinWorkspace)&&
             !pathHitsObstacles(via,nonElectricalObstacles,0)&&
             unrelatedOverlap(via,conductors,net)<0.01)best=via;
        }
      }
      if(!best)return null;
      routes.set(wireKey(w),best);
      previous.push(...occupiedSegments(best,net));
    }
    return {kind:'merge',mergeTargetId:targetId,point,paths:routes,score:0,snapWireIndex:-1};
  }
  /** Dragging an *existing* junction is a local geometry edit, not a request
   * to auto-route every wire from scratch. Preserve the old wire corridors,
   * including intentional crossings with independent nets. The ordinary
   * obstacle router is ONLY a fallback when no safe anchored edit exists.
   *
   * We compare how much of the original copper is actually changed (rather
   * than the congestion around it). This avoids repeated parallel legs,
   * gratuitous elbows, and A* zigzags after an otherwise harmless drag.
   */
  function movableJunctionPaths(id,at,baseLayouts){
    const edges=junctionEdges(id);
    if(!edges.length)return null;
    const {ids}=electricalNets();
    const edgeIndices=new Set(edges.map(e=>e.index));
    const stationary=graph.wires.flatMap((w,i)=>edgeIndices.has(i)?[]:
      occupiedSegments(baseLayouts[i]?.points||[],ids[i]));
    const plans=new Map(),alreadyPlanned=[];
    for(const {w,index} of edges){
      const original=baseLayouts[index]?.points;
      if(!pathIsOrthogonal(original))return null;
      const atStart=w.from.comp===id;
      const outward=atStart?original:[...original].reverse();
      const far=w.from.comp===id?w.to:w.from;
      const fixedComponent=nodeById().get(far.comp);
      const fixedPin=fixedComponent&&pinLookup(far);
      const fixed=fixedComponent&&fixedPin?getPinPoint(fixedComponent,fixedPin):outward.at(-1);
      if(!fixed||Math.abs(at.x-fixed.x)+Math.abs(at.y-fixed.y)<16)return null;
      const obstacles=junctionLegObstacles(id,far.comp);
      const occupied=[...stationary,...alreadyPlanned];
      const originalLength=pathDistance(original);
      const oldCopper=occupiedSegments(original,'original-path');
      const originalOverlap=collinearOverlap(original,stationary);
      const originalSiblingOverlap=collinearOverlap(original,alreadyPlanned);
      const candidates=[];
      const seen=new Set();
      const add=(outwards,kind,anchorDistance=0)=>{
        const route=compactPath(atStart?outwards:[...outwards].reverse());
        if(!pathIsOrthogonal(route)||!sameXY(route[0],atStart?at:fixed)||
           !sameXY(route.at(-1),atStart?fixed:at)||
           !route.every(withinWorkspace))return;
        const sig=JSON.stringify(route);
        if(seen.has(sig))return;
        seen.add(sig);
        // A perpendicular intersection is allowed and remains electrically
        // unconnected. Only component collisions and NEW different-net
        // coincident segments are disallowed.
        if(pathHitsObstacles(route,obstacles,4)||
           unrelatedOverlap(route,occupied,ids[index])>0.01)return;
        const length=pathDistance(route);
        const shared=Math.min(originalLength,length,
          collinearOverlap(route,oldCopper));
        const change=originalLength+length-2*shared;
        const newOverlap=Math.max(0,collinearOverlap(route,stationary)-originalOverlap);
        const siblingRetrace=Math.max(0,
          collinearOverlap(route,alreadyPlanned)-originalSiblingOverlap);
        const addedTurns=Math.max(0,compactPath(route).length-compactPath(original).length);
        let tiny=0;
        for(let j=2;j<route.length;j++){
          const segment=Math.abs(route[j-1].x-route[j-2].x)+
            Math.abs(route[j-1].y-route[j-2].y);
          if(segment<15)tiny++;
        }
        // Minimize changed copper first, but strongly discourage a new leg
        // retracing a sibling branch of this very junction. That backtrack
        // is exactly the double copper / awkward kink users see when they
        // slide a fork along its existing trunk. Pre-existing overlap is
        // not charged, and ordinary perpendicular crossings cost nothing.
        const score=change*2.5+Math.max(0,length-originalLength)*0.48+
          addedTurns*85+tiny*13+newOverlap*0.35+
          siblingRetrace*20+(siblingRetrace>8?650:0)+anchorDistance*0.06;
        candidates.push({route,score,kind});
      };
      for(const option of junctionReanchorCandidates(outward,at)){
        const distance=pathDistance(outward.slice(0,option.preservedFrom+1));
        add(option.points,option.kind,distance);
      }
      candidates.sort((a,b)=>a.score-b.score);
      // Keep even a nearby parallel lane or an existing crossing if its
      // locally updated path is legal. Do NOT invoke global A* on crowding,
      // extra turns, or overlap with our OWN net.
      if(!candidates.length){
        // When a moved node really crosses a device, first route ONLY the
        // modified lead-in and keep the old far-end bends and crossings.
        // This is substantially more predictable than redrawing the full leg.
        let distance=0;
        for(let k=1;k<outward.length&&k<=6;k++){
          distance+=Math.abs(outward[k].x-outward[k-1].x)+
            Math.abs(outward[k].y-outward[k-1].y);
          if(distance>680&&k>2)break;
          const anchor=outward[k];
          if(sameXY(anchor,at)){
            add([at,...outward.slice(k+1)],'fixed-tail',distance);
            continue;
          }
          for(const clearance of [4,0]){
            const bridge=routeOrthogonal({...at,side:'any'},
              {...anchor,side:'any'},obstacles,{occupied,net:ids[index],
                clearance,forbidForeignOverlap:true,forceSearch:true});
            if(!bridge.avoided)continue;
            add([...bridge.points,...outward.slice(k+1)],'local-obstacle-detour',distance);
            if(candidates.length)break;
          }
          // A legal local detour is preferred to routes which change further
          // original corners. There is no reason to search the whole board.
          if(candidates.length)break;
        }
      }
      if(!candidates.length&&fixedComponent&&fixedPin){
        // Final fallback: full search is justified only when no local edit
        // fits the component and electrical clearance constraints.
        for(const clearance of [8,4,0]){
          const searched=routeOrthogonal({...at,side:'any'},
            {...fixed,side:fixed.side||'any'},obstacles,{occupied,
              net:ids[index],clearance,stubLength:Math.max(22,clearance+8),
              forbidForeignOverlap:true,preferSparse:true,forceSearch:true});
          if(searched.avoided){add(searched.points,'full-obstacle-detour');
            if(candidates.length)break;}
        }
      }
      candidates.sort((a,b)=>a.score-b.score);
      if(!candidates.length)return null;
      plans.set(wireKey(w),candidates[0].route);
      alreadyPlanned.push(...occupiedSegments(candidates[0].route,ids[index]));
    }
    return plans;
  }
  function junctionMoveCandidates(id,desired,baseLayouts,allowSnap=true){
    const all=[{point:desired,kind:'direct',index:-1}],seen=new Set();
    const add=(p,kind,index=-1,distanceLimit=29)=>{
      if(!p||Math.hypot(p.x-desired.x,p.y-desired.y)>distanceLimit)return;
      const point=normalizedPoint(p),key=`${point.x}:${point.y}:${kind}:${index}`;
      // Even if projection equals the mouse point, retain the *trunk*
      // interpretation: a direct position alone would show a dot without
      // rewriting the underlying edge into a genuine netlist branch.
      if(seen.has(key))return;
      seen.add(key);all.push({point,kind,index});
    };
    if(!allowSnap)return all;
    // Sliding on any incident segment is more predictable than shifting all
    // the bends of a carefully constructed circuit.  Larger tolerance makes
    // this work even when the user misses the thin 2px line.
    for(const {w,index} of junctionEdges(id)){
      const original=baseLayouts[index]?.points;
      if(!pathIsOrthogonal(original))continue;
      const outward=w.from.comp===id?original:[...original].reverse();
      const projection=projectToPath(desired,outward);
      if(projection&&projection.distance<=22&&
         pathDistance(outward.slice(0,projection.index+1).concat([projection.point]))<340&&
         !sameXY(projection.point,outward.at(-1))&&
         Math.hypot(projection.point.x-outward[0].x,
           projection.point.y-outward[0].y)>=18){
        add(projection.point,'slide',index,22);
      }
    }
    const {ids,endpointNet}=electricalNets();
    const net=endpointNet({comp:id,pin:'out'});
    for(const {w,index} of graph.wires.map((w,index)=>({w,index}))){
      if(ids[index]!==net)continue;
      const route=baseLayouts[index]?.points;
      if(!pathIsOrthogonal(route))continue;
      // Existing right-angle corners make natural, non-decorative forks.
      for(const p of route.slice(1,-1))
        add(p,'elbow',index,26);
      if(w.from.comp===id||w.to.comp===id)continue;
      const proj=projectToPath(desired,route);
      if(proj && splitPathAt(route,proj.point,18))
        add(proj.point,'trunk',index,15);
    }
    return all;
  }
  function junctionMovePlan(id,desired,baseLayouts,{snap=true}={}){
    const node=nodeById().get(id);
    if(!node||node.type!=='junction')return null;
    const {ids,endpointNet}=electricalNets();
    const ownNet=endpointNet({comp:id,pin:'out'});
    const candidates=junctionMoveCandidates(id,desired,baseLayouts,snap);
    let best=null;
    for(const candidate of candidates){
      const {point,kind,index}=candidate;
      const isExternalTap=index>=0&&
        graph.wires[index].from.comp!==id&&graph.wires[index].to.comp!==id&&
        (kind==='trunk'||kind==='elbow');
      if(isExternalTap){
        const target=graph.wires[index],neighbours=junctionEdges(id)
          .map(({w})=>w.from.comp===id?w.to:w.from);
        const first=neighbours.some(e=>sameEndpoint(e,target.from));
        const last=neighbours.some(e=>sameEndpoint(e,target.to));
        // Reuse an already-connected trunk; introducing a parallel A->J edge
        // would merely replace one doubled conductor with another.
        if(first===last||!splitPathAt(baseLayouts[index].points,point,18))continue;
        const other=first?target.to:target.from;
        if(graph.wires.some((w,i)=>i!==index&&
          ((w.from.comp===id&&sameEndpoint(w.to,other))||
           (w.to.comp===id&&sameEndpoint(w.from,other)))))continue;
      }
      if(!withinWorkspace(point))continue;
      if(graph.components.some(c=>c.type==='junction'&&c.id!==id&&
        Math.hypot(junctionCentre(c).x-point.x,junctionCentre(c).y-point.y)<19))continue;
      // A solid electrical dot on a *different net* would visually claim a
      // short circuit. Reject rather than silently attaching two signals.
      if(baseLayouts.some((layout,i)=>ids[i]!==ownNet &&
        projectToPath(point,layout?.points||[])?.distance<6))continue;
      if(graph.components.some(c=>c.type!=='junction'&&
        point.x>c.x-8&&point.x<c.x+dims(c).w+8&&
        point.y>c.y-8&&point.y<c.y+dims(c).h+8))continue;
      const plans=movableJunctionPaths(id,point,baseLayouts);
      if(!plans)continue;
      let total=0;
      for(const path of plans.values())total+=pathDistance(path)+pathTurnCost(path);
      // A junction placed exactly at an existing corner or same-net trunk
      // is preferred, but only when the extra geometry is comparable.
      const bonus=kind==='slide'?28:kind==='elbow'?22:kind==='trunk'?15:0;
      const deviation=Math.hypot(point.x-desired.x,point.y-desired.y)*5.8;
      const baselineTotal=junctionEdges(id).reduce((n,e)=>
        n+pathDistance(baseLayouts[e.index]?.points||[])+
        pathTurnCost(baseLayouts[e.index]?.points||[]),0);
      // Compare the CHANGES, not the absolute length of every leg.  Moving
      // the cursor should not teleport a joint across the circuit simply
      // because a remote layout would have shorter wires.
      const score=(total-baselineTotal)*0.32-bonus+deviation;
      if(!best||score<best.score-0.01)
        best={point,paths:plans,score,kind,snapWireIndex:(kind==='trunk'||(kind==='elbow'&&index>=0&&
        graph.wires[index].from.comp!==id&&graph.wires[index].to.comp!==id))?index:-1};
    }
    return best;
  }
  /** Snapping to a dense layout should not feel like a failed drag.
   * Only when the exact requested location is invalid, look for a safe point
   * in the nearest 12-unit ring (up to 36 on release). Never teleport a node
   * across a gate or across the canvas in the name of beautification.
   */
  function closestSafeJunctionMove(id,desired,baseLayouts,{snap=false,extended=false}={}){
    const collision=nearestMergeNode(id,desired);
    if(collision){
      // No fallback to a nearby empty position: it must either be a genuine
      // same-net merge or an explicitly invalid attempt.
      return junctionMergePlan(id,collision.id,baseLayouts);
    }
    const direct=junctionMovePlan(id,desired,baseLayouts,{snap});
    if(direct)return direct;
    // The user explicitly dropped ON a different signal's conductor.
    // A nearby arbitrary position would look like a merged copper joint,
    // so do not silently displace that request to the other side of a net.
    const {ids,endpointNet}=electricalNets();
    const ownNet=endpointNet({comp:id,pin:'out'});
    if(baseLayouts.some((layout,i)=>ids[i]!==ownNet&&
      (projectToPath(desired,layout?.points||[])?.distance??Infinity)<=7))return null;
    const rings=extended?[12,24,36]:[12];
    const directions=[[1,0],[-1,0],[0,1],[0,-1],
      [1,1],[1,-1],[-1,1],[-1,-1]];
    for(const radius of rings){
      let best=null;
      for(const [dx,dy] of directions){
        const point={x:desired.x+dx*radius,y:desired.y+dy*radius};
        if(!withinWorkspace(point))continue;
        const plan=junctionMovePlan(id,point,baseLayouts,{snap:false});
        if(!plan)continue;
        const distance=Math.hypot(point.x-desired.x,point.y-desired.y);
        const rank=distance+plan.score*0.005;
        if(!best||rank<best.rank)best={...plan,rank};
      }
      if(best){delete best.rank;return best;}
    }
    return null;
  }
  /** If two outgoing legs have the same geometric prefix, the dot belongs at
   * the point where they finally diverge, not at the beginning of a doubled
   * run. This only considers wires already incident to this junction.
   */
  function sharedOutgoingFork(left,right){
    if(!pathIsOrthogonal(left)||!pathIsOrthogonal(right)||
       !sameXY(left[0],right[0]))return null;
    let i=0,j=0,at={...left[0]},length=0;
    for(let step=0;step<left.length+right.length+4;step++){
      if(i>=left.length-1||j>=right.length-1)break;
      const a=left[i+1],b=right[j+1];
      const da={x:Math.sign(a.x-at.x),y:Math.sign(a.y-at.y)};
      const db={x:Math.sign(b.x-at.x),y:Math.sign(b.y-at.y)};
      if(da.x!==db.x||da.y!==db.y)break;
      const d=Math.min(Math.abs(a.x-at.x)+Math.abs(a.y-at.y),
                       Math.abs(b.x-at.x)+Math.abs(b.y-at.y));
      if(d<0.01)break;
      at={x:at.x+da.x*d,y:at.y+da.y*d};length+=d;
      if(sameXY(at,a))i++;
      if(sameXY(at,b))j++;
    }
    if(length<24||pathDistance(left)-length<26||pathDistance(right)-length<26)
      return null;
    return {point:at,length};
  }
  function absorbJunctionOverlaps(id,baseLayouts,dropPlan){
    if(!dropPlan||dropPlan.mergeTargetId)return dropPlan;
    const edges=junctionEdges(id),at=dropPlan.point;
    const candidates=[];
    const original=junctionCentre(nodeById().get(id));
    // Early consolidation is a distinct *small-gesture* operation: it should
    // recognize a real, pre-existing shared corridor, NEVER a temporary
    // overlap produced by reanchoring during an ordinary drag. Otherwise
    // moving a fork along its trunk snaps it back to its old location.
    if(Math.hypot(at.x-original.x,at.y-original.y)>24)return dropPlan;
    for(const layout of [baseLayouts]){
      for(let a=0;a<edges.length;a++)for(let b=a+1;b<edges.length;b++){
        const out=edge=>{
          const path=layout[edge.index]?.points;
          if(!pathIsOrthogonal(path))return null;
          return edge.w.from.comp===id?path:[...path].reverse();
        };
        const first=out(edges[a]),second=out(edges[b]);
        if(!first||!second)continue;
        const fork=sharedOutgoingFork(first,second);
        if(fork&&fork.length<=360)candidates.push({...fork,kind:'shared'});
        for(const near of nearParallelForkCandidates(first,second,{
          maxGap:23,minRun:48,maxLead:76,maxShift:400}))
          candidates.push({...near,length:near.run,kind:'near-parallel'});
      }
    }
    if(!candidates.length)return dropPlan;
    const before=[...dropPlan.paths.values()].reduce((n,p)=>n+pathDistance(p),0);
    const beforeTurns=[...dropPlan.paths.values()].reduce((n,p)=>n+Math.max(0,p.length-2),0);
    // A long near-parallel run should only collapse if doing so actually
    // SHORTENS the local tree.  Never move a user's dot a long way just to
    // remove an inconsequential 12-unit gap.
    let best=dropPlan,bestGain=0;
    for(const candidate of candidates.sort((a,b)=>b.length-a.length).slice(0,10)){
      const refined=junctionMovePlan(id,candidate.point,baseLayouts,{snap:false});
      if(!refined)continue;
      const after=[...refined.paths.values()].reduce((n,p)=>n+pathDistance(p),0);
      const turns=[...refined.paths.values()].reduce((n,p)=>n+Math.max(0,p.length-2),0);
      const saving=before-after;
      if(candidate.kind==='near-parallel'&&
         (saving<Math.max(34,candidate.length*0.17)||turns>beforeTurns+1))continue;
      if(candidate.kind==='shared'&&saving< -12)continue;
      const gain=saving-(turns-beforeTurns)*10-
        Math.hypot(candidate.point.x-at.x,candidate.point.y-at.y)*0.04;
      if(gain>bestGain+4){bestGain=gain;best={...refined,kind:'absorbed-'+candidate.kind};}
    }
    return best;
  }
  /** Merge two already-connected junction components as one atomic netlist
   * rewrite.  Keeping a merely decorative pair of dots would break later
   * edits, undo and saved simulations.
   */
  function applyJunctionMerge(id,plan){
    const targetId=plan.mergeTargetId,source=nodeById().get(id),target=nodeById().get(targetId);
    if(source?.type!=='junction'||target?.type!=='junction')return false;
    const {endpointNet}=electricalNets();
    if(endpointNet({comp:id,pin:'out'})!==endpointNet({comp:targetId,pin:'out'}))return false;
    const oldPaths=ensureEditorLayout(),manual=graph.editorLayout.manualPaths;
    const nextPaths={},nextManual={},rewritten=[],seen=new Set();
    const normalize=e=>e.comp===id||e.comp===targetId?
      {comp:targetId,pin:'out'}:{...e};
    // Keep the target's original branches when both dots already share a
    // destination, then rehome the moving dot's remaining branches.
    const ordered=[...graph.wires.filter(w=>w.from.comp!==id&&w.to.comp!==id),
      ...graph.wires.filter(w=>w.from.comp===id||w.to.comp===id)];
    for(const wire of ordered){
      const from=normalize(wire.from),to=normalize(wire.to);
      if(sameEndpoint(from,to))continue;
      const newWire={from,to},key=wireKey(newWire);
      if(seen.has(key))continue;
      seen.add(key);rewritten.push(newWire);
      const oldKey=wireKey(wire),rewired=wire.from.comp===id||wire.to.comp===id;
      const route=rewired?plan.paths.get(oldKey):oldPaths[oldKey];
      if(rewired&&!pathIsOrthogonal(route))return false;
      if(pathIsOrthogonal(route))nextPaths[key]=compactPath(route);
      if(manual[oldKey]||plan.paths.has(oldKey))nextManual[key]=true;
    }
    graph.wires=rewritten;
    graph.components=graph.components.filter(c=>c.id!==id);
    graph.editorLayout.paths=nextPaths;
    graph.editorLayout.manualPaths=nextManual;
    // Never run the global dangling-junction cleanup here: it would silently
    // delete unrelated two-way markers elsewhere in the player's circuit.
    routeCache.clear();
    return true;
  }
  /** All connected edges are saved or reverted together; no half-moved net. */
  function applyJunctionMove(id,plan){
    const c=nodeById().get(id);
    if(!c||!plan)return false;
    c.x=plan.point.x-14;c.y=plan.point.y-14;
    const paths=ensureEditorLayout();
    for(const [key,points] of plan.paths){
      paths[key]=compactPath(points);
      graph.editorLayout.manualPaths[key]=true;
    }
    // Moving onto an existing conductor of the SAME net reuses the current
    // A->junction trunk. Replace A->X with junction->X, never create a second
    // A->junction edge and never materialise an unnecessary electrical cycle.
    if(plan.snapWireIndex>=0){
      const old=graph.wires[plan.snapWireIndex];
      if(old&&old.from.comp!==id&&old.to.comp!==id){
        const oldKey=wireKey(old),route=paths[oldKey];
        const halves=splitPathAt(route,plan.point,18);
        if(!halves)return false;
        const neighbours=junctionEdges(id).map(({w})=>
          w.from.comp===id?w.to:w.from);
        const first=neighbours.some(e=>sameEndpoint(e,old.from));
        const last=neighbours.some(e=>sameEndpoint(e,old.to));
        if(first===last)return false;
        const rewritten=first?
          {from:{comp:id,pin:'out'},to:{...old.to}}:
          {from:{...old.from},to:{comp:id,pin:'out'}};
        const newPath=first?halves.after:halves.before;
        graph.wires.splice(plan.snapWireIndex,1,rewritten);
        delete paths[oldKey];delete graph.editorLayout.manualPaths[oldKey];
        paths[wireKey(rewritten)]=newPath;
        graph.editorLayout.manualPaths[wireKey(rewritten)]=true;
      }
    }
    routeCache.clear();return true;
  }
  const nearbyParallelOnSameOrigin=(a,b,maxGap=16,minRun=54)=>{
    if(!pathIsOrthogonal(a)||!pathIsOrthogonal(b)||!sameXY(a[0],b[0]))
      return false;
    for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++){
      const u=a[i-1],v=a[i],p=b[j-1],q=b[j];
      const horizontal=Math.abs(u.y-v.y)<0.01;
      if(horizontal!==(Math.abs(p.y-q.y)<0.01))continue;
      const gap=horizontal?Math.abs(u.y-p.y):Math.abs(u.x-p.x);
      if(gap>maxGap||gap<0.01)continue;
      const lo=horizontal?Math.max(Math.min(u.x,v.x),Math.min(p.x,q.x)):
        Math.max(Math.min(u.y,v.y),Math.min(p.y,q.y));
      const hi=horizontal?Math.min(Math.max(u.x,v.x),Math.max(p.x,q.x)):
        Math.min(Math.max(u.y,v.y),Math.max(p.y,q.y));
      if(hi-lo>=minRun)return true;
    }
    return false;
  };
  /** Dragging a fork onto a cleaner elbow may expose another wire that still
   * leaves the SAME original terminal along the old trunk. Transfer ONLY that
   * genuine sibling branch to the moved fork. We keep every destination and
   * the pre-existing electrical net identical; distant circuits are untouched.
   */
  function transferSiblingFanoutsToJunction(id,maxChanges=4){
    const node=nodeById().get(id);
    if(!node||node.type!=='junction')return 0;
    const centre=junctionCentre(node),paths=ensureEditorLayout();
    const edges=junctionEdges(id);
    if(edges.length<2)return 0;
    const {ids,endpointNet}=electricalNets(),net=endpointNet({comp:id,pin:'out'});
    const anchors=[];
    for(const {w,index} of edges){
      const other=w.from.comp===id?w.to:w.from;
      if(!pinLookup(other))continue;
      const path=paths[wireKey(w)]||ensureRoutes()[index]?.points;
      if(!pathIsOrthogonal(path))continue;
      const oriented=w.from.comp===id?[...path].reverse():path;
      if(pathDistance(oriented)<56)continue;
      anchors.push({endpoint:other,path:oriented});
    }
    let replaced=0;
    for(const {endpoint:common,path:trunk} of anchors){
      if(replaced>=maxChanges)break;
      for(const w of [...graph.wires]){
        if(replaced>=maxChanges)break;
        if(w.from.comp===id||w.to.comp===id)continue;
        if(!sameEndpoint(w.from,common)&&!sameEndpoint(w.to,common))continue;
        const other=sameEndpoint(w.from,common)?w.to:w.from;
        if(other.comp===id||!pinLookup(other)||
           pinLookup(other).width!==pinInfo('junction','out')?.width)continue;
        const oldKey=wireKey(w),route=paths[oldKey];
        if(!pathIsOrthogonal(route)||route.length>7)continue;
        const oriented=sameEndpoint(w.from,common)?route:[...route].reverse();
        const prefix=sharedOutgoingFork(trunk,oriented);
        const directOverlap=prefix&&prefix.length>=24;
        const nearOther=projectToPath(centre,oriented);
        const closeAfterDrag=nearOther&&nearOther.distance<=25&&
          nearbyParallelOnSameOrigin(trunk,oriented);
        // Near lanes may merge only after the USER moves the junction close,
        // AND both already share this exact physical source pin and net.
        if(!directOverlap&&!closeAfterDrag)continue;
        const oldIndex=graph.wires.indexOf(w);
        if(oldIndex<0||ids[oldIndex]!==net)continue;
        const candidate={from:{comp:id,pin:'out'},to:{...other}};
        const candidateKey=wireKey(candidate);
        if(graph.wires.some(x=>wireKey(x)===candidateKey))continue;
        const otherComp=nodeById().get(other.comp),otherPin=pinLookup(other);
        const destination=otherComp&&otherPin&&getPinPoint(otherComp,otherPin);
        if(!destination)continue;
        const obstacles=graph.components.filter(c=>c.type!=='junction'&&
          c.id!==other.comp).map(c=>({x:c.x,y:c.y,...dims(c)}));
        const occupied=graph.wires.flatMap((edge,i)=>
          edge===w?[]:occupiedSegments(paths[wireKey(edge)]||[],ids[i]));
        // Rehoming a sibling is an optional visual clean-up, not a fresh
        // routing request. If a simple re-anchor cannot keep its old bends,
        // leave the original A->C conductor alone rather than producing a
        // surprising global-search detour during a junction drag.
        const oldOverlap=collinearOverlap(route,occupied);
        const originalCopper=occupiedSegments(oriented,'original-sibling');
        let proposed=null,bestScore=Infinity;
        for(const candidate of junctionReanchorCandidates(oriented,centre,
          {maxAnchors:6,maxSpan:520})){
          const path=candidate.points;
          if(!pathIsOrthogonal(path)||!sameXY(path[0],centre)||
             !sameXY(path.at(-1),destination)||
             !path.every(withinWorkspace)||
             pathHitsObstacles(path,obstacles,4)||
             unrelatedOverlap(path,occupied,net)>0.01||
             pathDistance(path)>pathDistance(route)*1.19+35||
             path.length>route.length+1)continue;
          const overlap=collinearOverlap(path,occupied);
          if(overlap>oldOverlap+12)continue;
          const shared=collinearOverlap(path,originalCopper);
          const edit=pathDistance(path)+pathDistance(route)-2*shared;
          const score=edit+Math.max(0,overlap-oldOverlap)*12+
            Math.max(0,path.length-route.length)*70;
          if(score<bestScore){bestScore=score;proposed=path;}
        }
        if(!proposed)continue;
        // Replacing A->C with J->C cannot disconnect A: A->J is still present.
        // Both are already in the SAME net, no automatic net union is made.
        graph.wires.splice(oldIndex,1,candidate);
        delete paths[oldKey];delete graph.editorLayout.manualPaths[oldKey];
        paths[candidateKey]=proposed;graph.editorLayout.manualPaths[candidateKey]=true;
        replaced++;
      }
    }
    if(replaced)routeCache.clear();
    return replaced;
  }
  /** Use the very same validated graph for preview AND commit.
   *
   * Pointer events only update the desired point. We coalesce rapid moves into
   * one planning task per snapped grid point, cache its completed result, and
   * render the resulting paths rather than an unrelated reanchored ghost.
   * A preview is a complete, private graph transaction: even the sibling-wire
   * transfers and junction merges visible on release are already included.
   */
  const junctionPreviewKey=p=>`${p.x.toFixed(2)}:${p.y.toFixed(2)}`;
  const sameRoute=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&
    a.every((p,i)=>sameXY(p,b[i]));
  function clearJunctionDragVisual(){
    if(junctionDragRaf){cancelAnimationFrame(junctionDragRaf);junctionDragRaf=0;}
    if(junctionDragTimer){clearTimeout(junctionDragTimer);junctionDragTimer=0;}
    junctionDragLayer.replaceChildren();
    for(const layer of [wiresLayer,compsLayer])
      for(const element of layer.children)element.style.opacity='';
  }
  function prepareJunctionDrag(active,desired){
    const key=junctionPreviewKey(desired);
    const cached=active.previewCache.get(key);
    if(cached){active.previewCache.delete(key);active.previewCache.set(key,cached);return cached;}
    // The solver still reads the *real* unmodified netlist, including its
    // original occupied copper and all other nets.
    const wanted=closestSafeJunctionMove(active.id,desired,active.originRoutes,
      {snap:true,extended:true});
    const plan=wanted&&absorbJunctionOverlaps(active.id,active.originRoutes,wanted);
    let result={key,valid:false,desired,point:desired,
      foreignNode:Boolean(nearestMergeNode(active.id,desired)),paths:[],graph:null};
    if(plan){
      // Save both the netlist and route cache while we apply exactly the same
      // postprocessing that used to happen only after pointerup. This shadow
      // transaction is synchronous and NEVER touches undo, simulation or save.
      const currentGraph=graph,cache=new Map(routeCache);
      try{
        graph=deep(active.originGraph);
        routeCache.clear();
        // Preserve the geometry that the player saw at drag start, including
        // automatically routed wires not previously serialized in paths.
        const stored=ensureEditorLayout();
        graph.wires.forEach((wire,i)=>{
          const source=active.originRoutes[i]?.points;
          if(pathIsOrthogonal(source))stored[wireKey(wire)]=deep(source);
        });
        const didMerge=Boolean(plan.mergeTargetId);
        const applied=didMerge?applyJunctionMerge(active.id,plan):
          applyJunctionMove(active.id,plan);
        if(applied){
          const transferred=didMerge?0:transferSiblingFanoutsToJunction(active.id);
          // Materialize the exact paths that the editor will draw AFTER the
          // graph changes. This includes any unavoidable reanchoring.
          const layouts=ensureRoutes();
          const valid=layouts.length===graph.wires.length&&
            layouts.every((layout,i)=>{
              const wire=graph.wires[i],ends=wireEndpoints(wire);
              return pathIsOrthogonal(layout.points)&&ends&&
                sameXY(layout.points[0],ends.a)&&
                sameXY(layout.points.at(-1),ends.b);
            });
          if(valid){
            const surviving=graph.components.find(c=>c.id===
              (didMerge?plan.mergeTargetId:active.id));
            result={key,valid:true,desired,
              point:surviving?junctionCentre(surviving):plan.point,
              graph:deep(graph),layouts:layouts.map(x=>({points:deep(x.points)})),
              didMerge,mergeTargetId:plan.mergeTargetId||null,
              transferred,topologyChanged:didMerge||plan.snapWireIndex>=0||transferred>0};
          }
        }
      } finally {
        graph=currentGraph;
        routeCache.clear();
        for(const [k,v] of cache)routeCache.set(k,v);
      }
    }
    active.previewCache.set(key,result);
    // Bounded cache avoids retaining hundreds of shadow graphs on very long
    // drags, but preserves revisited grid cells for instant backtracking.
    if(active.previewCache.size>36)active.previewCache.delete(active.previewCache.keys().next().value);
    return result;
  }
  function drawJunctionDragVisual(){
    const active=drag;
    if(!active||active.kind!=='junction'||!active.moved||!active.desiredPoint)return;
    const preview=active.previewResult;
    const current=preview?.key===junctionPreviewKey(active.desiredPoint);
    junctionDragLayer.replaceChildren();
    for(const layer of [wiresLayer,compsLayer])
      for(const element of layer.children)element.style.opacity='';
    if(!current){
      // A new grid cell is pending the *real* router. Show the pointer as
      // pending, never invent copper that will vanish after release.
      svgEl('circle',{cx:active.desiredPoint.x,cy:active.desiredPoint.y,r:6.1,
        class:'ce-junction-drag-dot is-pending'},junctionDragLayer);
      return;
    }
    const point=preview.point;
    if(!preview.valid){
      svgEl('circle',{cx:point.x,cy:point.y,r:15,
        class:'ce-junction-invalid-target'},junctionDragLayer);
      svgEl('circle',{cx:point.x,cy:point.y,r:6.1,
        class:'ce-junction-drag-dot is-invalid'},junctionDragLayer);
      return;
    }
    // The preview is a diff between the previously visible graph and the
    // exact post-commit graph. This also covers merges and sibling rewires,
    // not just edges directly incident to the moving node.
    const before=new Map(active.originGraph.wires.map((w,i)=>
      [wireKey(w),{index:i,points:active.originRoutes[i]?.points}]));
    const after=new Map(preview.graph.wires.map((w,i)=>
      [wireKey(w),{index:i,points:preview.layouts[i]?.points}]));
    const hidden=new Set();
    for(const [key,old] of before){
      const next=after.get(key);
      if(!next||!sameRoute(old.points,next.points))hidden.add(old.index);
    }
    for(const element of wiresLayer.children)
      if(hidden.has(Number(element.dataset.wire)))element.style.opacity='.12';
    for(const element of compsLayer.children)
      if(element.dataset.component===active.id)element.style.opacity='.18';
    for(const [key,route] of after){
      const old=before.get(key);
      if(old&&sameRoute(old.points,route.points))continue;
      if(!pathIsOrthogonal(route.points))continue;
      svgEl('path',{d:pointsToPath(route.points),
        class:'ce-wire ce-wire--preview ce-junction-drag-wire',
        'data-preview-wire-key':key},junctionDragLayer);
    }
    if(preview.didMerge)svgEl('circle',{cx:point.x,cy:point.y,r:18,
      class:'ce-junction-merge-target'},junctionDragLayer);
    svgEl('circle',{cx:point.x,cy:point.y,r:6.1,
      class:'ce-junction-drag-dot'},junctionDragLayer);
  }
  function queueJunctionDragVisual(){
    if(junctionDragRaf)return;
    junctionDragRaf=requestAnimationFrame(()=>{
      junctionDragRaf=0;
      const active=drag;
      if(disposed||active?.kind!=='junction'||!active.moved||!active.desiredPoint)return;
      const key=junctionPreviewKey(active.desiredPoint);
      if(active.previewResult?.key!==key){
        const elapsed=performance.now()-(active.lastJunctionSolve||-Infinity);
        const pause=Math.max(0,32-elapsed);
        if(pause>0 && !active.previewCache.has(key)){
          if(!junctionDragTimer)junctionDragTimer=setTimeout(()=>{
            junctionDragTimer=0;queueJunctionDragVisual();
          },pause);
          drawJunctionDragVisual();return;
        }
        active.previewResult=prepareJunctionDrag(active,active.desiredPoint);
        active.lastJunctionSolve=performance.now();
      }
      drawJunctionDragVisual();
    });
  }
  const junctionDragDesired=(pointer,active)=>{
    const limit=(axis,value)=>Math.max(
      Math.ceil((workspace[`min${axis}`]+COMPONENT_PADDING+14)/GRID_STEP)*GRID_STEP,
      Math.min(Math.floor((workspace[`max${axis}`]-COMPONENT_PADDING-14)/GRID_STEP)*GRID_STEP,
        Math.round(value/GRID_STEP)*GRID_STEP));
    return {x:limit('X',pointer.x-active.offsetX),
      y:limit('Y',pointer.y-active.offsetY)};
  };
  const beginGesture=(e,kind,extra={})=>{
    drag={kind,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,moved:false,
      startPanX:panX,startPanY:panY,...extra};
    svg.setPointerCapture(e.pointerId);
  };
  svg.addEventListener("pointerdown",e=>{
    if(submitting || e.button!==0)return;
    closeContextMenu();
    pointerWorld=toWorld(e);
    const line=e.target.closest?.("[data-wire]");
    const component=e.target.closest?.("[data-component]");
    if(tapWireKey){
      const index=graph.wires.findIndex(w=>wireKey(w)===tapWireKey);
      if(index>=0&&wireSnapAt(pointerWorld,index))branchFromWire(index,pointerWorld);
      else status("请靠近选中的导线指定接点位置，按 Esc 可取消。","info");
      return;
    }
    const snapped=wireStart?wiringSnapAt(pointerWorld,e.target,e.altKey):
      {pin:e.altKey?null:pinSnapAt(pointerWorld,PIN_START_SNAP_PX,e.target),wire:null};
    // Do not let a nearby pin belonging to another component steal a drag.
    const pin=snapped.pin&&(!component || wireStart ||
      snapped.pin.endpoint.comp===component.dataset.component)?snapped.pin:null;
    if(pin){
      const tapped=nodeById().get(pin.endpoint.comp);
      // A quick click still starts a wire. A press followed by movement
      // relocates the real junction and all incident copper instead.
      if(!wireStart&&!selectedPalette&&tapped?.type==='junction'){
        const p=toWorld(e),centre=junctionCentre(tapped);
        const baseRoutes=ensureRoutes().map(layout=>({points:layout.points.map(q=>({...q}))}));
        intent('SELECT',{kind:'component',id:tapped.id});
        const netMap=electricalNets().endpointNet;
        beginGesture(e,'junction',{id:tapped.id,
          origin:{x:tapped.x,y:tapped.y},originGraph:deep(graph),
          originLayout:deep(graph.editorLayout),originRoutes:baseRoutes,
          offsetX:p.x-centre.x,offsetY:p.y-centre.y,
          net:netMap({comp:tapped.id,pin:'out'}),
          netOf:otherId=>netMap({comp:otherId,pin:'out'}),
          previewMergeTargetId:null,previewForeignNode:false,
          previewCache:new Map(),previewResult:null,lastJunctionSolve:-Infinity});
        render();return;
      }
      handlePin(pin.endpoint);return;
    }
    // While drawing, a click on blank canvas COMMITs a bend instead of
    // cancelling the unfinished line. The topology is unchanged until finish.
    if(wireStart){
      if(snapped.wire){
        const index=snapped.wire.index;
        if(graph.wires[index])branchFromWire(index,pointerWorld,wireStart);
      }else if(line){
        status("附近线路较密集，请靠近目标导线的直线段再连接。","info");
      }else if(component){
        status("请点击元件的接线端子；若要绕开元件，请在空白位置固定转折点。","info");
      }else commitCorner({
        x:Math.max(workspace.minX+COMPONENT_PADDING,Math.min(workspace.maxX-COMPONENT_PADDING,pointerWorld.x)),
        y:Math.max(workspace.minY+COMPONENT_PADDING,Math.min(workspace.maxY-COMPONENT_PADDING,pointerWorld.y))
      });
      return;
    }
    if(component){
      const id=component.dataset.component,c=nodeById().get(id);
      if(!c)return;
      intent("SELECT",{kind:"component",id});
      const p=toWorld(e);
      const baseRoutes=ensureRoutes().map(layout=>({points:layout.points.map(q=>({...q}))}));
      beginGesture(e,"component",{id,dx:p.x-c.x,dy:p.y-c.y,
        origin:{x:c.x,y:c.y},originLayout:deep(ensureEditorLayout()),
        originRoutes:baseRoutes,
        followers:componentFollowerCandidates(id,baseRoutes),activeFollowers:[]});
      render();return;
    }
    if(line){
      const index=Number(line.dataset.wire),point=toWorld(e);
      if(e.shiftKey){branchFromWire(index,point);return;}
      const layout=getWireLayout(graph.wires[index],index);
      const projected=projectToPath(point,layout.points);
      intent("SELECT",{kind:"wire",index});
      if(projected){beginGesture(e,"wire",{index,segment:projected.index,
        startWorld:point,originPath:layout.points.map(p=>({...p})),
        originLayout:deep(ensureEditorLayout())});}
      render();return;
    }
    const effect=intent("EMPTY");
    beginGesture(e,effect&&effect.type==="place"?"place-or-pan":"pan");
    render();
  });
  svg.addEventListener("pointermove",e=>{
    pointerWorld=toWorld(e);
    if(!drag){
      if(wireStart){
        const snapped=wiringSnapAt(pointerWorld,e.target,e.altKey);
        hoverEndpoint=null;hoverWire=null;
        if(snapped.pin){
          const {endpoint,point,side}=snapped.pin;
          if(!(endpoint.comp===wireStart.comp&&endpoint.pin===wireStart.pin))
            hoverEndpoint={endpoint,point,side};
        }else if(snapped.wire){
          hoverWire={index:snapped.wire.index,point:snapped.wire.point};
        }
      }
      if(wireStart||tapWireKey)queuePreview();
      return;
    }
    if(drag.pointerId!==e.pointerId)return;
    if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>6)drag.moved=true;
    if(drag.kind==="component"){
      if(!drag.moved)return;
      const c=nodeById().get(drag.id);
      if(c){
        const p=toWorld(e);
        Object.assign(c,restrictComponent(c,p.x-drag.dx,p.y-drag.dy));
        const offset={x:c.x-drag.origin.x,y:c.y-drag.origin.y};
        const safe=followersCanMove(drag.followers||[],offset,c.id,drag.originRoutes);
        drag.activeFollowers=safe?drag.followers:[];
        for(const f of drag.followers||[]){
          const joint=nodeById().get(f.id);if(!joint)continue;
          joint.x=f.origin.x+(safe?offset.x:0);
          joint.y=f.origin.y+(safe?offset.y:0);
        }
        // Only visual preview moves before pointerup.  Persisted paths and
        // graph topology are left alone until the entire group is validated.
        render();
      }
    }else if(drag.kind==="junction"){
      if(!drag.moved)return;
      const current=nodeById().get(drag.id);
      if(!current)return;
      const desired=junctionDragDesired(pointerWorld,drag);
      drag.desiredPoint=desired;
      queueJunctionDragVisual();
    }else if(drag.kind==="wire"){
      if(!drag.moved)return;
      const w=graph.wires[drag.index];if(!w)return;
      const delta=eqAxisDelta(drag.originPath,drag.segment,drag.startWorld,pointerWorld);
      const adjusted=shiftSegment(drag.originPath,drag.segment,delta);
      if(adjusted){insertWirePath(w,adjusted);render();}
    }else if(drag.moved){
      const matrix=svg.getScreenCTM();
      const scaleX=matrix?.a||1,scaleY=matrix?.d||1;
      // Incremental deltas prevent a "stuck edge": after hitting a limit,
      // even a tiny reverse mouse move immediately pans back toward the page.
      panX+=(e.clientX-(drag.lastPanX??drag.startX))/scaleX;
      panY+=(e.clientY-(drag.lastPanY??drag.startY))/scaleY;
      drag.lastPanX=e.clientX;drag.lastPanY=e.clientY;
      setWorldTransform();
    }
  });
  function eqAxisDelta(points,index,start,end){
    const a=points[index],b=points[index+1];
    const delta=Math.abs(a.y-b.y)<0.01?end.y-start.y:end.x-start.x;
    return Math.round(delta/12)*12;
  }
  const finishGesture=(e,cancel=false)=>{
    if(!drag || drag.pointerId!==e.pointerId)return;
    const active=drag;drag=null;
    if(active.kind==='junction')clearJunctionDragVisual();
    if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);
    if(active.kind==="component"){
      const c=nodeById().get(active.id);
      if(active.moved){
        if(cancel&&c){
          c.x=active.origin.x;c.y=active.origin.y;
          for(const f of active.followers||[]){
            const joint=nodeById().get(f.id);
            if(joint){joint.x=f.origin.x;joint.y=f.origin.y;}
          }
          graph.editorLayout=active.originLayout;
          routeCache.clear();
        }else{
          const attached=componentFollowerPaths(active);
          if(attached?.size){
            const paths=ensureEditorLayout();
            for(const [key,points] of attached){
              paths[key]=points;
              graph.editorLayout.manualPaths[key]=true;
            }
            markGeometryChanged();
            status(`元件已移动，${active.activeFollowers.length} 个邻近汇流节点同步调整；原电气连接不变。`,"success");
          }else{
            // If ANY attached route would need a disruptive global rewrite,
            // leave those junctions where they were.  Only the component moves.
            for(const f of active.followers||[]){
              const joint=nodeById().get(f.id);
              if(joint){joint.x=f.origin.x;joint.y=f.origin.y;}
            }
            graph.editorLayout=active.originLayout;
            routeCache.clear();
            const paths=ensureEditorLayout();
            graph.wires.forEach(w=>{
              if(w.from.comp!==active.id && w.to.comp!==active.id)return;
              const key=wireKey(w);
              delete paths[key];
              delete graph.editorLayout.manualPaths[key];
            });
            markGeometryChanged();
            status("元件已移动；附近汇流节点保留在原位置，相关连线自动绕行。","success");
          }
        }
        render();
      }else if(!cancel && c?.type==="input")toggleInput(c);
    }else if(active.kind==="junction"){
      const comp=nodeById().get(active.id);
      if(cancel||!active.moved){
        if(cancel){graph=active.originGraph;routeCache.clear();render();}
        else if(comp)handlePin({comp:comp.id,pin:'out'});
      }else{
        // The exact graph displayed by the last complete preview is the
        // graph we commit. Never run a second, different route search here.
        const wanted=junctionDragDesired(toWorld(e),active);
        const prepared=active.previewResult?.key===junctionPreviewKey(wanted)?
          active.previewResult:prepareJunctionDrag(active,wanted);
        if(prepared.valid){
          graph=prepared.graph;
          routeCache.clear();
          if(prepared.topologyChanged)markChanged({resetState:false});
          else markGeometryChanged();
          if(prepared.didMerge)
            intent('SELECT',{kind:'component',id:prepared.mergeTargetId});
          status(prepared.didMerge?'同一电气网络中的两个汇流节点已合并，原有分支保持连通。':
            prepared.transferred?`汇流节点已移动，${prepared.transferred} 条同源分支已接到节点；其他网络未改变。`:
            '汇流节点已移动；预览线路已原样应用，电气连接保持不变。','success');
          if(prepared.topologyChanged)scheduleSim();
        }else{
          graph=active.originGraph;routeCache.clear();
          const touching=nearestMergeNode(active.id,wanted);
          status(touching?
            '这两个节点不属于同一个已连通的电气网络，无法自动合并，以免造成信号短路。':
            '目标位置附近没有安全落点；已恢复原汇流节点。','error');
        }
        render();
      }
    }else if(active.kind==="wire"){
      if(active.moved){
        const wire=graph.wires[active.index];
        if(cancel){graph.editorLayout=active.originLayout;routeCache.clear();}
        else if(wire){
          const points=ensureEditorLayout()[wireKey(wire)];
          const obstacles=graph.components.filter(c=>c.type!=="junction"&&
             c.id!==wire.from.comp&&c.id!==wire.to.comp).map(c=>({x:c.x,y:c.y,...dims(c)}));
          const layoutNow=ensureRoutes(),nets=electricalNetIds();
          const other=layoutNow.flatMap((o,i)=>
            i===active.index?[]:occupiedSegments(o.points,nets[i]));
          const net=nets[active.index];
          if(!pathIsOrthogonal(points)||!points.every(withinWorkspace)||
             pathHitsObstacles(points,obstacles,4)||
             unrelatedOverlap(points,other,net)>0){
            graph.editorLayout=active.originLayout;routeCache.clear();
            status("线段必须留在画布内，且不能穿过元件或与另一独立电路重叠。已保留原线路。","error");
          } else {
            markGeometryChanged();
            status("已调整导线折线；电气连接没有改变。","success");
          }
        }
        render();
      }
    }else if(active.kind==="place-or-pan" && !active.moved && !cancel && selectedPalette){
      addComponent(selectedPalette,toWorld(e));
    }
  };
  svg.addEventListener("pointerup",e=>finishGesture(e));
  svg.addEventListener("pointercancel",e=>finishGesture(e,true));
  svg.addEventListener("pointerleave",()=>{pointerWorld=null;hoverEndpoint=null;hoverWire=null;tapPreview=null;renderPreview();});
  svg.addEventListener("contextmenu",e=>{
    e.preventDefault();
    closeContextMenu();
    if(submitting)return;

    // Keep the existing right-click-to-cancel semantics while placing parts,
    // drawing a wire or choosing a junction location.
    if(wireStart||tapWireKey||selectedPalette){
      tapWireKey=null;tapPreview=null;hoverEndpoint=null;hoverWire=null;
      intent("CANCEL");draftPoints=[];
      status("已取消当前接线或接点操作。");render();
      return;
    }

    const component=e.target.closest?.("[data-component]");
    if(component && nodeById().has(component.dataset.component)){
      const id=component.dataset.component;
      intent("SELECT",{kind:"component",id});
      render();
      showContextMenu(e,{kind:"component",id});
      return;
    }

    // Reuse the existing pixel-aware wire snapper. At an ambiguous crossing
    // it returns null, so right-click cannot short two unrelated nets.
    const point=toWorld(e),hit=wireSnapAt(point);
    if(hit && graph.wires[hit.index]){
      const index=hit.index;
      const key=wireKey(graph.wires[index]);
      intent("SELECT",{kind:"wire",index});
      render();
      showContextMenu(e,{kind:"wire",key,point:{x:point.x,y:point.y}});
    }
  });
  svg.addEventListener("wheel",e=>{
    closeContextMenu();e.preventDefault();changeZoom(zoom+(e.deltaY<0?.08:-.08),e);
  },{passive:false});
  const onKey=e=>{
    if(disposed || submitting)return;
    if(e.target.closest?.("input,textarea,select,[contenteditable=true]"))return;
    const switchTarget=e.target.closest?.('[data-component].ce-input-component');
    if(switchTarget && (e.key==="Enter" || e.key===" ") && !wireStart){
      const component=nodeById().get(switchTarget.dataset.component);
      if(component){e.preventDefault();toggleInput(component);return;}
    }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){
      e.preventDefault();restoreHistory(e.shiftKey?"redo":"undo");return;
    }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){
      e.preventDefault();restoreHistory("redo");return;
    }
    if((e.key===" "||e.code==="Space")&&wireStart){
      e.preventDefault();directionBtn.click();return;
    }
    if(e.key==="Escape"){
      if(drag?.kind==='junction'){
        const active=drag;drag=null;clearJunctionDragVisual();
        if(svg.hasPointerCapture(active.pointerId))svg.releasePointerCapture(active.pointerId);
        status('已取消本次汇流节点拖动；原有导线保持不变。');
        render();e.preventDefault();return;
      }
      if(contextMenu){
        e.preventDefault();closeContextMenu();return;
      }
      if(tapWireKey){
        tapWireKey=null;tapPreview=null;stage.dataset.mode="select";
        toolHint.textContent="接线编辑";status("已退出添加接点模式，线路没有改变。");render();e.preventDefault();return;
      }
      const modal=host.querySelector(".ce-modal");
      if(modal){modal.remove();e.preventDefault();return;}
      const effect=intent("ESCAPE");
      status(effect==="wire-cancel"?"已取消未完成的连线。":effect==="cancel-placement"?"已退出道具放置模式。":"已取消选择。");
      render();e.preventDefault();
    }
    if((e.key==="Delete"||e.key==="Backspace") && selected){e.preventDefault();deleteSelected();}
    if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.toLowerCase()==="f"&&!wireStart){
      e.preventDefault();fitCircuit();return;
    }
    if(e.key.toLowerCase()==="r" && selected?.kind==="component"){
      e.preventDefault();rotateSelected();
    }
  };
  window.addEventListener("keydown",onKey);
  function arrangePorts(){
    let iy=150,oy=150;
    graph.components.forEach(c=>{
      if(c.type==="input"){c.x=80;c.y=iy;iy+=130;}
      else if(c.type==="output"){c.x=1340;c.y=oy;oy+=130;}
    });
  }
  if(!saved)arrangePorts();
  try{
    const records=await api("GET","/api/circuit/results/mine");
    if(signal?.aborted)return;
    const bestRow=(records.results||[]).find(r=>r.levelId===levelId);
    best=bestRow||null;
    bestText.textContent=best?`最佳记录：${best.bestPassedCount}/${best.totalCount} ${best.unit}`:"最佳记录：尚无提交";
  }catch(_){bestText.textContent="最佳记录：尚无提交";}
  // When reopening a saved circuit entirely outside the default viewport,
  // bring it into view immediately instead of presenting an empty canvas.
  const appearsOnDefaultView=graph.components.some(c=>{
    const box=dims(c);
    return c.x<VIEW_WIDTH&&c.x+box.w>0&&c.y<VIEW_HEIGHT&&c.y+box.h>0;
  });
  if(graph.components.length&&!appearsOnDefaultView)fitCircuit();
  render();committedGraph=deep(graph);scheduleSim();
  const onAbort=()=>dispose();
  signal?.addEventListener("abort",onAbort,{once:true});
  function dispose(){if(disposed)return;disposed=true;++simEpoch;++simGeneration;clearTimeout(simTimer);
    closeContextMenu();
    host.removeEventListener("pointerdown",onContextPointerDown,true);
    window.removeEventListener("resize",onContextViewportChange);
    if(previewRaf&&typeof cancelAnimationFrame==="function")cancelAnimationFrame(previewRaf);
    clearJunctionDragVisual();
    window.removeEventListener("keydown",onKey);signal?.removeEventListener("abort",onAbort);}
  return {dispose, canLeave};
};
