import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import shp from "shpjs";
import { LAYER_PRESETS, applyPresetToLayer, makeLegendItemFromLayer } from "./mapPresets";
import { downloadProjectFile, parseProjectFile, serializeProject } from "./projectState";

// ─── Constants ────────────────────────────────────────────────────────────────
const MARKER_TYPES = [
  { value:"circle",    label:"● Circle / Dot" },
  { value:"drillhole", label:"▼ Drillhole" },
  { value:"diamond",   label:"◆ Diamond" },
  { value:"square",    label:"■ Square" },
  { value:"triangle",  label:"▲ Triangle" },
];
const FILL_PATTERNS = [
  { value:"solid",      label:"Solid" },
  { value:"hatch",      label:"Hatch ////" },
  { value:"crosshatch", label:"Crosshatch" },
  { value:"dots",       label:"Dots ···" },
  { value:"none",       label:"No fill" },
];
const SNAP_THRESHOLD = 10;

// ─── Marker icon factory ──────────────────────────────────────────────────────
function makeMarkerIcon(type, color, size = 14) {
  const s = size, h = s / 2;
  let inner = "";
  if      (type==="circle")    inner = `<circle cx="${h}" cy="${h}" r="${h-1}" fill="${color}" stroke="#fff" stroke-width="1.2"/>`;
  else if (type==="drillhole") inner = `<polygon points="${h},${s-1} 1,1 ${s-1},1" fill="${color}" stroke="#fff" stroke-width="1"/><line x1="${h}" y1="0" x2="${h}" y2="${s}" stroke="${color}" stroke-width="2"/>`;
  else if (type==="diamond")   inner = `<polygon points="${h},1 ${s-1},${h} ${h},${s-1} 1,${h}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
  else if (type==="square")    inner = `<rect x="2" y="2" width="${s-4}" height="${s-4}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
  else if (type==="triangle")  inner = `<polygon points="${h},1 ${s-1},${s-1} 1,${s-1}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
  return L.icon({ iconUrl:`data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${inner}</svg>`)}`, iconSize:[s,s], iconAnchor:[h,h], popupAnchor:[0,-h-2] });
}
function markerSvgUrl(type, color, size = 16) {
  const s = size, h = s / 2;
  let inner = "";
  if      (type==="circle")    inner = `<circle cx="${h}" cy="${h}" r="${h-1}" fill="${color}" stroke="#444" stroke-width="0.8"/>`;
  else if (type==="drillhole") inner = `<polygon points="${h},${s-2} 2,2 ${s-2},2" fill="${color}" stroke="#444" stroke-width="1"/><line x1="${h}" y1="0" x2="${h}" y2="${s}" stroke="${color}" stroke-width="1.5"/>`;
  else if (type==="diamond")   inner = `<polygon points="${h},1 ${s-1},${h} ${h},${s-1} 1,${h}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  else if (type==="square")    inner = `<rect x="2" y="2" width="${s-4}" height="${s-4}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  else if (type==="triangle")  inner = `<polygon points="${h},1 ${s-1},${s-1} 1,${s-1}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  return `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${inner}</svg>`)}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const escapeHtml = v => String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const escapeXml  = v => String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");

function loadImageFile(file, setter) {
  const r = new FileReader(); r.onload = () => setter(r.result); r.readAsDataURL(file);
}
function csvToGeoJSON(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map(h => h.trim());
  const latIdx = headers.findIndex(h => /^lat(itude)?$/i.test(h));
  const lngIdx = headers.findIndex(h => /^lo?n(gitude|g)?$/i.test(h));
  if (latIdx < 0 || lngIdx < 0) throw new Error("CSV must have lat and lon/lng columns.");
  const features = lines.slice(1).filter(Boolean).map(line => {
    const parts = line.match(/("(?:[^"]|"")*"|[^,]*)/g).map(v => v.replace(/^"|"$/g,"").replace(/""/g,'"').trim());
    const props = {};
    headers.forEach((h,i) => { props[h] = parts[i]?.trim(); });
    return { type:"Feature", geometry:{ type:"Point", coordinates:[+parts[lngIdx],+parts[latIdx]] }, properties:props };
  });
  return { type:"FeatureCollection", features };
}
function isPointLayer(geojson) {
  const features = geojson.features ?? (Array.isArray(geojson) ? geojson.flatMap(g=>g.features??[]) : []);
  if (!features.length) return false;
  return features.filter(f=>f.geometry?.type==="Point"||f.geometry?.type==="MultiPoint").length/features.length > 0.5;
}
function getPropertyKeys(geojson) {
  const features = geojson.features ?? (Array.isArray(geojson) ? geojson.flatMap(g=>g.features??[]) : []);
  const keys = new Set();
  features.slice(0,20).forEach(f => Object.keys(f.properties??{}).forEach(k=>keys.add(k)));
  return [...keys];
}
async function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  return new Promise((res,rej) => { const s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
}
function circleToPolygon(center, radius, n=24) {
  return Array.from({length:n}, (_,i) => {
    const angle = (2*Math.PI*i/n) - Math.PI/2;
    const lat = center.lat + (radius/111320) * Math.cos(angle);
    const lng = center.lng + (radius/(111320*Math.cos(center.lat*Math.PI/180))) * Math.sin(angle);
    return L.latLng(lat, lng);
  });
}
function injectSvgPatterns(map, color) {
  const svg = map.getPanes().overlayPane?.querySelector("svg");
  if (!svg) return;
  let defs = svg.querySelector("defs");
  if (!defs) { defs = document.createElementNS("http://www.w3.org/2000/svg","defs"); svg.prepend(defs); }
  [
    { id:"mvp-hatch",      markup:`<pattern id="mvp-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="${color}" stroke-width="2.5"/></pattern>` },
    { id:"mvp-crosshatch", markup:`<pattern id="mvp-crosshatch" patternUnits="userSpaceOnUse" width="8" height="8"><line x1="0" y1="0" x2="0" y2="8" stroke="${color}" stroke-width="1.5"/><line x1="0" y1="0" x2="8" y2="0" stroke="${color}" stroke-width="1.5"/></pattern>` },
    { id:"mvp-dots",       markup:`<pattern id="mvp-dots" patternUnits="userSpaceOnUse" width="8" height="8"><circle cx="4" cy="4" r="2" fill="${color}"/></pattern>` },
  ].forEach(({id,markup}) => { const e=defs.querySelector(`#${id}`); if(e) e.remove(); defs.insertAdjacentHTML("beforeend",markup); });
}

// ─── Smart snap helper ────────────────────────────────────────────────────────
function computeSnap(x, y, w, h, elements, containerW, containerH, selfId) {
  let sx = x, sy = y;
  const guides = [];
  let bestDx = SNAP_THRESHOLD + 1, bestDy = SNAP_THRESHOLD + 1;
  const selfEdges = { xl:x, xc:x+w/2, xr:x+w, yt:y, yc:y+h/2, yb:y+h };
  const offX = [0, w/2, w], offY = [0, h/2, h];
  const candidates = [
    ...elements.filter(el=>el.id!==selfId).flatMap(el=>[
      {type:"v",pos:el.x}, {type:"v",pos:el.x+el.w/2}, {type:"v",pos:el.x+el.w},
      {type:"h",pos:el.y}, {type:"h",pos:el.y+el.h/2}, {type:"h",pos:el.y+el.h},
    ]),
    {type:"v",pos:0},{type:"v",pos:containerW/2},{type:"v",pos:containerW},
    {type:"h",pos:0},{type:"h",pos:containerH/2},{type:"h",pos:containerH},
  ];
  candidates.filter(c=>c.type==="v").forEach(c=>{
    [selfEdges.xl, selfEdges.xc, selfEdges.xr].forEach((edge,i)=>{
      const d=Math.abs(edge-c.pos);
      if(d<SNAP_THRESHOLD&&d<bestDx){ bestDx=d; sx=c.pos-offX[i]; guides.push({type:"v",pos:c.pos}); }
    });
  });
  candidates.filter(c=>c.type==="h").forEach(c=>{
    [selfEdges.yt, selfEdges.yc, selfEdges.yb].forEach((edge,i)=>{
      const d=Math.abs(edge-c.pos);
      if(d<SNAP_THRESHOLD&&d<bestDy){ bestDy=d; sy=c.pos-offY[i]; guides.push({type:"h",pos:c.pos}); }
    });
  });
  return { x:sx, y:sy, guides };
}

// ─── Resizable + Draggable element ────────────────────────────────────────────
function ResizableDraggable({ id, x, y, w, h, minW=60, minH=30, onMove, onResize, onDragStart, onDragEnd, children, className="", zIndex=1001, snapElements=[], containerW=1200, containerH=800 }) {
  const [snapGuides, setSnapGuides] = useState([]);

  const startDrag = useCallback((e) => {
    if (e.button!==0) return;
    e.stopPropagation(); e.preventDefault();
    onDragStart?.();
    const ox=e.clientX-x, oy=e.clientY-y;
    const mv=(ev)=>{
      let nx=ev.clientX-ox, ny=ev.clientY-oy;
      const snap=computeSnap(nx,ny,w,h,snapElements,containerW,containerH,id);
      nx=snap.x; ny=snap.y;
      setSnapGuides(snap.guides);
      onMove({x:nx,y:ny});
    };
    const up=()=>{ setSnapGuides([]); onDragEnd?.(); window.removeEventListener("mousemove",mv); window.removeEventListener("mouseup",up); };
    window.addEventListener("mousemove",mv); window.addEventListener("mouseup",up);
  },[x,y,w,h,id,onMove,onDragStart,onDragEnd,snapElements,containerW,containerH]);

  const startResize = useCallback((e,dir)=>{
    if(e.button!==0) return;
    e.stopPropagation(); e.preventDefault();
    const sx=e.clientX,sy=e.clientY,ox=x,oy=y,ow=w,oh=h;
    const mv=(ev)=>{
      const dx=ev.clientX-sx,dy=ev.clientY-sy;
      let nx=ox,ny=oy,nw=ow,nh=oh;
      if(dir.includes("e")) nw=Math.max(minW,ow+dx);
      if(dir.includes("s")) nh=Math.max(minH,oh+dy);
      if(dir.includes("w")){ nw=Math.max(minW,ow-dx); nx=ox+ow-nw; }
      if(dir.includes("n")){ nh=Math.max(minH,oh-dy); ny=oy+oh-nh; }
      onResize({x:nx,y:ny,w:nw,h:nh});
    };
    const up=()=>{ window.removeEventListener("mousemove",mv); window.removeEventListener("mouseup",up); };
    window.addEventListener("mousemove",mv); window.addEventListener("mouseup",up);
  },[x,y,w,h,minW,minH,onResize]);

  const handlePos = {
    n:  {top:-4,left:"50%",transform:"translateX(-50%)",cursor:"n-resize"},
    ne: {top:-4,right:-4,cursor:"ne-resize"},
    e:  {top:"50%",right:-4,transform:"translateY(-50%)",cursor:"e-resize"},
    se: {bottom:-4,right:-4,cursor:"se-resize"},
    s:  {bottom:-4,left:"50%",transform:"translateX(-50%)",cursor:"s-resize"},
    sw: {bottom:-4,left:-4,cursor:"sw-resize"},
    w:  {top:"50%",left:-4,transform:"translateY(-50%)",cursor:"w-resize"},
    nw: {top:-4,left:-4,cursor:"nw-resize"},
  };

  return (
    <>
      {snapGuides.map((g,i)=>(
        <div key={i} style={{position:"absolute",pointerEvents:"none",zIndex:9999,background:"rgba(80,180,255,0.7)",
          ...(g.type==="v"?{left:g.pos,top:0,width:1,height:"100%"}:{top:g.pos,left:0,height:1,width:"100%"})}}/>
      ))}
      <div className={`rdrag ${className}`}
        style={{position:"absolute",left:x,top:y,width:w,height:h,zIndex,userSelect:"none",cursor:"move",boxSizing:"border-box"}}
        onMouseDown={startDrag}>
        {children}
        {Object.entries(handlePos).map(([dir,pos])=>(
          <div key={dir} onMouseDown={e=>startResize(e,dir)}
            style={{position:"absolute",width:8,height:8,background:"rgba(80,160,255,0.9)",border:"1px solid #fff",borderRadius:2,zIndex:10,...pos}}/>
        ))}
      </div>
    </>
  );
}

// ─── Text element (double-click to edit) ─────────────────────────────────────
function TextEl({ el, onChange, onDragStart, onDragEnd, selected, onSelect, snapElements, containerW, containerH }) {
  const [editing,setEditing] = useState(false);
  const taRef = useRef(null);
  return (
    <ResizableDraggable id={el.id} x={el.x} y={el.y} w={el.w} h={el.h}
      onMove={p=>onChange({...el,...p})} onResize={p=>onChange({...el,...p})}
      onDragStart={onDragStart} onDragEnd={onDragEnd}
      snapElements={snapElements} containerW={containerW} containerH={containerH}
      zIndex={selected?1010:1001}>
      <div style={{width:"100%",height:"100%",border:selected?"1.5px dashed rgba(80,160,255,0.8)":"1.5px dashed transparent"}}
        onClick={e=>{e.stopPropagation();onSelect(el.id);}}
        onDoubleClick={e=>{e.stopPropagation();setEditing(true);setTimeout(()=>taRef.current?.focus(),0);}}>
        {editing?(
          <textarea ref={taRef} value={el.text} onChange={e=>onChange({...el,text:e.target.value})} onBlur={()=>setEditing(false)}
            style={{width:"100%",height:"100%",background:"transparent",border:"none",outline:"none",resize:"none",color:el.color,fontSize:el.size,fontWeight:el.bold?"bold":"normal",fontFamily:"Arial",lineHeight:1.3,padding:4}}/>
        ):(
          <div style={{width:"100%",height:"100%",color:el.color,fontSize:el.size,fontWeight:el.bold?"bold":"normal",fontFamily:"Arial",lineHeight:1.3,padding:4,whiteSpace:"pre-wrap",wordBreak:"break-word",overflow:"hidden"}}>
            {el.text}
          </div>
        )}
      </div>
    </ResizableDraggable>
  );
}

// ─── Callout box ──────────────────────────────────────────────────────────────
function CalloutBox({ c, onChange, onDragStart, onDragEnd, selected, onSelect, snapElements, containerW, containerH }) {
  const [editing,setEditing] = useState(false);
  const taRef = useRef(null);
  const lines = c.text.replace(/\\n/g,"\n").split("\n");
  const bw = c.w ?? Math.max(120, Math.max(...lines.map(l=>l.length))*7.5+24);
  const bh = c.h ?? (lines.length*18+14);
  return (
    <>
      <svg style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:1002}} xmlns="http://www.w3.org/2000/svg">
        <line x1={c.pinX} y1={c.pinY} x2={c.boxX+bw/2} y2={c.boxY+bh} stroke={c.borderColor} strokeWidth="1.5" strokeDasharray="5,3"/>
        <circle cx={c.pinX} cy={c.pinY} r="7" fill={c.borderColor} style={{pointerEvents:"all",cursor:"move"}}
          onMouseDown={e=>{
            if(e.button!==0)return; e.stopPropagation(); e.preventDefault();
            const sx=e.clientX,sy=e.clientY,ox=c.pinX,oy=c.pinY;
            const mv=(ev)=>onChange({pinX:ox+(ev.clientX-sx),pinY:oy+(ev.clientY-sy)});
            const up=()=>{window.removeEventListener("mousemove",mv);window.removeEventListener("mouseup",up);};
            window.addEventListener("mousemove",mv);window.addEventListener("mouseup",up);
          }}/>
        <circle cx={c.pinX} cy={c.pinY} r="3" fill="#fff" style={{pointerEvents:"none"}}/>
      </svg>
      <ResizableDraggable id={c.id} x={c.boxX} y={c.boxY} w={bw} h={bh}
        onMove={p=>onChange({boxX:p.x,boxY:p.y})} onResize={p=>onChange({boxX:p.x,boxY:p.y,w:p.w,h:p.h})}
        onDragStart={onDragStart} onDragEnd={onDragEnd}
        snapElements={snapElements} containerW={containerW} containerH={containerH}
        zIndex={selected?1010:1003}>
        <div style={{width:"100%",height:"100%",background:c.bgColor,border:`1.5px solid ${c.borderColor}`,borderRadius:3,boxSizing:"border-box",overflow:"hidden",cursor:"move"}}
          onClick={e=>{e.stopPropagation();onSelect(c.id);}}
          onDoubleClick={e=>{e.stopPropagation();setEditing(true);setTimeout(()=>taRef.current?.focus(),0);}}>
          {editing?(
            <textarea ref={taRef} value={c.text} onChange={e=>onChange({text:e.target.value})} onBlur={()=>setEditing(false)}
              style={{width:"100%",height:"100%",background:"transparent",border:"none",outline:"none",resize:"none",color:c.borderColor,fontSize:12,fontFamily:"Arial",padding:"6px 8px"}}/>
          ):(
            <div style={{padding:"6px 8px",color:c.borderColor,fontSize:12,fontFamily:"Arial",fontWeight:600,whiteSpace:"pre-wrap",wordBreak:"break-word",overflow:"hidden",height:"100%"}}>
              {c.text.replace(/\\n/g,"\n")}
            </div>
          )}
        </div>
      </ResizableDraggable>
    </>
  );
}

