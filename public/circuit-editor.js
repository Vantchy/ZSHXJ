import { transitionEditorMode, checkConnection } from "./circuit-interactions.js";
import { routeOrthogonal, compactPath, pointsToPath, pathIsOrthogonal, projectToPath, splitPathAt, shiftSegment, reanchorPath, pathHitsObstacles, occupiedSegments, unrelatedOverlap } from "./circuit-routing.js";
import { liveDraftPath, commitDraftWaypoint, assessDraftPath } from "./circuit-drafting.js";

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
  let drag = null;
  let dirty = false; // merely opening a level is not an unsaved change
  let submitting = false;
  let best = null;
  let resultData = null;
  let lastSimError = null;
  let simWarnings = [];
  let blockedRoutes = 0;
  let simTimer = 0;
  let previewRaf = 0;
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
  $("p","ce-objective",titleWrap,`搭建电路，使 ${level.interface.inputs.map(x=>x.name).join("、")} 对应正确的 ${level.interface.outputs.map(x=>x.name).join("、")} 输出。`);
  const bestText=$("p","ce-best",heading,"最佳记录：读取中…");
  const actions=$("div","ce-actions",top);
  const saveBtn=$("button","ce-button ce-button--primary",actions,"保存进度");
  const runBtn=$("button","ce-button",actions,"▶ 运行电路");
  const submitBtn=$("button","ce-button ce-button--accent",actions,"提交评测");
  const clearBtn=$("button","ce-button",actions,"清空画布");
  const backBtn=$("button","ce-button",actions,"返回关卡列表");

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
  const fitBtn=$("button","ce-icon-button",toolbar,"适应画布");
  const canvasWrap=$("div","ce-canvas-wrap",stage);
  const svg=svgEl("svg",{class:"ce-canvas",viewBox:"0 0 1600 1000",role:"img","aria-label":"电路设计画布"},canvasWrap);
  const defs=svgEl("defs",{},svg);
  const pattern=svgEl("pattern",{id:"ce-grid",width:24,height:24,patternUnits:"userSpaceOnUse"},defs);
  svgEl("circle",{cx:2,cy:2,r:1.15,class:"ce-grid-dot"},pattern);
  const world=svgEl("g",{class:"ce-world"},svg);
  const wiresLayer=svgEl("g",{class:"ce-wires"},world);
  const previewLayer=svgEl("g",{class:"ce-wire-preview","pointer-events":"none"},world);
  const compsLayer=svgEl("g",{class:"ce-components"},world);
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
  const setWorldTransform=()=>world.setAttribute("transform",`translate(${panX} ${panY}) scale(${zoom})`);
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
      if(p.name==="clk")path(`M ${left} ${y-8} l 8 8 l -8 8`,"ce-clock-mark");
    });
    outputs.forEach((p,i)=>{
      const y=pinY(i,outputs.length);
      path(`M ${right} ${y} H ${w}`,"ce-symbol-lead");dot(w,y);
    });
    const mark=type==="dff"?"D FF":type==="sr_latch"?"SR":(shape.name||LABELS[type]||type);
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
  function draftRouteTo(target,targetSide=null,exact=false){
    if(!wireStart||!draftPoints.length)return null;
    return liveDraftPath(draftPoints,target,{horizontalFirst,grid:12,
      startSide:wireStart?getPinPoint(nodeById().get(wireStart.comp),
        pinInfo(nodeById().get(wireStart.comp).type,wireStart.pin)).side:null,
      endSide:targetSide,exactTarget:exact});
  }
  function draftAssessment(points,endpoint=null,targetWire=null){
    const nodes=nodeById();
    const omitted=new Set([wireStart?.comp,endpoint?.comp]);
    if(targetWire){omitted.add(targetWire.from.comp);omitted.add(targetWire.to.comp);}
    const obstacles=graph.components.filter(c=>c.type!=="junction"&&!omitted.has(c.id))
      .map(c=>({x:c.x,y:c.y,...dims(c)}));
    const {ids,endpointNet}=electricalNets();
    const allowed=new Set([endpointNet(wireStart)]);
    if(endpoint)allowed.add(endpointNet(endpoint));
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
      if(draftPoints.length>=2){
        svgEl("path",{d:pointsToPath(draftPoints),class:"ce-wire ce-wire--fixed"},previewLayer);
        for(let i=1;i<draftPoints.length;i++){
          const p=draftPoints[i];
          svgEl("rect",{x:p.x-3.5/zoom,y:p.y-3.5/zoom,width:7/zoom,height:7/zoom,
            class:"ce-waypoint"},previewLayer);
        }
      }
      if(target){
        const endpoint=hoverEndpoint?.endpoint||null;
        const wire=hoverWire?graph.wires[hoverWire.index]:null;
        let route=draftRouteTo(target,targetSide,Boolean(hoverEndpoint||hoverWire));
        let verdict=route&&draftAssessment(route,endpoint,wire);
        if(route&&!verdict.ok&&draftPoints.length===1){
          const fallback=fallbackDirectRoute(target,targetSide,endpoint,wire);
          if(fallback){route=fallback;verdict={ok:true};}
        }
        if(route&&route.length>=2){
          svgEl("path",{d:pointsToPath(route),
            class:`ce-wire ce-wire--preview ${verdict.ok?"":"is-invalid"}`},previewLayer);
          if(hoverEndpoint||hoverWire){
            const p=route[route.length-1];
            svgEl("circle",{cx:p.x,cy:p.y,r:9/zoom,
              class:`ce-draft-target ${verdict.ok?"is-valid":"is-invalid"}`},previewLayer);
          }
        }
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
    const movingId=drag?.kind==="component" && drag.moved ? drag.id : null;
    const layouts=movingId
      ? graph.wires.map(w=>routeCache.get(wireKey(w)))
      : ensureRoutes();
    blockedRoutes=0;
    let overlappingRoutes=0;
    graph.wires.forEach((w,i)=>{
      // Hide connected wires, including their pointer hit areas, during drag.
      if(movingId && (w.from.comp===movingId || w.to.comp===movingId))return;
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
        svgEl("circle",{cx:w/2,cy:h/2,r:17,class:`ce-junction-hit ${selectedHere?"is-start":""} ${bit===1?"is-high":bit===0?"is-low":bit==="X"?"is-unknown":""}`,
          "data-pin-comp":c.id,"data-pin":"out","aria-label":`接点 ${c.id}`},g);
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
    renderDetail();renderWarnings();
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
  function connect(a,b,draftedPath=null){
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
    let newPath=draftedPath||draftRouteTo(target,target.side,true);
    let verdict=newPath&&draftAssessment(newPath,b);
    if(verdict&&!verdict.ok && draftPoints.length===1){
      const fallback=fallbackDirectRoute(target,target.side,b);
      if(fallback){newPath=fallback;verdict={ok:true};}
    }
    if(verdict&&!verdict.ok){
      status(verdict.message+"。连线起点及已固定转折点均已保留。","error");renderPreview();return;
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
  /** Insert a tap at the EXACT projected click location. Never reroute the
   * original path, never snap a point off its segment, never pre-create a node.
   */
  function branchFromWire(index,point,attach=null){
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
      attachPath=draftRouteTo(halves.point,"any",true);
      let verdict=attachPath&&draftAssessment(attachPath,null,source);
      if(verdict&&!verdict.ok&&draftPoints.length===1){
        const fallback=fallbackDirectRoute(halves.point,"any",null,source);
        if(fallback){attachPath=fallback;verdict={ok:true};}
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
    intent("RESET");
    markChanged({resetState:false});
    if(!attach){intent("PIN",{comp:id,pin:"out"});startDraft({comp:id,pin:"out"});}
    status(attach?"已将端口准确接入选定的导线位置。原线路保持不变。":
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
      connect(effect.from,effect.to,target?draftRouteTo(target,target.side,true):null);return;
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
    const target=Math.max(.5,Math.min(2,Math.round(next*100)/100));
    if(target===zoom)return;
    const svgPoint=svg.createSVGPoint();
    if(point){svgPoint.x=point.clientX;svgPoint.y=point.clientY;}
    else{const bounds=svg.getBoundingClientRect();svgPoint.x=bounds.left+bounds.width/2;svgPoint.y=bounds.top+bounds.height/2;}
    const inv=svg.getScreenCTM()?.inverse();
    const canvasPoint=inv?svgPoint.matrixTransform(inv):{x:800,y:500};
    const worldPoint={x:(canvasPoint.x-panX)/zoom,y:(canvasPoint.y-panY)/zoom};
    zoom=target;panX=canvasPoint.x-worldPoint.x*zoom;panY=canvasPoint.y-worldPoint.y*zoom;
    zoomLabel.textContent=`${Math.round(zoom*100)}%`;setWorldTransform();
  }
  zoomIn.addEventListener("click",()=>changeZoom(zoom+.1));
  zoomOut.addEventListener("click",()=>changeZoom(zoom-.1));
  fitBtn.addEventListener("click",()=>{zoom=1;panX=0;panY=0;zoomLabel.textContent="100%";setWorldTransform();});
  canvasWrap.addEventListener("dragover",e=>{e.preventDefault();e.dataTransfer.dropEffect="copy";});
  canvasWrap.addEventListener("drop",e=>{
    e.preventDefault();if(submitting)return;
    const type=e.dataTransfer.getData("text/circuit-type");
    if(!type || !(paletteTypes.includes(type)||palettePackages.some(p=>p.type===type)))return;
    intent("DROP");addComponent(type,toWorld(e));
  });
  const beginGesture=(e,kind,extra={})=>{
    drag={kind,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,moved:false,
      startPanX:panX,startPanY:panY,...extra};
    svg.setPointerCapture(e.pointerId);
  };
  svg.addEventListener("pointerdown",e=>{
    if(submitting || e.button!==0)return;
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
    if(pin){handlePin(pin.endpoint);return;}
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
      }else commitCorner(pointerWorld);
      return;
    }
    if(component){
      const id=component.dataset.component,c=nodeById().get(id);
      if(!c)return;
      intent("SELECT",{kind:"component",id});
      const p=toWorld(e);
      beginGesture(e,"component",{id,dx:p.x-c.x,dy:p.y-c.y,
        origin:{x:c.x,y:c.y},originLayout:deep(ensureEditorLayout())});
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
        c.x=Math.max(-9950,Math.min(9950,Math.round((p.x-drag.dx)/12)*12));
        c.y=Math.max(-9950,Math.min(9950,Math.round((p.y-drag.dy)/12)*12));
        // Only the component moves; no routing work occurs before mouseup.
        render();
      }
    }else if(drag.kind==="wire"){
      if(!drag.moved)return;
      const w=graph.wires[drag.index];if(!w)return;
      const delta=eqAxisDelta(drag.originPath,drag.segment,drag.startWorld,pointerWorld);
      const adjusted=shiftSegment(drag.originPath,drag.segment,delta);
      if(adjusted){insertWirePath(w,adjusted);render();}
    }else if(drag.moved){
      const matrix=svg.getScreenCTM();
      const scaleX=matrix?.a||1,scaleY=matrix?.d||1;
      panX=drag.startPanX+(e.clientX-drag.startX)/scaleX;
      panY=drag.startPanY+(e.clientY-drag.startY)/scaleY;
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
    if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);
    if(active.kind==="component"){
      const c=nodeById().get(active.id);
      if(active.moved){
        if(cancel&&c){
          c.x=active.origin.x;c.y=active.origin.y;
          graph.editorLayout=active.originLayout;
        }else{
          // Throw away stale bends for wires attached to the moved component.
          // The ordinary renderer will compute fresh orthogonal paths once.
          const paths=ensureEditorLayout();
          graph.wires.forEach(w=>{
            if(w.from.comp!==active.id && w.to.comp!==active.id)return;
            const key=wireKey(w);
            delete paths[key];
            delete graph.editorLayout.manualPaths[key];
          });
          markGeometryChanged();
          status("元件已移动，相关连线已重新自动布线，电气连接保持不变。","success");
        }
        render();
      }else if(!cancel && c?.type==="input")toggleInput(c);
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
          if(!pathIsOrthogonal(points)||pathHitsObstacles(points,obstacles,4)||
             unrelatedOverlap(points,other,net)>0){
            graph.editorLayout=active.originLayout;routeCache.clear();
            status("线段不能穿过元件或与另一独立电路重叠。已保留原线路。","error");
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
    e.preventDefault();if(submitting)return;
    tapWireKey=null;tapPreview=null;
    intent("CANCEL");draftPoints=[];status("已取消当前接线或接点操作。 ");render();
  });
  svg.addEventListener("wheel",e=>{e.preventDefault();changeZoom(zoom+(e.deltaY<0?.08:-.08),e);},{passive:false});
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
  render();committedGraph=deep(graph);scheduleSim();
  const onAbort=()=>dispose();
  signal?.addEventListener("abort",onAbort,{once:true});
  function dispose(){if(disposed)return;disposed=true;++simEpoch;++simGeneration;clearTimeout(simTimer);
    if(previewRaf&&typeof cancelAnimationFrame==="function")cancelAnimationFrame(previewRaf);
    window.removeEventListener("keydown",onKey);signal?.removeEventListener("abort",onAbort);}
  return {dispose, canLeave};
};