// ─── Canvas image overlay ─────────────────────────────────────────────────────
function CanvasImageOverlay({ ov, onChange, onDragStart, onDragEnd, selected, onSelect, snapElements, containerW, containerH }) {
  return (
    <ResizableDraggable id={ov.id} x={ov.px} y={ov.py} w={ov.pw} h={ov.ph}
      onMove={p=>onChange({px:p.x,py:p.y})} onResize={p=>onChange({px:p.x,py:p.y,pw:p.w,ph:p.h})}
      onDragStart={onDragStart} onDragEnd={onDragEnd}
      snapElements={snapElements} containerW={containerW} containerH={containerH}
      zIndex={selected?1010:1000}>
      <div style={{width:"100%",height:"100%",border:selected?"1.5px dashed rgba(80,160,255,0.8)":"none"}}
        onClick={e=>{e.stopPropagation();onSelect(ov.id);}}>
        <img src={ov.src} alt={ov.name} style={{width:"100%",height:"100%",objectFit:"fill",opacity:ov.opacity,display:"block",pointerEvents:"none"}}/>
      </div>
    </ResizableDraggable>
  );
}

// ─── Snap grid ────────────────────────────────────────────────────────────────
function SnapGrid({ active, containerRef }) {
  if (!active||!containerRef.current) return null;
  const W=containerRef.current.offsetWidth, H=containerRef.current.offsetHeight;
  return (
    <svg style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:2000}} xmlns="http://www.w3.org/2000/svg">
      {[0.25,0.33,0.5,0.66,0.75].map(f=>(
        <g key={f}>
          <line x1={W*f} y1={0} x2={W*f} y2={H} stroke="rgba(100,180,255,0.18)" strokeWidth="1" strokeDasharray="4,4"/>
          <line x1={0} y1={H*f} x2={W} y2={H*f} stroke="rgba(100,180,255,0.18)" strokeWidth="1" strokeDasharray="4,4"/>
        </g>
      ))}
      <line x1={W/2} y1={0} x2={W/2} y2={H} stroke="rgba(100,200,255,0.28)" strokeWidth="1"/>
      <line x1={0} y1={H/2} x2={W} y2={H/2} stroke="rgba(100,200,255,0.28)" strokeWidth="1"/>
    </svg>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const mapRef       = useRef(null);
  const containerRef = useRef(null);
  const drawRef      = useRef({ points:[], preview:null, center:null });
  const projectInputRef = useRef(null);

  const [layers,       setLayers]       = useState([]);
  const [title,        setTitle]        = useState("RIFT PROJECT");
  const [subtitle,     setSubtitle]     = useState("Nebraska");
  const [titlePos,     setTitlePos]     = useState({ x:null, y:18, w:240, h:62 });
  const [logo,         setLogo]         = useState(null);
  const [logoPos,      setLogoPos]      = useState({ x:18, y:18, w:120, h:60 });
  const [northArrow,   setNorthArrow]   = useState(true);
  const [showLegend,   setShowLegend]   = useState(true);
  const [legendPos,    setLegendPos]    = useState({ x:16, y:null, w:200, h:null });
  const [legendItems,  setLegendItems]  = useState([]);
  const [legendDraft,  setLegendDraft]  = useState({ text:"", type:"swatch", color:"#4e8cff", markerType:"circle" });
  const [showInset,    setShowInset]    = useState(true);
  const [insetImage,   setInsetImage]   = useState(null);
  const [insetPos,     setInsetPos]     = useState({ x:null, y:80, w:190, h:140 });
  const [canvasImages, setCanvasImages] = useState([]);
  const [textEls,      setTextEls]      = useState([]);
  const [textDraft,    setTextDraft]    = useState({ text:"New Text", color:"#ffffff", size:16, bold:false });
  const [callouts,     setCallouts]     = useState([]);
  const [calloutDraft, setCalloutDraft] = useState({ text:"", bgColor:"#ffffff", borderColor:"#1a3a6b" });
  const [curvedLabels, setCurvedLabels] = useState([]);
  const [curvedDraft,  setCurvedDraft]  = useState({ text:"", color:"#111111", size:20 });
  const [curvedStep,   setCurvedStep]   = useState(null);
  const curvedP1Ref = useRef(null);
  const [drawMode,     setDrawMode]     = useState("none");
  const [drawStyle,    setDrawStyle]    = useState({ color:"#e63946", fill:"#e63946", opacity:0.25, weight:2 });
  const [drawActive,   setDrawActive]   = useState(false);
  const [exporting,    setExporting]    = useState(false);
  const [exportType,   setExportType]   = useState("png");
  const [exportScale,  setExportScale]  = useState(3);
  const [baseMap,      setBaseMap]      = useState("sat");
  const [draggingAny,  setDraggingAny]  = useState(false);
  const [selectedId,   setSelectedId]   = useState(null);
  const [groups,       setGroups]       = useState([]);
  const [placing,      setPlacing]      = useState(null);
  const [, tick] = useState(0);

  // ── Map init ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    const mapEl=document.getElementById("map");
    if(!mapEl||mapRef.current) return;
    const map=L.map(mapEl,{doubleClickZoom:false}).setView([40,-96],5);
    const osm=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM",maxZoom:19});
    const sat=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{attribution:"Esri",maxZoom:19});
    sat.addTo(map); map._baseLayers={osm,sat}; map._activeBase=sat;
    L.control.scale({imperial:false}).addTo(map);
    mapRef.current=map;
    setTimeout(()=>map.invalidateSize(),100);
    return ()=>{if(mapRef.current){mapRef.current.remove();mapRef.current=null;}};
  },[]);

  useEffect(()=>{
    const map=mapRef.current;if(!map)return;
    const fn=()=>tick(n=>n+1);
    map.on("move zoom moveend zoomend",fn);
    return ()=>map.off("move zoom moveend zoomend",fn);
  },[]);

  // ── Map click handler ─────────────────────────────────────────────────────
  useEffect(()=>{
    const map=mapRef.current;if(!map)return;
    const ds=drawRef.current;

    const onClick=(e)=>{
      const latlng=e.latlng;
      const rect=containerRef.current.getBoundingClientRect();
      const px={x:e.originalEvent.clientX-rect.left, y:e.originalEvent.clientY-rect.top};

      if(placing==="text"){
        setTextEls(p=>[...p,{id:crypto.randomUUID(),text:textDraft.text,color:textDraft.color,size:textDraft.size,bold:textDraft.bold,x:px.x,y:px.y,w:180,h:60}]);
        setPlacing(null); return;
      }
      if(placing==="callout"){
        setCallouts(p=>[...p,{id:crypto.randomUUID(),text:calloutDraft.text||"Label",bgColor:calloutDraft.bgColor,borderColor:calloutDraft.borderColor,pinX:px.x,pinY:px.y,boxX:px.x+24,boxY:px.y-64,w:null,h:null}]);
        setPlacing(null); return;
      }
      if(curvedStep==="p1"){curvedP1Ref.current=latlng;setCurvedStep("p2");return;}
      if(curvedStep==="p2"){
        setCurvedLabels(p=>[...p,{id:crypto.randomUUID(),text:curvedDraft.text,color:curvedDraft.color,size:curvedDraft.size,p1:curvedP1Ref.current,p2:latlng}]);
        setCurvedStep(null);return;
      }
      if(drawMode==="none"){setSelectedId(null);return;}

      if(drawMode==="circle"){
        if(!ds.points.length){ds.points=[latlng];ds.center=latlng;}
        else{
          const r=ds.center.distanceTo(latlng);
          if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
          const pts=circleToPolygon(ds.center,r,32);
          const poly=L.polygon(pts,{color:drawStyle.color,weight:drawStyle.weight,fill:true,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity}).addTo(map);
          commitDrawn(poly,"Circle",pts); ds.points=[];ds.center=null;
        }
        return;
      }
      if(drawMode==="rectangle"){
        if(!ds.points.length){ds.points=[latlng];}
        else{
          if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
          const poly=L.rectangle(L.latLngBounds(ds.points[0],latlng),{color:drawStyle.color,weight:drawStyle.weight,fill:true,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity}).addTo(map);
          commitDrawn(poly,"Rectangle",null); ds.points=[];
        }
        return;
      }
      if(drawMode==="polygon"||drawMode==="line"){
        ds.points.push(latlng);
        if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
        if(ds.points.length>1){
          ds.preview=(drawMode==="polygon"?L.polygon:L.polyline)(ds.points,{color:drawStyle.color,weight:drawStyle.weight,fill:drawMode==="polygon",fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity,dashArray:"6,4"}).addTo(map);
        }
        setDrawActive(true); return;
      }
    };

    const onMouseMove=(e)=>{
      if(drawMode==="circle"&&ds.points.length===1){
        const r=ds.center.distanceTo(e.latlng);
        if(ds.preview) map.removeLayer(ds.preview);
        const pts=circleToPolygon(ds.center,r,32);
        ds.preview=L.polygon(pts,{color:drawStyle.color,weight:1,fill:true,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity*0.4,dashArray:"4,4"}).addTo(map);
      }
    };

    const onDblClick=(e)=>{
      if((drawMode==="polygon"||drawMode==="line")&&ds.points.length>=2){
        L.DomEvent.stopPropagation(e);
        if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
        const layer=(drawMode==="polygon"?L.polygon:L.polyline)(ds.points,{color:drawStyle.color,weight:drawStyle.weight,fill:drawMode==="polygon",fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity}).addTo(map);
        commitDrawn(layer,drawMode==="polygon"?"Polygon":"Line",drawMode==="polygon"?[...ds.points]:null);
        ds.points=[];setDrawActive(false);
      }
    };

    const onKey=(e)=>{
      if(e.key==="Escape"){
        if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
        ds.points=[]; setDrawMode("none"); setDrawActive(false);
        setCurvedStep(null); setPlacing(null); setSelectedId(null);
      }
      if((e.key==="Delete"||e.key==="Backspace")&&selectedId&&document.activeElement.tagName!=="INPUT"&&document.activeElement.tagName!=="TEXTAREA"){
        setTextEls(p=>p.filter(x=>x.id!==selectedId));
        setCallouts(p=>p.filter(x=>x.id!==selectedId));
        setCanvasImages(p=>p.filter(x=>x.id!==selectedId));
        setCurvedLabels(p=>p.filter(x=>x.id!==selectedId));
        setSelectedId(null);
      }
    };

    map.on("click",onClick); map.on("mousemove",onMouseMove); map.on("dblclick",onDblClick);
    window.addEventListener("keydown",onKey);
    const isPlacing=placing||curvedStep||drawMode!=="none";
    map.getContainer().style.cursor=isPlacing?"crosshair":"";
    return ()=>{map.off("click",onClick);map.off("mousemove",onMouseMove);map.off("dblclick",onDblClick);window.removeEventListener("keydown",onKey);};
  },[placing,curvedStep,drawMode,drawStyle,textDraft,calloutDraft,selectedId]);

  // ── Commit drawn shape ─────────────────────────────────────────────────────
  const commitDrawn=useCallback((layer,name,editablePoints)=>{
    setLayers(p=>[...p,{
      id:crypto.randomUUID(),name,layer,_geojson:null,visible:true,isPoint:false,isDrawn:true,
      editablePoints,color:drawStyle.color,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity,
      fillPattern:"solid",weight:drawStyle.weight,layerOpacity:1,dashArray:"",legendSymbol:"swatch",legendDashArray:"",preset:"",
      legendLabel:name,includeInLegend:false,propKeys:[],showLabels:false,labelField:"",
    }]);
  },[drawStyle]);

  // ── GeoJSON layer builder ──────────────────────────────────────────────────
  const buildLeafletLayer=useCallback((geojson,cfg)=>{
    const map=mapRef.current;if(!map||!geojson) return null;
    injectSvgPatterns(map,cfg.fillColor);
    let fillStyle={};
    if(cfg.fillPattern==="none")       fillStyle={fill:false,fillOpacity:0};
    else if(cfg.fillPattern==="solid") fillStyle={fill:true,fillColor:cfg.fillColor,fillOpacity:+cfg.fillOpacity};
    else                               fillStyle={fill:true,fillColor:`url(#mvp-${cfg.fillPattern})`,fillOpacity:1};
    return L.geoJSON(geojson,{
      renderer: L.svg(),
      style:()=>({color:cfg.color,weight:+cfg.weight,opacity:+cfg.layerOpacity,dashArray:cfg.dashArray||undefined,lineCap:"round",lineJoin:"round",...fillStyle}),
      pointToLayer:(_,latlng)=>L.marker(latlng,{icon:makeMarkerIcon(cfg.markerType,cfg.markerColor,+cfg.pointRadius*2),opacity:+cfg.layerOpacity}),
      onEachFeature:(feature,l)=>{
        const p=feature.properties||{};
        l.bindPopup(Object.keys(p).length?`<pre style="margin:0;font-size:11px;max-width:260px;overflow:auto">${escapeHtml(JSON.stringify(p,null,2))}</pre>`:"No attributes");
        if(cfg.showLabels&&cfg.labelField&&p[cfg.labelField]!=null)
          l.bindTooltip(String(p[cfg.labelField]),{permanent:true,direction:"right",className:"mv-label",offset:[10,0]});
      },
    });
  },[]);

  const reRenderLayer=useCallback((item,patch)=>{
    const map=mapRef.current;if(!map) return item;
    const u={...item,...patch};
    if(item.layer) map.removeLayer(item.layer);
    if(u.isDrawn){u.layer?.addTo(map);return u;}
    const nl=buildLeafletLayer(u._geojson,u);
    if(nl&&u.visible) nl.addTo(map);
    return{...u,layer:nl};
  },[buildLeafletLayer]);

  const RERENDER=new Set(["color","fillColor","fillOpacity","fillPattern","weight","pointRadius","markerType","markerColor","layerOpacity","showLabels","labelField","dashArray"]);

  const addLayer=useCallback((geojson,name)=>{
    const map=mapRef.current;if(!map)return;
    const propKeys=getPropertyKeys(geojson);
    const isPoint=isPointLayer(geojson);
    const cfg={
      id:crypto.randomUUID(),name,_geojson:geojson,visible:true,isPoint,isDrawn:false,
      color:"#4e8cff",fillColor:"#4e8cff",fillOpacity:0.35,fillPattern:"solid",
      weight:2,pointRadius:6,markerType:"circle",markerColor:"#1a1a1a",
      layerOpacity:1,showLabels:false,labelField:propKeys[0]??"",
      propKeys,legendLabel:name,includeInLegend:true,preset:"",dashArray:"",legendSymbol:isPoint?"marker":"swatch",legendDashArray:"",
    };
    const layer=buildLeafletLayer(geojson,cfg);
    if(!layer)return;
    layer.addTo(map);
    try{const b=layer.getBounds();if(b.isValid())map.fitBounds(b,{padding:[20,20]});}catch{}
    setLayers(p=>[...p,{...cfg,layer}]);
  },[buildLeafletLayer]);

  const handleFile=async(file)=>{
    if(!file)return;
    try{
      if(file.name.endsWith(".zip")){addLayer(await shp(await file.arrayBuffer()),file.name.replace(".zip",""));return;}
      if(file.name.endsWith(".geojson")||file.name.endsWith(".json")){addLayer(JSON.parse(await file.text()),file.name);return;}
      if(file.name.endsWith(".csv")){addLayer(csvToGeoJSON(await file.text()),file.name.replace(".csv",""));return;}
      alert("Supported: .zip, .geojson, .json, .csv");
    }catch(err){console.error(err);alert(`Import failed: ${err.message}`);}
  };

  const updateLayer=useCallback((id,patch)=>{
    setLayers(p=>p.map(item=>{
      if(item.id!==id)return item;
      if(item.isDrawn){
        const u={...item,...patch};
        item.layer?.setStyle?.({color:u.color,weight:+u.weight,fillColor:u.fillColor,fillOpacity:+u.fillOpacity,opacity:+u.layerOpacity,dashArray:u.dashArray||undefined,lineCap:"round",lineJoin:"round"});
        return u;
      }
      if(Object.keys(patch).some(k=>RERENDER.has(k))) return reRenderLayer(item,patch);
      return{...item,...patch};
    }));
  },[reRenderLayer]);

  const toggleLayer=(id)=>{
    const map=mapRef.current;
    setLayers(p=>p.map(item=>{if(item.id!==id)return item;if(item.visible)map.removeLayer(item.layer);else item.layer?.addTo(map);return{...item,visible:!item.visible};}));
  };
  const removeLayer=(id)=>{
    const map=mapRef.current;
    setLayers(p=>{const t=p.find(l=>l.id===id);if(t)map?.removeLayer(t.layer);return p.filter(l=>l.id!==id);});
  };
  const moveLayer=(id,dir)=>{
    setLayers(p=>{
      const idx=p.findIndex(l=>l.id===id);if(idx<0)return p;
      const ni=idx+dir;if(ni<0||ni>=p.length)return p;
      const next=[...p];[next[idx],next[ni]]=[next[ni],next[idx]];
      const map=mapRef.current;
      if(map)next.forEach(item=>{if(item.visible&&item.layer){map.removeLayer(item.layer);item.layer.addTo(map);}});
      return next;
    });
  };

  const saveProject=()=>{
    const filenameBase=(title||"mapviewer-project").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"mapviewer-project";
    downloadProjectFile(serializeProject({
      title, subtitle, baseMap, northArrow, showLegend, showInset, logo, insetImage,
      legendItems, canvasImages, textEls, callouts, curvedLabels, groups, layers,
      titlePos, logoPos, legendPos, insetPos, exportScale,
    }), filenameBase);
  };

  const loadProject=async(file)=>{
    if(!file) return;
    try{
      const project=await parseProjectFile(file);
      const map=mapRef.current;
      if(map){
        layers.forEach(item=>{ if(item.layer) map.removeLayer(item.layer); });
      }
      const restoredLayers=(project.layers||[]).map(item=>{
        const next={...item};
        if(next._geojson){
          const leafletLayer=buildLeafletLayer(next._geojson,next);
          next.layer=leafletLayer;
          if(next.visible!==false) leafletLayer?.addTo(map);
        }
        return next;
      });
      setLayers(restoredLayers);
      setTitle(project.title||"RIFT PROJECT");
      setSubtitle(project.subtitle||"");
      setBaseMap(project.baseMap||"sat");
      if(project.baseMap) switchBase(project.baseMap);
      setNorthArrow(project.northArrow!==false);
      setShowLegend(project.showLegend!==false);
      setShowInset(project.showInset!==false);
      setLogo(project.logo||null);
      setInsetImage(project.insetImage||null);
      setLegendItems(Array.isArray(project.legendItems)?project.legendItems:[]);
      setCanvasImages(Array.isArray(project.canvasImages)?project.canvasImages:[]);
      setTextEls(Array.isArray(project.textEls)?project.textEls:[]);
      setCallouts(Array.isArray(project.callouts)?project.callouts:[]);
      setCurvedLabels(Array.isArray(project.curvedLabels)?project.curvedLabels:[]);
      setGroups(Array.isArray(project.groups)?project.groups:[]);
      if(project.titlePos) setTitlePos(project.titlePos);
      if(project.logoPos) setLogoPos(project.logoPos);
      if(project.legendPos) setLegendPos(project.legendPos);
      if(project.insetPos) setInsetPos(project.insetPos);
      if(project.exportScale) setExportScale(project.exportScale);
      setSelectedId(null);
      setTimeout(()=>{
        try{
          const vis=restoredLayers.filter(l=>l.visible!==false&&l.layer).map(l=>l.layer);
          if(vis.length){
            const b=L.featureGroup(vis).getBounds();
            if(b.isValid()) map.fitBounds(b,{padding:[20,20]});
          }
        }catch{}
      }, 50);
    }catch(err){
      console.error(err);
      alert(`Project load failed: ${err.message}`);
    }finally{
      if(projectInputRef.current) projectInputRef.current.value="";
    }
  };

  const buildLegendFromLayers=()=>{
    const next=layers.filter(l=>l.includeInLegend).map(makeLegendItemFromLayer);
    setLegendItems(next);
  };

  const fitAll=()=>{
    const map=mapRef.current;if(!map)return;
    const vis=layers.filter(l=>l.visible&&l.layer).map(l=>l.layer);
    if(!vis.length)return;
    try{const b=L.featureGroup(vis).getBounds();if(b.isValid())map.fitBounds(b,{padding:[20,20]});}catch{}
  };
  const switchBase=(type)=>{
    const map=mapRef.current;if(!map)return;
    const{osm,sat}=map._baseLayers;
    if(map._activeBase)map.removeLayer(map._activeBase);
    const next=type==="osm"?osm:sat;next.addTo(map);map._activeBase=next;
    setBaseMap(type);
  };

  // ── PNG Export ────────────────────────────────────────────────────────────
  function svgNodeToDataUrl(svgNode) {
    const serializer = new XMLSerializer();
    let svgText = serializer.serializeToString(svgNode);

    if (!svgText.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svgText = svgText.replace(
        "<svg",
        '<svg xmlns="http://www.w3.org/2000/svg"'
      );
    }

    if (!svgText.includes('xmlns:xlink="http://www.w3.org/1999/xlink"')) {
      svgText = svgText.replace(
        "<svg",
        '<svg xmlns:xlink="http://www.w3.org/1999/xlink"'
      );
    }

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function getLeafletOverlayImageInfo(map, surface) {
    const overlayPane = map.getPanes().overlayPane;
    const overlaySvg = overlayPane?.querySelector("svg");
    if (!overlaySvg) return null;

    const surfaceRect = surface.getBoundingClientRect();
    const overlayRect = overlaySvg.getBoundingClientRect();

    const intrinsicWidth =
      parseFloat(overlaySvg.getAttribute("width")) || overlayRect.width || surface.offsetWidth;
    const intrinsicHeight =
      parseFloat(overlaySvg.getAttribute("height")) || overlayRect.height || surface.offsetHeight;

    const renderLeft = overlayRect.left - surfaceRect.left;
    const renderTop = overlayRect.top - surfaceRect.top;
    const renderWidth = overlayRect.width;
    const renderHeight = overlayRect.height;

    const cloned = overlaySvg.cloneNode(true);

    cloned.removeAttribute("style");
    cloned.style.display = "block";
    cloned.style.visibility = "visible";
    cloned.style.overflow = "hidden";

    cloned.querySelectorAll("*").forEach((el) => {
      const cs = window.getComputedStyle(el);
      if (!cs) return;

      if (cs.fill) el.setAttribute("fill", cs.fill);
      if (cs.stroke) el.setAttribute("stroke", cs.stroke);
      if (cs.strokeWidth) el.setAttribute("stroke-width", cs.strokeWidth);
      if (cs.fillOpacity) el.setAttribute("fill-opacity", cs.fillOpacity);
      if (cs.strokeOpacity) el.setAttribute("stroke-opacity", cs.strokeOpacity);
      if (cs.opacity) el.setAttribute("opacity", cs.opacity);
      if (cs.strokeDasharray && cs.strokeDasharray !== "none") {
        el.setAttribute("stroke-dasharray", cs.strokeDasharray);
      }
      if (cs.strokeLinecap) el.setAttribute("stroke-linecap", cs.strokeLinecap);
      if (cs.strokeLinejoin) el.setAttribute("stroke-linejoin", cs.strokeLinejoin);
      if (cs.vectorEffect) el.setAttribute("vector-effect", cs.vectorEffect);
    });

    cloned.setAttribute("width", intrinsicWidth);
    cloned.setAttribute("height", intrinsicHeight);

    if (!cloned.getAttribute("viewBox")) {
      cloned.setAttribute("viewBox", `0 0 ${intrinsicWidth} ${intrinsicHeight}`);
    }

    return {
      dataUrl: svgNodeToDataUrl(cloned),
      left: renderLeft,
      top: renderTop,
      width: renderWidth,
      height: renderHeight,
    };
  }

  const doExportPNG = async () => {
    setExporting(true);
    setSelectedId(null);

    const sidebar = document.querySelector(".sidebar");
    const mapSide = document.querySelector(".map-side");

    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");

      if (sidebar) sidebar.style.display = "none";
      if (mapSide) mapSide.style.width = "100vw";

      mapRef.current?.invalidateSize();

      await new Promise((r) => setTimeout(r, 1000));

      await new Promise((resolve) => {
        const imgs = Array.from(document.querySelectorAll(".leaflet-tile-container img"));
        const pending = imgs.filter((img) => !img.complete);

        if (!pending.length) {
          resolve();
          return;
        }

        let done = 0;
        const finish = () => {
          done += 1;
          if (done >= pending.length) resolve();
        };

        pending.forEach((img) => {
          img.addEventListener("load", finish, { once: true });
          img.addEventListener("error", finish, { once: true });
        });

        setTimeout(resolve, 8000);
      });

      const surface = document.querySelector(".export-surface");
      if (!surface) throw new Error("Export surface not found.");

      const overlayInfo = getLeafletOverlayImageInfo(mapRef.current, surface);

      let overlayImgEl = null;

      if (overlayInfo?.dataUrl) {
        await loadImage(overlayInfo.dataUrl);

        overlayImgEl = document.createElement("img");
        overlayImgEl.dataset.exportOverlay = "true";
        overlayImgEl.src = overlayInfo.dataUrl;
        overlayImgEl.alt = "";
        overlayImgEl.setAttribute("aria-hidden", "true");
        overlayImgEl.style.position = "absolute";
        overlayImgEl.style.left = `${overlayInfo.left}px`;
        overlayImgEl.style.top = `${overlayInfo.top}px`;
        overlayImgEl.style.width = `${overlayInfo.width}px`;
        overlayImgEl.style.height = `${overlayInfo.height}px`;
        overlayImgEl.style.pointerEvents = "none";
        overlayImgEl.style.zIndex = "500";
        overlayImgEl.style.display = "block";

        surface.appendChild(overlayImgEl);
      }

      const canvas = await window.html2canvas(surface, {
        useCORS: true,
        allowTaint: true,
        scale: exportScale,
        logging: false,
        backgroundColor: "#ffffff",
        imageTimeout: 20000,
        onclone: (doc) => {
          doc.querySelectorAll(".rdrag > div[style]").forEach((el) => {
            if (el.style.cursor && el.style.cursor.includes("resize")) {
              el.style.display = "none";
            }
          });

          doc.querySelectorAll(".rdrag").forEach((el) => {
            el.style.outline = "none";
            el.style.boxShadow = "none";
          });

          doc.querySelectorAll(".leaflet-overlay-pane svg").forEach((el) => {
            el.style.display = "none";
            el.style.visibility = "hidden";
          });
        },
      });

      if (overlayImgEl) overlayImgEl.remove();

      const a = document.createElement("a");
      a.download = `${title.toLowerCase().replace(/\s+/g, "-")}-map.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (err) {
      console.error(err);
      alert(
        "PNG export failed. Browser-based satellite export can still be fragile.\n\n" + err.message
      );
    } finally {
      document
        .querySelectorAll('.export-surface > img[data-export-overlay="true"]')
        .forEach((el) => el.remove());
      if (sidebar) sidebar.style.display = "";
      if (mapSide) mapSide.style.width = "";
      mapRef.current?.invalidateSize();
      setExporting(false);
    }
  };
const doExportSVG = () => {
  const map = mapRef.current;
  if (!map) return;

  const surface = document.querySelector(".export-surface");
  if (!surface) return;

  const W = surface.offsetWidth;
  const H = surface.offsetHeight;

  const overlaySvg = map.getPanes().overlayPane?.querySelector("svg");
  let overlayContent = "";

  if (overlaySvg) {
    const clone = overlaySvg.cloneNode(true);
    clone.style.transform = "";
    clone.removeAttribute("transform");
    clone.removeAttribute("style");

    // Force inline styles so exported vectors stay visible/editable
    clone.querySelectorAll("*").forEach((el) => {
      const cs = window.getComputedStyle(el);
      if (!cs) return;

      if (cs.fill) el.setAttribute("fill", cs.fill);
      if (cs.stroke) el.setAttribute("stroke", cs.stroke);
      if (cs.strokeWidth) el.setAttribute("stroke-width", cs.strokeWidth);
      if (cs.fillOpacity) el.setAttribute("fill-opacity", cs.fillOpacity);
      if (cs.strokeOpacity) el.setAttribute("stroke-opacity", cs.strokeOpacity);
      if (cs.opacity) el.setAttribute("opacity", cs.opacity);
      if (cs.strokeDasharray && cs.strokeDasharray !== "none") {
        el.setAttribute("stroke-dasharray", cs.strokeDasharray);
      }
      if (cs.strokeLinecap) el.setAttribute("stroke-linecap", cs.strokeLinecap);
      if (cs.strokeLinejoin) el.setAttribute("stroke-linejoin", cs.strokeLinejoin);
    });

    overlayContent = clone.innerHTML;
  }

  const tooltipSvg = [];
  map.getPanes()
    .tooltipPane?.querySelectorAll(".mv-label")
    .forEach((el) => {
      const rect = el.getBoundingClientRect();
      const surfRect = surface.getBoundingClientRect();
      tooltipSvg.push(
        `<text x="${rect.left - surfRect.left}" y="${rect.top - surfRect.top + 11}" font-size="11" font-family="Arial" font-weight="600" fill="#111">${escapeXml(el.textContent)}</text>`
      );
    });

  // Export point layers from map coordinates, not DOM marker image positions
  const pointLayerSvg = layers
    .filter((l) => l.visible !== false && l.isPoint && l._geojson)
    .flatMap((layer) => {
      const features =
        layer._geojson?.type === "FeatureCollection"
          ? layer._geojson.features || []
          : layer._geojson?.type === "Feature"
            ? [layer._geojson]
            : [];

      const color = layer.markerColor || layer.color || "#1a1a1a";
      const radius = Number(layer.pointRadius || 6);
      const opacity = Number(layer.layerOpacity ?? 1);
      const markerType = layer.markerType || "circle";

      return features
        .filter(
          (f) =>
            f?.geometry?.type === "Point" &&
            Array.isArray(f.geometry.coordinates) &&
            f.geometry.coordinates.length >= 2
        )
        .map((f, idx) => {
          const [lng, lat] = f.geometry.coordinates;
          const pt = map.latLngToContainerPoint([lat, lng]);

const x = pt.x;
const y = pt.y;

switch (markerType) {
  case "square":
    return `<rect x="${x - radius}" y="${y - radius}" width="${radius * 2}" height="${radius * 2}" fill="${color}" fill-opacity="${opacity}" stroke="#ffffff" stroke-width="1.2"/>`;

  case "diamond":
    return `<polygon points="${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}" fill="${color}" fill-opacity="${opacity}" stroke="#ffffff" stroke-width="1.2"/>`;

  case "triangle":
    return `<polygon points="${x},${y - radius} ${x + radius * 0.9},${y + radius} ${x - radius * 0.9},${y + radius}" fill="${color}" fill-opacity="${opacity}" stroke="#ffffff" stroke-width="1.2"/>`;

  case "cross":
    return `
      <g opacity="${opacity}">
        <line x1="${x - radius}" y1="${y}" x2="${x + radius}" y2="${y}" stroke="${color}" stroke-width="2"/>
        <line x1="${x}" y1="${y - radius}" x2="${x}" y2="${y + radius}" stroke="${color}" stroke-width="2"/>
      </g>
    `;

  case "drillhole": {
    const s = radius * 2;
    const h = radius;
    return `
      <g opacity="${opacity}">
        <polygon
          points="${x},${y + h - 1} ${x - h + 1},${y - h + 1} ${x + h - 1},${y - h + 1}"
          fill="${color}"
          stroke="#ffffff"
          stroke-width="1"
        />
        <line
          x1="${x}"
          y1="${y - h}"
          x2="${x}"
          y2="${y + h}"
          stroke="${color}"
          stroke-width="2"
        />
      </g>
    `;
  }

  default:
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" fill-opacity="${opacity}" stroke="#ffffff" stroke-width="1.2"/>`;
}
        });
    })
    .join("");

  const mapW2 = containerRef.current?.offsetWidth ?? 900;
  const tx = titlePos.x !== null ? titlePos.x : mapW2 - 254;
  const ty = titlePos.y;
  const tw = titlePos.w ?? 240;
  const th = titlePos.h ?? 62;

  const lx = legendPos.x;
  const ly = legendPos.y ?? H - 200;
  const lw = legendPos.w ?? 200;
  const lh2 = legendItems.length * 24 + 20;

  const legendSvg =
    showLegend && legendItems.length
      ? `<g>
      <rect x="${lx}" y="${ly}" width="${lw}" height="${lh2}" fill="rgba(255,255,255,0.96)" stroke="#b8c4ce" stroke-width="1" rx="2"/>
      ${legendItems
        .map(
          (item, i) => `<g transform="translate(${lx + 10},${ly + 14 + i * 24})">
        ${
          item.type === "line"
            ? `<line x1="0" y1="8" x2="20" y2="8" stroke="${item.strokeColor || item.color}" stroke-width="2.5" ${item.dashArray ? `stroke-dasharray="${item.dashArray}"` : ""}/>`
            : item.type === "marker"
              ? `<circle cx="9" cy="9" r="7" fill="${item.color}" stroke="#333" stroke-width="1"/>`
              : item.type === "dashed-area"
                ? `<rect x="0" y="0" width="18" height="18" fill="${item.color}" fill-opacity="0.15" stroke="${item.strokeColor || item.color}" stroke-width="2" stroke-dasharray="${item.dashArray || "8,4"}"/>`
                : item.type === "rail"
                  ? `<line x1="0" y1="8" x2="20" y2="8" stroke="${item.strokeColor || item.color}" stroke-width="2.5" stroke-dasharray="${item.dashArray || "14,6,2,6"}"/>`
                  : `<rect x="0" y="0" width="18" height="18" fill="${item.color}" stroke="${item.strokeColor || item.color}" stroke-width="1.2"/>`
        }
        <text x="26" y="13" font-size="13" font-family="Arial" fill="#1a2232">${escapeXml(item.text)}</text>
      </g>`
        )
        .join("")}
    </g>`
      : "";

  const titleSvg = `<g><rect x="${tx}" y="${ty}" width="${tw}" height="${th}" fill="rgba(8,30,92,0.96)"/>
      <text x="${tx + 14}" y="${ty + 28}" font-size="18" font-family="Arial" font-weight="800" fill="#fff">${escapeXml(title)}</text>
      <text x="${tx + 14}" y="${ty + 48}" font-size="11" font-family="Arial" fill="rgba(255,255,255,0.8)">${escapeXml(subtitle)}</text>
    </g>`;

  const textSvg = textEls
    .map((t) => {
      const lines = String(t.text || "").split(/\n/);
      return `<text x="${t.x + 4}" y="${t.y + 18}" font-size="${t.size}" font-family="Arial" font-weight="${t.bold ? "700" : "400"}" fill="${t.color}">${lines
        .map(
          (line, i) =>
            `<tspan x="${t.x + 4}" dy="${i === 0 ? 0 : t.size * 1.15}">${escapeXml(line)}</tspan>`
        )
        .join("")}</text>`;
    })
    .join("");

  const calloutSvg = callouts
    .map((c) => {
      const lines = c.text.replace(/\\n/g, "\n").split("\n");
      const bw = c.w ?? Math.max(120, Math.max(...lines.map((l) => l.length)) * 7.5 + 24);
      const bh = c.h ?? lines.length * 18 + 14;
      return `<g><line x1="${c.pinX}" y1="${c.pinY}" x2="${c.boxX + bw / 2}" y2="${c.boxY + bh}" stroke="${c.borderColor}" stroke-width="1.5" stroke-dasharray="5,3"/>
        <circle cx="${c.pinX}" cy="${c.pinY}" r="5" fill="${c.borderColor}"/>
        <rect x="${c.boxX}" y="${c.boxY}" width="${bw}" height="${bh}" rx="3" fill="${c.fillColor}" stroke="${c.borderColor}" stroke-width="1.5"/>
        ${lines
          .map(
            (line, i) =>
              `<text x="${c.boxX + 12}" y="${c.boxY + 20 + i * 18}" font-size="13" font-family="Arial" font-weight="${i === 0 ? "700" : "400"}" fill="${c.textColor}">${escapeXml(line)}</text>`
          )
          .join("")}
      </g>`;
    })
    .join("");

  const curveSvg = curvedLabels
    .map((cl) => {
      try {
        const p1 = map.latLngToContainerPoint(cl.p1);
        const p2 = map.latLngToContainerPoint(cl.p2);
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const nx = -dy * 0.18;
        const ny = dx * 0.18;
        const pid = `curve-${cl.id}`;
        return `
          <defs>
            <path id="${pid}" d="M ${p1.x} ${p1.y} Q ${mx + nx} ${my + ny} ${p2.x} ${p2.y}" />
          </defs>
          <text font-size="${cl.size}" font-family="Arial" font-weight="700" fill="${cl.color}">
            <textPath href="#${pid}" startOffset="50%" text-anchor="middle">${escapeXml(cl.text)}</textPath>
          </text>
        `;
      } catch {
        return "";
      }
    })
    .join("");

  const naSvg = northArrow
    ? `<g transform="translate(20,20)">
        <circle cx="20" cy="20" r="18" fill="rgba(255,255,255,0.85)" stroke="#111" stroke-width="1.2"/>
        <polygon points="20,2 27,22 20,17 13,22" fill="#111"/>
        <polygon points="20,38 27,18 20,23 13,18" fill="#eee" stroke="#111" stroke-width="0.8"/>
        <text x="20" y="50" text-anchor="middle" font-size="10" font-weight="bold" fill="#111" font-family="Arial">N</text>
      </g>`
    : "";

  const logoSvg = logo
    ? `<image href="${logo}" x="${logoPos.x}" y="${logoPos.y}" width="${logoPos.w}" height="${logoPos.h}"/>`
    : "";

  const insetX2 = insetPos.x !== null ? insetPos.x : mapW2 - 208;
  const insetSvg =
    showInset && insetImage
      ? `<image href="${insetImage}" x="${insetX2}" y="${insetPos.y}" width="${insetPos.w}" height="${insetPos.h}"/>`
      : "";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#e8e8e8"/>
  <g id="vectors">${overlayContent}</g>
  <g id="point-layers">${pointLayerSvg}</g>
  <g id="labels">${tooltipSvg.join("")}</g>
  <g id="curved-text">${curveSvg}</g>
  <g id="callouts">${calloutSvg}</g>
  <g id="text-elements">${textSvg}</g>
  <g id="title">${titleSvg}</g>
  <g id="logo">${logoSvg}</g>
  <g id="inset">${insetSvg}</g>
  <g id="legend">${legendSvg}</g>
  <g id="north-arrow">${naSvg}</g>
</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.toLowerCase().replace(/\s+/g, "-")}-map.svg`;
  a.click();
  URL.revokeObjectURL(a.href);
};

  // ── Curved text renderer ──────────────────────────────────────────────────
  const renderCurvedLabels=()=>{
    const map=mapRef.current;if(!map||!curvedLabels.length)return null;
    return(
      <svg style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:1000}}>
        {curvedLabels.map(cl=>{
          try{
            const p1=map.latLngToContainerPoint(cl.p1), p2=map.latLngToContainerPoint(cl.p2);
            const mx=(p1.x+p2.x)/2, my=(p1.y+p2.y)/2, dx=p2.x-p1.x, dy=p2.y-p1.y;
            const pid=`cvp-${cl.id}`;
            return(
              <g key={cl.id}>
                <defs><path id={pid} d={`M ${p1.x} ${p1.y} Q ${mx-dy*0.25} ${my+dx*0.25} ${p2.x} ${p2.y}`}/></defs>
                <text fill={cl.color} fontSize={cl.size} fontFamily="Arial" fontWeight="700" letterSpacing="2">
                  <textPath href={`#${pid}`} startOffset="50%" textAnchor="middle">{cl.text}</textPath>
                </text>
              </g>
            );
          }catch{return null;}
        })}
      </svg>
    );
  };

  const mapW=containerRef.current?.offsetWidth??900;
  const mapH=containerRef.current?.offsetHeight??800;
  const titleX=titlePos.x!==null?titlePos.x:mapW-254;
  const insetX=insetPos.x!==null?insetPos.x:mapW-208;

  const snapElements=[
    {id:"title",x:titleX,y:titlePos.y,w:titlePos.w??240,h:titlePos.h??62},
    {id:"logo",x:logoPos.x,y:logoPos.y,w:logoPos.w,h:logoPos.h},
    {id:"inset",x:insetX,y:insetPos.y,w:insetPos.w,h:insetPos.h},
    {id:"legend",x:legendPos.x,y:legendPos.y??(mapH-200),w:legendPos.w??200,h:legendPos.h??100},
    ...textEls.map(t=>({id:t.id,x:t.x,y:t.y,w:t.w,h:t.h})),
    ...callouts.map(c=>({id:c.id,x:c.boxX,y:c.boxY,w:c.w??120,h:c.h??40})),
    ...canvasImages.map(o=>({id:o.id,x:o.px,y:o.py,w:o.pw,h:o.ph})),
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return(
    <div className="app-shell" onClick={()=>setSelectedId(null)}>
      <aside className="sidebar">
        <div className="sidebar-header"><span className="app-wordmark">◈ Mapviewer</span></div>

        <Sec title="Import GIS Data">
          <label className="file-drop">
            <input type="file" accept=".zip,.geojson,.json,.csv" onChange={e=>handleFile(e.target.files?.[0])}/>
            <span className="file-drop-hint">Click or drop · <small>.zip .geojson .json .csv</small></span>
          </label>
        </Sec>

        <Sec title="Map Labels">
          <Field label="Title"><input value={title} onChange={e=>setTitle(e.target.value)}/></Field>
          <Field label="Subtitle"><input value={subtitle} onChange={e=>setSubtitle(e.target.value)}/></Field>
          <div className="hint-text">Drag &amp; resize title block on map</div>
        </Sec>

        <Sec title="Branding">
          <Field label="Logo"><input type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&loadImageFile(e.target.files[0],setLogo)}/></Field>
          {logo&&<button className="btn-ghost" onClick={()=>setLogo(null)}>✕ Remove logo</button>}
        </Sec>

        <Sec title="Basemap">
          <div className="row2">
            <button className="btn" onClick={()=>switchBase("sat")}>🛰 Satellite</button>
            <button className="btn" onClick={()=>switchBase("osm")}>🗺 Street</button>
          </div>
        </Sec>

        <Sec title="Overlays">
          <Toggle label="North Arrow" checked={northArrow} onChange={setNorthArrow}/>
          <Toggle label="Legend"      checked={showLegend} onChange={setShowLegend}/>
          <Toggle label="Inset Map"   checked={showInset}  onChange={setShowInset}/>
          {showInset&&<div style={{marginTop:8}}>
            <div className="field-label">Upload inset image</div>
            <input type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&loadImageFile(e.target.files[0],setInsetImage)}/>
            {insetImage&&<button className="btn-ghost" onClick={()=>setInsetImage(null)}>✕ Remove</button>}
          </div>}
        </Sec>

        <Sec title="Image Overlay">
          <Field label="Upload image (PNG/JPG)">
            <input type="file" accept="image/*" onChange={e=>{
              const f=e.target.files?.[0]; if(!f)return;
              loadImageFile(f,src=>{
                const cw=containerRef.current?.offsetWidth??900, ch=containerRef.current?.offsetHeight??700;
                setCanvasImages(p=>[...p,{id:crypto.randomUUID(),name:f.name,src,px:cw/2-150,py:ch/2-100,pw:300,ph:200,opacity:0.8,visible:true}]);
              });
            }}/>
          </Field>
          <div className="hint-text">Drag &amp; resize on map. Click to select, Delete key to remove.</div>
          {canvasImages.map(o=>(
            <div key={o.id} className="overlay-row">
              <span className="overlay-name">{o.name}</span>
              <input type="range" min="0" max="1" step="0.05" value={o.opacity} onChange={e=>setCanvasImages(p=>p.map(x=>x.id===o.id?{...x,opacity:+e.target.value}:x))} style={{flex:1}}/>
              <button className="btn-icon-sm" onClick={()=>setCanvasImages(p=>p.map(x=>x.id===o.id?{...x,visible:!x.visible}:x))}>{o.visible?"👁":"🚫"}</button>
              <button className="btn-icon-sm" onClick={()=>setCanvasImages(p=>p.filter(x=>x.id!==o.id))}>✕</button>
            </div>
          ))}
        </Sec>

        <Sec title="Draw on Map">
          <div className="draw-grid">
            {[{m:"none",label:"✋",tip:"Off"},{m:"circle",label:"⬤",tip:"Circle"},{m:"rectangle",label:"▬",tip:"Rect"},{m:"polygon",label:"⬠",tip:"Poly"},{m:"line",label:"╱",tip:"Line"}].map(({m,label,tip})=>(
              <button key={m} title={tip} className={`btn draw-btn${drawMode===m?" draw-active":""}`}
                onClick={()=>{setDrawMode(m);drawRef.current={points:[],preview:null,center:null};setDrawActive(false);}}>
                <span>{label}</span><span className="draw-btn-label">{tip}</span>
              </button>
            ))}
          </div>
          {drawMode!=="none"&&<div className="draw-hint">
            {drawMode==="circle"&&(!drawRef.current.points.length?"Click center point":"Move to size, click to finish")}
            {drawMode==="rectangle"&&(!drawRef.current.points.length?"Click first corner":"Click opposite corner")}
            {(drawMode==="polygon"||drawMode==="line")&&(drawActive?"Double-click to finish":"Click to start")}
            {" · "}<span style={{color:"#7cc67c"}}>Esc=cancel</span>
          </div>}
          <div className="color-trio" style={{marginTop:8}}>
            <div><div className="field-label">Stroke</div><input type="color" value={drawStyle.color} onChange={e=>setDrawStyle(s=>({...s,color:e.target.value}))}/></div>
            <div><div className="field-label">Fill</div><input type="color" value={drawStyle.fill} onChange={e=>setDrawStyle(s=>({...s,fill:e.target.value}))}/></div>
            <div><div className="field-label">Opacity</div><input type="range" min="0" max="1" step="0.05" value={drawStyle.opacity} onChange={e=>setDrawStyle(s=>({...s,opacity:+e.target.value}))}/></div>
          </div>
        </Sec>

        <Sec title="Text">
          <Field label="Content"><input placeholder="Add text…" value={textDraft.text} onChange={e=>setTextDraft(d=>({...d,text:e.target.value}))}/></Field>
          <div className="color-trio">
            <div><div className="field-label">Color</div><input type="color" value={textDraft.color} onChange={e=>setTextDraft(d=>({...d,color:e.target.value}))}/></div>
            <div><div className="field-label">Size ({textDraft.size}px)</div><input type="range" min="10" max="64" value={textDraft.size} onChange={e=>setTextDraft(d=>({...d,size:+e.target.value}))}/></div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}><div className="field-label">Bold</div><input type="checkbox" checked={textDraft.bold} onChange={e=>setTextDraft(d=>({...d,bold:e.target.checked}))} style={{width:18,height:18}}/></div>
          </div>
          <button className={`btn mt-8 w100${placing==="text"?" btn-placing":""}`} onClick={()=>setPlacing(placing==="text"?null:"text")}>
            {placing==="text"?"🎯 Click map to place…":"＋ Place Text"}
          </button>
          <div className="hint-text">Double-click to edit inline · Delete key removes selected</div>
          {textEls.map(t=>(
            <div key={t.id} className="annot-row">
              <span style={{fontSize:11,color:t.color,fontWeight:t.bold?"bold":"normal",flexShrink:0,width:14}}>T</span>
              <input value={t.text} onChange={e=>setTextEls(p=>p.map(x=>x.id===t.id?{...x,text:e.target.value}:x))}/>
              <button className="btn-icon-sm" onClick={()=>setTextEls(p=>p.filter(x=>x.id!==t.id))}>✕</button>
            </div>
          ))}
        </Sec>

        <Sec title="Callout Box">
          <Field label="Text (\\n = new line)"><input placeholder="NEC11-004\n236m @ 2.10% REO" value={calloutDraft.text} onChange={e=>setCalloutDraft(d=>({...d,text:e.target.value}))}/></Field>
          <div className="color-trio">
            <div><div className="field-label">Background</div><input type="color" value={calloutDraft.bgColor} onChange={e=>setCalloutDraft(d=>({...d,bgColor:e.target.value}))}/></div>
            <div><div className="field-label">Border/Text</div><input type="color" value={calloutDraft.borderColor} onChange={e=>setCalloutDraft(d=>({...d,borderColor:e.target.value}))}/></div>
          </div>
          <button className={`btn mt-8 w100${placing==="callout"?" btn-placing":""}`} onClick={()=>setPlacing(placing==="callout"?null:"callout")}>
            {placing==="callout"?"🎯 Click pin location…":"＋ Place Callout"}
          </button>
          <div className="hint-text">Double-click box to edit · Drag pin &amp; box separately · Delete to remove</div>
          {callouts.map(c=>(
            <div key={c.id} className="annot-row">
              <span className="annot-swatch" style={{background:c.borderColor,borderRadius:0}}/>
              <input value={c.text} onChange={e=>setCallouts(p=>p.map(x=>x.id===c.id?{...x,text:e.target.value}:x))}/>
              <button className="btn-icon-sm" onClick={()=>setCallouts(p=>p.filter(x=>x.id!==c.id))}>✕</button>
            </div>
          ))}
        </Sec>

        <Sec title="Curved Text">
          <Field label="Text"><input placeholder="Elk Creek Carbonatite Complex" value={curvedDraft.text} onChange={e=>setCurvedDraft(d=>({...d,text:e.target.value}))}/></Field>
          <div className="color-trio">
            <div><div className="field-label">Color</div><input type="color" value={curvedDraft.color} onChange={e=>setCurvedDraft(d=>({...d,color:e.target.value}))}/></div>
            <div><div className="field-label">Size ({curvedDraft.size}px)</div><input type="range" min="10" max="52" value={curvedDraft.size} onChange={e=>setCurvedDraft(d=>({...d,size:+e.target.value}))}/></div>
          </div>
          <button className={`btn mt-8 w100${curvedStep?" btn-placing":""}`}
            onClick={()=>{if(!curvedDraft.text.trim()){alert("Enter text first");return;}setCurvedStep(curvedStep?null:"p1");}}>
            {curvedStep==="p1"?"🎯 Click start point…":curvedStep==="p2"?"🎯 Click end point…":"＋ Place Curved Text"}
          </button>
          {curvedLabels.map(cl=>(
            <div key={cl.id} className="annot-row">
              <span style={{fontSize:11,color:cl.color,fontWeight:700,flexShrink:0,width:14}}>A</span>
              <input value={cl.text} onChange={e=>setCurvedLabels(p=>p.map(x=>x.id===cl.id?{...x,text:e.target.value}:x))}/>
              <input type="range" min="10" max="52" value={cl.size} onChange={e=>setCurvedLabels(p=>p.map(x=>x.id===cl.id?{...x,size:+e.target.value}:x))} style={{width:60}}/>
              <button className="btn-icon-sm" onClick={()=>setCurvedLabels(p=>p.filter(x=>x.id!==cl.id))}>✕</button>
            </div>
          ))}
        </Sec>

        <Sec title="Legend Editor">
          <div className="hint-text" style={{marginBottom:6}}>Drag &amp; resize legend on map</div>
          <div className="legend-editor-row">
            <input placeholder="Label" value={legendDraft.text} onChange={e=>setLegendDraft(d=>({...d,text:e.target.value}))} style={{flex:2}}/>
            <select value={legendDraft.type} onChange={e=>setLegendDraft(d=>({...d,type:e.target.value}))} style={{flex:1}}>
              <option value="swatch">■ Fill</option>
              <option value="marker">● Marker</option>
              <option value="line">― Line</option>
            </select>
            <input type="color" value={legendDraft.color} onChange={e=>setLegendDraft(d=>({...d,color:e.target.value}))}/>
          </div>
          {legendDraft.type==="marker"&&<select value={legendDraft.markerType} onChange={e=>setLegendDraft(d=>({...d,markerType:e.target.value}))} style={{marginTop:4}}>
            {MARKER_TYPES.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
          </select>}
          <button className="btn mt-6 w100" onClick={()=>{if(!legendDraft.text.trim())return;setLegendItems(p=>[...p,{id:crypto.randomUUID(),...legendDraft}]);setLegendDraft(d=>({...d,text:""}));}}>＋ Add Entry</button>
          {legendItems.map((item,i)=>(
            <div key={item.id} className="legend-edit-row">
              <LegendSymbol item={item}/>
              <span style={{flex:1,fontSize:11,color:"#c8d3e8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.text}</span>
              <button className="btn-order" onClick={()=>setLegendItems(p=>{const n=[...p];if(i>0)[n[i],n[i-1]]=[n[i-1],n[i]];return n;})}>▲</button>
              <button className="btn-order" onClick={()=>setLegendItems(p=>{const n=[...p];if(i<n.length-1)[n[i],n[i+1]]=[n[i+1],n[i]];return n;})}>▼</button>
              <button className="btn-icon-sm" onClick={()=>setLegendItems(p=>p.filter(x=>x.id!==item.id))}>✕</button>
            </div>
          ))}
          {layers.filter(l=>l.includeInLegend).length>0&&<button className="btn-ghost" style={{marginTop:6}} onClick={buildLegendFromLayers}>↺ Build from legend-enabled layers</button>}
        </Sec>

        <Sec title="Groups">
          <div className="hint-text" style={{marginBottom:6}}>Click element on map to select, then create group</div>
          <button className="btn w100" disabled={!selectedId} onClick={()=>{
            if(!selectedId)return;
            setGroups(g=>[...g,{id:crypto.randomUUID(),memberIds:[selectedId]}]);
          }}>＋ New Group from Selected</button>
          {groups.map(gr=>(
            <div key={gr.id} style={{marginTop:6,padding:"6px 8px",background:"#181d28",borderRadius:4,border:"1px solid #252e42"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:11,color:"#8896b0"}}>Group · {gr.memberIds.length} items</span>
                <button className="btn-ghost" onClick={()=>setGroups(g=>g.filter(x=>x.id!==gr.id))}>Ungroup</button>
              </div>
              {selectedId&&!gr.memberIds.includes(selectedId)&&(
                <button className="btn-ghost" style={{color:"#7cc67c"}} onClick={()=>setGroups(g=>g.map(x=>x.id===gr.id?{...x,memberIds:[...x.memberIds,selectedId]}:x))}>+ Add selected</button>
              )}
            </div>
          ))}
        </Sec>

        <Sec title="Project">
          <div className="row2" style={{marginBottom:6}}>
            <button className="btn" onClick={saveProject}>Save Project</button>
            <button className="btn" onClick={()=>projectInputRef.current?.click()}>Load Project</button>
          </div>
          <input ref={projectInputRef} type="file" accept=".json,.mapviewer.json" style={{display:"none"}} onChange={e=>loadProject(e.target.files?.[0])}/>
          <div className="hint-text">Saves layers, styling, labels, legend, layout, and branding as a reusable project file.</div>
        </Sec>

        <Sec title="Export">
          <button className="btn w100" onClick={fitAll} style={{marginBottom:6}}>Fit All Layers</button>
          <div className="row2" style={{marginBottom:4}}>
            <button className={`btn${exportType==="png"?" draw-active":""}`} onClick={()=>setExportType("png")}>PNG</button>
            <button className={`btn${exportType==="svg"?" draw-active":""}`} onClick={()=>setExportType("svg")}>SVG</button>
          </div>
          <Field label={`PNG export scale — ${exportScale}x`}>
            <input type="range" min="1" max="4" step="1" value={exportScale} onChange={e=>setExportScale(Number(e.target.value))}/>
          </Field>
          <button className={`btn btn-export w100${exporting?" btn-export-working":""}`}
            onClick={()=>exportType==="svg"?doExportSVG():doExportPNG()} disabled={exporting}>
            {exporting?"Exporting…":"⬇ Export"}
          </button>
          <div className="export-note">{exportType==="png"?"Street basemap recommended for PNG export. Higher scale = larger, sharper file.":"SVG = vector overlays and layout for designer editing."}</div>
        </Sec>

        <Sec title={`Layers${layers.length?` (${layers.length})`:""}`}>
          {layers.length===0?<div className="empty-hint">No layers yet.</div>
            :layers.map((l,idx)=>(
              <LayerCard key={l.id} l={l} idx={idx} total={layers.length}
                onUpdate={p=>updateLayer(l.id,p)} onToggle={()=>toggleLayer(l.id)} onApplyPreset={preset=>updateLayer(l.id, applyPresetToLayer(l, preset))}
                onRemove={()=>removeLayer(l.id)} onMove={dir=>moveLayer(l.id,dir)}/>
            ))
          }
        </Sec>
      </aside>

      {/* MAP SURFACE */}
      <div className="map-side export-surface" ref={containerRef} onClick={()=>setSelectedId(null)}>
        <div id="map" style={{width:"100%",height:"100%"}}/>
        {renderCurvedLabels()}
        <SnapGrid active={draggingAny} containerRef={containerRef}/>

        {/* Canvas image overlays */}
        {canvasImages.filter(o=>o.visible!==false).map(o=>(
          <CanvasImageOverlay key={o.id} ov={o}
            onChange={patch=>setCanvasImages(p=>p.map(x=>x.id===o.id?{...x,...patch}:x))}
            onDragStart={()=>setDraggingAny(true)} onDragEnd={()=>setDraggingAny(false)}
            selected={selectedId===o.id} onSelect={setSelectedId}
            snapElements={snapElements} containerW={mapW} containerH={mapH}/>
        ))}

        {/* Callout boxes */}
        {callouts.map(c=>(
          <CalloutBox key={c.id} c={c}
            onChange={patch=>setCallouts(p=>p.map(x=>x.id===c.id?{...x,...patch}:x))}
            onDragStart={()=>setDraggingAny(true)} onDragEnd={()=>setDraggingAny(false)}
            selected={selectedId===c.id} onSelect={setSelectedId}
            snapElements={snapElements} containerW={mapW} containerH={mapH}/>
        ))}

        {/* Free text elements */}
        {textEls.map(t=>(
          <TextEl key={t.id} el={t}
            onChange={patch=>setTextEls(p=>p.map(x=>x.id===t.id?{...x,...patch}:x))}
            onDragStart={()=>setDraggingAny(true)} onDragEnd={()=>setDraggingAny(false)}
            selected={selectedId===t.id} onSelect={setSelectedId}
            snapElements={snapElements} containerW={mapW} containerH={mapH}/>
        ))}

        {/* Resizable title */}
        <ResizableDraggable id="title" x={titleX} y={titlePos.y} w={titlePos.w??240} h={titlePos.h??62}
          onMove={p=>setTitlePos(prev=>({...prev,...p}))} onResize={p=>setTitlePos(prev=>({...prev,...p}))}
          onDragStart={()=>setDraggingAny(true)} onDragEnd={()=>setDraggingAny(false)}
          snapElements={snapElements} containerW={mapW} containerH={mapH}
          zIndex={selectedId==="title"?1010:1001}>
          <div className="title-block" style={{width:"100%",height:"100%",overflow:"hidden"}} onClick={e=>{e.stopPropagation();setSelectedId("title");}}>
            <div className="title-main">{title}</div>
            <div className="title-sub">{subtitle}</div>
          </div>
        </ResizableDraggable>

        {/* Resizable logo */}
        {logo&&(
          <ResizableDraggable id="logo" x={logoPos.x} y={logoPos.y} w={logoPos.w} h={logoPos.h}
            onMove={p=>setLogoPos(prev=>({...prev,...p}))} onResize={p=>setLogoPos(prev=>({...prev,...p}))}
            onDragStart={()=>setDraggingAny(true)} onDragEnd={()=>setDraggingAny(false)}
            snapElements={snapElements} containerW={mapW} containerH={mapH}
            zIndex={selectedId==="logo"?1010:1001}>
            <img src={logo} alt="Logo" style={{width:"100%",height:"100%",objectFit:"contain",display:"block",pointerEvents:"none"}}
              onClick={e=>{e.stopPropagation();setSelectedId("logo");}}/>
          </ResizableDraggable>
        )}

        {/* North arrow */}
        {northArrow&&<div className="north-arrow">
          <svg viewBox="0 0 40 58" width="36" height="52">
            <polygon points="20,2 27,28 20,23 13,28" fill="#111"/>
            <polygon points="20,54 27,28 20,33 13,28" fill="#eee" stroke="#111" strokeWidth="0.8"/>
            <text x="20" y="53" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#111" fontFamily="Arial">N</text>
          </svg>
        </div>}

        {/* Resizable inset */}
        {showInset&&(
          <ResizableDraggable id="inset" x={insetX} y={insetPos.y} w={insetPos.w} h={insetPos.h}
            onMove={p=>setInsetPos(prev=>({...prev,...p}))} onResize={p=>setInsetPos(prev=>({...prev,...p}))}
            onDragStart={()=>setDraggingAny(true)} onDragEnd={()=>setDraggingAny(false)}
            snapElements={snapElements} containerW={mapW} containerH={mapH}
            zIndex={selectedId==="inset"?1010:1001}>
            <div className="inset-wrap" style={{width:"100%",height:"100%"}} onClick={e=>{e.stopPropagation();setSelectedId("inset");}}>
              {insetImage?<img src={insetImage} alt="Inset" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                :<div className="inset-empty"><span>Upload inset image in sidebar</span></div>}
            </div>
          </ResizableDraggable>
        )}

        {/* Resizable legend */}
        {showLegend&&legendItems.length>0&&(
          <ResizableDraggable id="legend"
            x={legendPos.x} y={legendPos.y??Math.max((containerRef.current?.offsetHeight??600)-200,20)}
            w={legendPos.w??200} h={legendPos.h??Math.max(60,legendItems.length*24+20)}
            onMove={p=>setLegendPos(prev=>({...prev,...p}))} onResize={p=>setLegendPos(prev=>({...prev,...p}))}
            onDragStart={()=>setDraggingAny(true)} onDragEnd={()=>setDraggingAny(false)}
            snapElements={snapElements} containerW={mapW} containerH={mapH}
            zIndex={selectedId==="legend"?1010:1001}>
            <div className="legend-block" style={{width:"100%",height:"100%",overflow:"auto"}} onClick={e=>{e.stopPropagation();setSelectedId("legend");}}>
              {legendItems.map(item=>(
                <div key={item.id} className="legend-row"><LegendSymbol item={item}/><span>{item.text}</span></div>
              ))}
            </div>
          </ResizableDraggable>
        )}
      </div>
    </div>
  );
}

// ─── Legend symbol ────────────────────────────────────────────────────────────
function LegendSymbol({item}){
  if(item.type==="marker") return <img src={markerSvgUrl(item.markerType,item.color,16)} width="16" height="16" style={{flexShrink:0}} alt=""/>;
  if(item.type==="rail") return <svg width="24" height="16" style={{flexShrink:0}}><line x1="0" y1="8" x2="24" y2="8" stroke={item.strokeColor||item.color} strokeWidth="2.5" strokeDasharray={item.dashArray||"14,6,2,6"}/></svg>;
  if(item.type==="line")   return <svg width="24" height="16" style={{flexShrink:0}}><line x1="0" y1="8" x2="24" y2="8" stroke={item.strokeColor||item.color} strokeWidth="2.5" strokeDasharray={item.dashArray||undefined}/></svg>;
  if(item.type==="dashed-area") return <svg width="24" height="18" style={{flexShrink:0}}><rect x="2" y="2" width="20" height="14" fill={item.color} fillOpacity="0.15" stroke={item.strokeColor||item.color} strokeWidth="2" strokeDasharray={item.dashArray||"8,4"}/></svg>;
  return <span className="legend-swatch" style={{background:item.color, border:`1.5px solid ${item.strokeColor||item.color}`}}/>;
}

function Sec({title,children}){return <div className="sec"><div className="sec-title">{title}</div>{children}</div>;}
function Field({label,children}){return <div className="field"><div className="field-label">{label}</div>{children}</div>;}
function Toggle({label,checked,onChange}){
  return(<label className="toggle-row" onClick={()=>onChange(!checked)}>
    <span className={`toggle-track${checked?" on":""}`}><span className="toggle-thumb"/></span>
    <span>{label}</span>
  </label>);
}

function LayerCard({l,idx,total,onUpdate,onToggle,onRemove,onMove,onApplyPreset}){
  const[open,setOpen]=useState(false);
  return(
    <div className="layer-card">
      <div className="layer-card-header">
        <div className="layer-order-btns">
          <button className="btn-order" onClick={()=>onMove(-1)} disabled={idx===0}>▲</button>
          <button className="btn-order" onClick={()=>onMove(1)}  disabled={idx===total-1}>▼</button>
        </div>
        <button className="btn-chevron" onClick={()=>setOpen(o=>!o)}>{open?"▾":"▸"}</button>
        <span className="layer-card-name" title={l.name}>{l.name}</span>
        <button className="btn-icon-sm" onClick={onToggle}>{l.visible?"👁":"🚫"}</button>
        <button className="btn-icon-sm" onClick={onRemove}>✕</button>
      </div>
      {open&&(
        <div className="layer-card-body">
          <Field label="Legend label"><input value={l.legendLabel} onChange={e=>onUpdate({legendLabel:e.target.value})}/></Field>
          <Field label={`Opacity — ${Math.round(+l.layerOpacity*100)}%`}>
            <input type="range" min="0" max="1" step="0.05" value={l.layerOpacity} onChange={e=>onUpdate({layerOpacity:e.target.value})}/>
          </Field>
          <Field label="Style preset">
            <select value={l.preset||""} onChange={e=>onApplyPreset?.(e.target.value)}>
              <option value="">Custom</option>
              {LAYER_PRESETS.map(preset=><option key={preset.value} value={preset.value}>{preset.label}</option>)}
            </select>
          </Field>
          <div className="color-trio">
            <div><div className="field-label">Stroke</div><input type="color" value={l.color} onChange={e=>onUpdate({color:e.target.value})}/></div>
            <div><div className="field-label">Fill</div><input type="color" value={l.fillColor} onChange={e=>onUpdate({fillColor:e.target.value})}/></div>
            {l.isPoint&&<div><div className="field-label">Marker</div><input type="color" value={l.markerColor} onChange={e=>onUpdate({markerColor:e.target.value})}/></div>}
          </div>
          {!l.isDrawn&&<Field label="Fill pattern">
            <select value={l.fillPattern} onChange={e=>onUpdate({fillPattern:e.target.value})}>
              {FILL_PATTERNS.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>}
          <Field label={`Fill opacity — ${Math.round(+l.fillOpacity*100)}%`}>
            <input type="range" min="0" max="1" step="0.05" value={l.fillOpacity} onChange={e=>onUpdate({fillOpacity:e.target.value})}/>
          </Field>
          <Field label={`Line weight — ${l.weight}px`}>
            <input type="range" min="1" max="10" step="1" value={l.weight} onChange={e=>onUpdate({weight:e.target.value})}/>
          </Field>
          <Field label="Dash pattern">
            <input placeholder="e.g. 10,6" value={l.dashArray||""} onChange={e=>onUpdate({dashArray:e.target.value,preset:""})}/>
          </Field>
          {l.isPoint&&<>
            <Field label="Marker type">
              <select value={l.markerType} onChange={e=>onUpdate({markerType:e.target.value})}>
                {MARKER_TYPES.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label={`Marker size — ${+l.pointRadius*2}px`}>
              <input type="range" min="2" max="20" step="1" value={l.pointRadius} onChange={e=>onUpdate({pointRadius:e.target.value})}/>
            </Field>
            <div className="label-section">
              <Toggle label="Show feature labels" checked={l.showLabels} onChange={v=>onUpdate({showLabels:v})}/>
              {l.showLabels&&l.propKeys.length>0&&<Field label="Label field">
                <select value={l.labelField} onChange={e=>onUpdate({labelField:e.target.value})}>
                  {l.propKeys.map(k=><option key={k} value={k}>{k}</option>)}
                </select>
              </Field>}
            </div>
          </>}
          <Field label="Legend symbol">
            <select value={l.legendSymbol||"swatch"} onChange={e=>onUpdate({legendSymbol:e.target.value,preset:""})}>
              <option value="swatch">Swatch</option>
              <option value="line">Line</option>
              <option value="marker">Marker</option>
              <option value="dashed-area">Dashed area</option>
              <option value="rail">Rail</option>
            </select>
          </Field>
          <Toggle label="Include in legend" checked={l.includeInLegend} onChange={v=>onUpdate({includeInLegend:v})}/>
        </div>
      )}
    </div>
  );
}
