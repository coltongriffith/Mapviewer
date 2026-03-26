import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import shp from "shpjs";

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

// ─── Snap grid values ─────────────────────────────────────────────────────────
const SNAP_LINES = [0.25, 0.33, 0.5, 0.66, 0.75]; // fractions of container

// ─── Marker icon factory ──────────────────────────────────────────────────────
function makeMarkerIcon(type, color, size = 14) {
  const s = size, h = s / 2;
  let inner = "";
  if      (type==="circle")    inner = `<circle cx="${h}" cy="${h}" r="${h-1}" fill="${color}" stroke="#fff" stroke-width="1.2"/>`;
  else if (type==="drillhole") inner = `<polygon points="${h},${s-1} 1,1 ${s-1},1" fill="${color}" stroke="#fff" stroke-width="1"/><line x1="${h}" y1="0" x2="${h}" y2="${s}" stroke="${color}" stroke-width="2"/>`;
  else if (type==="diamond")   inner = `<polygon points="${h},1 ${s-1},${h} ${h},${s-1} 1,${h}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
  else if (type==="square")    inner = `<rect x="2" y="2" width="${s-4}" height="${s-4}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
  else if (type==="triangle")  inner = `<polygon points="${h},1 ${s-1},${s-1} 1,${s-1}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${inner}</svg>`)}`,
    iconSize:[s,s], iconAnchor:[h,h], popupAnchor:[0,-h-2],
  });
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
    const parts = line.split(","); const props = {};
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

// Convert circle to editable polygon (N-point blob)
function circleToPolygon(center, radius, n=24) {
  return Array.from({length:n}, (_,i) => {
    const angle = (2*Math.PI*i/n) - Math.PI/2;
    const lat = center.lat + (radius/111320) * Math.cos(angle);
    const lng = center.lng + (radius/(111320*Math.cos(center.lat*Math.PI/180))) * Math.sin(angle);
    return L.latLng(lat, lng);
  });
}

// Inject SVG patterns into Leaflet overlay SVG
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

// ─── Draggable wrapper — stops propagation to Leaflet ─────────────────────────
function DraggableEl({ x, y, onMove, children, style={}, className="" }) {
  const ref = useRef({ dragging:false });
  const onMouseDown = useCallback((e) => {
    if (e.button!==0) return;
    e.stopPropagation(); e.preventDefault();
    const ox=e.clientX-x, oy=e.clientY-y;
    ref.current.dragging=true;
    const mv=(ev)=>onMove({ x:ev.clientX-ox, y:ev.clientY-oy });
    const up=()=>{ ref.current.dragging=false; window.removeEventListener("mousemove",mv); window.removeEventListener("mouseup",up); };
    window.addEventListener("mousemove",mv); window.addEventListener("mouseup",up);
  },[x,y,onMove]);

  return (
    <div className={`drag-el ${className}`} style={{position:"absolute",left:x,top:y,zIndex:1001,cursor:"move",userSelect:"none",...style}} onMouseDown={onMouseDown}>
      {children}
    </div>
  );
}

// ─── Snap grid overlay ────────────────────────────────────────────────────────
function SnapGrid({ active, containerRef }) {
  if (!active || !containerRef.current) return null;
  const W = containerRef.current.offsetWidth;
  const H = containerRef.current.offsetHeight;
  return (
    <svg style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:2000}} xmlns="http://www.w3.org/2000/svg">
      {SNAP_LINES.map(f=>(
        <g key={f}>
          <line x1={W*f} y1={0} x2={W*f} y2={H} stroke="rgba(100,180,255,0.35)" strokeWidth="1" strokeDasharray="4,4"/>
          <line x1={0} y1={H*f} x2={W} y2={H*f} stroke="rgba(100,180,255,0.35)" strokeWidth="1" strokeDasharray="4,4"/>
        </g>
      ))}
      {/* Center cross */}
      <line x1={W/2} y1={0} x2={W/2} y2={H} stroke="rgba(100,200,255,0.55)" strokeWidth="1"/>
      <line x1={0} y1={H/2} x2={W} y2={H/2} stroke="rgba(100,200,255,0.55)" strokeWidth="1"/>
    </svg>
  );
}

// ─── Callout box with draggable pin AND box ───────────────────────────────────
function CalloutBox({ c, onChange }) {
  const lines = c.text.replace(/\\n/g,"\n").split("\n");
  const charW = 7.5;
  const w = Math.max(80, Math.max(...lines.map(l=>l.length))*charW+24);
  const h = lines.length*18+14;

  const startDrag=(e, which)=>{
    if(e.button!==0) return;
    e.stopPropagation(); e.preventDefault();
    const key = which==="pin" ? { ox:c.pinX, oy:c.pinY } : { ox:c.boxX, oy:c.boxY };
    const sx=e.clientX, sy=e.clientY;
    const mv=(ev)=>{
      const dx=ev.clientX-sx, dy=ev.clientY-sy;
      if(which==="pin") onChange({pinX:key.ox+dx, pinY:key.oy+dy});
      else onChange({boxX:key.ox+dx, boxY:key.oy+dy});
    };
    const up=()=>{ window.removeEventListener("mousemove",mv); window.removeEventListener("mouseup",up); };
    window.addEventListener("mousemove",mv); window.addEventListener("mouseup",up);
  };

  return (
    <svg style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:1002}} xmlns="http://www.w3.org/2000/svg">
      <line x1={c.pinX} y1={c.pinY} x2={c.boxX+w/2} y2={c.boxY+h} stroke={c.borderColor} strokeWidth="1.5" strokeDasharray="5,3"/>
      {/* Draggable pin */}
      <circle cx={c.pinX} cy={c.pinY} r="7" fill={c.borderColor} style={{pointerEvents:"all",cursor:"move"}} onMouseDown={e=>startDrag(e,"pin")}/>
      <circle cx={c.pinX} cy={c.pinY} r="3" fill="#fff" style={{pointerEvents:"none"}}/>
      {/* Draggable box */}
      <g style={{pointerEvents:"all",cursor:"move"}} onMouseDown={e=>startDrag(e,"box")}>
        <rect x={c.boxX} y={c.boxY} width={w} height={h} fill={c.bgColor} stroke={c.borderColor} strokeWidth="1.5" rx="3"/>
        {lines.map((line,i)=>(
          <text key={i} x={c.boxX+10} y={c.boxY+15+i*18} fontSize="12" fontFamily="Arial" fontWeight="600" fill={c.borderColor}>{line}</text>
        ))}
      </g>
    </svg>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const mapRef       = useRef(null);
  const containerRef = useRef(null);
  const drawRef      = useRef({ points:[], preview:null, center:null });

  const [layers,        setLayers]        = useState([]);
  const [title,         setTitle]         = useState("RIFT PROJECT");
  const [subtitle,      setSubtitle]      = useState("Nebraska");
  const [titlePos,      setTitlePos]      = useState({ x:null, y:18 });
  const [logo,          setLogo]          = useState(null);
  const [logoPos,       setLogoPos]       = useState({ x:18, y:18 });
  const [northArrow,    setNorthArrow]    = useState(true);
  const [showLegend,    setShowLegend]    = useState(true);
  const [legendPos,     setLegendPos]     = useState({ x:16, y:null });
  const [showInset,     setShowInset]     = useState(true);
  const [insetImage,    setInsetImage]    = useState(null);
  const [insetPos,      setInsetPos]      = useState({ x:null, y:80 });
  const [imageOverlays, setImageOverlays] = useState([]);
  const [pendingOverlay,setPendingOverlay]= useState(null);
  const [annotations,   setAnnotations]   = useState([]);
  const [annotDraft,    setAnnotDraft]    = useState({ text:"", color:"#0a2c78" });
  const [callouts,      setCallouts]      = useState([]);
  const [calloutDraft,  setCalloutDraft]  = useState({ text:"", bgColor:"#ffffff", borderColor:"#1a3a6b" });
  const [curvedLabels,  setCurvedLabels]  = useState([]);
  const [curvedDraft,   setCurvedDraft]   = useState({ text:"", color:"#111111", size:20 });
  const [curvedStep,    setCurvedStep]    = useState(null);
  const curvedP1Ref = useRef(null);
  const [drawMode,      setDrawMode]      = useState("none");
  const [drawStyle,     setDrawStyle]     = useState({ color:"#e63946", fill:"#e63946", opacity:0.25, weight:2 });
  const [drawActive,    setDrawActive]    = useState(false);
  const [legendItems,   setLegendItems]   = useState([]);
  const [legendDraft,   setLegendDraft]   = useState({ text:"", type:"swatch", color:"#4e8cff", markerType:"circle" });
  const [exporting,     setExporting]     = useState(false);
  const [exportType,    setExportType]    = useState("png"); // "png"|"svg"
  const [draggingAny,   setDraggingAny]   = useState(false);
  const [, tick] = useState(0); // force re-render for curved text on map move

  // Placing modes
  const [placing, setPlacing] = useState(null); // "annot"|"callout"|"overlay-p1"|"overlay-p2"

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

  // ── Re-render curved text on map move ────────────────────────────────────
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

      if(placing==="annot"){
        setAnnotations(p=>[...p,{id:crypto.randomUUID(),text:annotDraft.text||"Label",color:annotDraft.color,x:px.x,y:px.y}]);
        setPlacing(null); return;
      }
      if(placing==="callout"){
        setCallouts(p=>[...p,{id:crypto.randomUUID(),text:calloutDraft.text||"Label",bgColor:calloutDraft.bgColor,borderColor:calloutDraft.borderColor,pinX:px.x,pinY:px.y,boxX:px.x+24,boxY:px.y-64}]);
        setPlacing(null); return;
      }
      if(placing==="overlay-p1"){setPlacing({step:"overlay-p2",p1:latlng});return;}
      if(placing?.step==="overlay-p2"){
        const bounds=L.latLngBounds(placing.p1,latlng);
        const id=crypto.randomUUID();
        const ll=L.imageOverlay(pendingOverlay,bounds,{opacity:0.8,interactive:false});
        ll.addTo(map);
        setImageOverlays(p=>[...p,{id,name:"Raster overlay",src:pendingOverlay,bounds,opacity:0.8,leafLayer:ll,visible:true}]);
        setPendingOverlay(null); setPlacing(null); return;
      }
      if(curvedStep==="p1"){curvedP1Ref.current=latlng;setCurvedStep("p2");return;}
      if(curvedStep==="p2"){
        setCurvedLabels(p=>[...p,{id:crypto.randomUUID(),text:curvedDraft.text,color:curvedDraft.color,size:curvedDraft.size,p1:curvedP1Ref.current,p2:latlng}]);
        setCurvedStep(null);return;
      }
      if(drawMode==="none") return;

      if(drawMode==="circle"){
        if(!ds.points.length){ds.points=[latlng];ds.center=latlng;}
        else{
          const r=ds.center.distanceTo(latlng);
          if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
          // Convert to editable polygon instead of native circle
          const pts=circleToPolygon(ds.center,r,32);
          const poly=L.polygon(pts,{color:drawStyle.color,weight:drawStyle.weight,fill:true,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity}).addTo(map);
          commitDrawn(poly,"Circle",pts);
          ds.points=[];ds.center=null;
        }
        return;
      }
      if(drawMode==="rectangle"){
        if(!ds.points.length){ds.points=[latlng];}
        else{
          if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
          const poly=L.rectangle(L.latLngBounds(ds.points[0],latlng),{color:drawStyle.color,weight:drawStyle.weight,fill:true,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity}).addTo(map);
          commitDrawn(poly,"Rectangle",null);
          ds.points=[];
        }
        return;
      }
      if(drawMode==="polygon"||drawMode==="line"){
        ds.points.push(latlng);
        if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
        if(ds.points.length>1){
          ds.preview=(drawMode==="polygon"?L.polygon:L.polyline)(ds.points,{color:drawStyle.color,weight:drawStyle.weight,fill:drawMode==="polygon",fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity,dashArray:"6,4"}).addTo(map);
        }
        setDrawActive(true);
        return;
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
        setCurvedStep(null); setPlacing(null);
      }
    };

    map.on("click",onClick); map.on("mousemove",onMouseMove); map.on("dblclick",onDblClick);
    window.addEventListener("keydown",onKey);
    const isPlacing=placing||curvedStep||drawMode!=="none";
    map.getContainer().style.cursor=isPlacing?"crosshair":"";
    return ()=>{map.off("click",onClick);map.off("mousemove",onMouseMove);map.off("dblclick",onDblClick);window.removeEventListener("keydown",onKey);};
  },[placing,curvedStep,drawMode,drawStyle,annotDraft,calloutDraft,pendingOverlay]);

  // ── Commit drawn shape ────────────────────────────────────────────────────
  const commitDrawn=useCallback((layer,name,editablePoints)=>{
    setLayers(p=>[...p,{
      id:crypto.randomUUID(),name,layer,_geojson:null,visible:true,isPoint:false,isDrawn:true,
      editablePoints, // for blob editing
      color:drawStyle.color,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity,
      fillPattern:"solid",weight:drawStyle.weight,layerOpacity:1,
      legendLabel:name,includeInLegend:false,
      propKeys:[],showLabels:false,labelField:"",
    }]);
  },[drawStyle]);

  // ── GeoJSON layer builder ─────────────────────────────────────────────────
  const buildLeafletLayer=useCallback((geojson,cfg)=>{
    const map=mapRef.current;if(!map||!geojson) return null;
    injectSvgPatterns(map,cfg.fillColor);
    let fillStyle={};
    if(cfg.fillPattern==="none")   fillStyle={fill:false,fillOpacity:0};
    else if(cfg.fillPattern==="solid") fillStyle={fill:true,fillColor:cfg.fillColor,fillOpacity:+cfg.fillOpacity};
    else fillStyle={fill:true,fillColor:`url(#mvp-${cfg.fillPattern})`,fillOpacity:1};

    return L.geoJSON(geojson,{
      style:()=>({color:cfg.color,weight:+cfg.weight,opacity:+cfg.layerOpacity,...fillStyle}),
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

  const RERENDER=new Set(["color","fillColor","fillOpacity","fillPattern","weight","pointRadius","markerType","markerColor","layerOpacity","showLabels","labelField"]);

  const addLayer=useCallback((geojson,name)=>{
    const map=mapRef.current;if(!map)return;
    const propKeys=getPropertyKeys(geojson);
    const isPoint=isPointLayer(geojson);
    const cfg={
      id:crypto.randomUUID(),name,_geojson:geojson,visible:true,isPoint,isDrawn:false,
      color:"#4e8cff",fillColor:"#4e8cff",fillOpacity:0.35,fillPattern:"solid",
      weight:2,pointRadius:6,
      markerType:isPoint?"circle":"circle",  // default to circle/dot for drillholes
      markerColor:"#1a1a1a",
      layerOpacity:1,showLabels:false,labelField:propKeys[0]??"",
      propKeys,legendLabel:name,includeInLegend:true,
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
        item.layer?.setStyle?.({color:u.color,weight:+u.weight,fillColor:u.fillColor,fillOpacity:+u.fillOpacity,opacity:+u.layerOpacity});
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

  const updateOverlayOpacity=(id,opacity)=>{setImageOverlays(p=>p.map(o=>{if(o.id!==id)return o;o.leafLayer.setOpacity(opacity);return{...o,opacity};}));};
  const toggleOverlay=(id)=>{const map=mapRef.current;setImageOverlays(p=>p.map(o=>{if(o.id!==id)return o;if(o.visible)map.removeLayer(o.leafLayer);else o.leafLayer.addTo(map);return{...o,visible:!o.visible};}));};
  const removeOverlay=(id)=>{const map=mapRef.current;setImageOverlays(p=>{const t=p.find(o=>o.id===id);if(t)map?.removeLayer(t.leafLayer);return p.filter(o=>o.id!==id);});};

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
  };

  // ── PNG Export ────────────────────────────────────────────────────────────
  const doExportPNG=async()=>{
    setExporting(true);
    try{
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
      const sidebar=document.querySelector(".sidebar");
      const mapSide=document.querySelector(".map-side");
      sidebar.style.display="none"; mapSide.style.width="100vw";
      mapRef.current.invalidateSize();
      await new Promise(r=>setTimeout(r,600));
      await new Promise(resolve=>{
        let total=0,done=0;
        document.querySelectorAll(".leaflet-tile-container img").forEach(img=>{if(!img.complete){total++;img.addEventListener("load",()=>{done++;if(done>=total)resolve();},{once:true});img.addEventListener("error",()=>{done++;if(done>=total)resolve();},{once:true});}});
        if(!total)resolve(); setTimeout(resolve,6000);
      });
      const surface=document.querySelector(".export-surface");
      const canvas=await window.html2canvas(surface,{
        useCORS:true,allowTaint:true,scale:2,logging:false,backgroundColor:"#ffffff",imageTimeout:20000,
        onclone:(doc)=>{
          ["leaflet-map-pane","leaflet-tile-pane","leaflet-overlay-pane","leaflet-shadow-pane","leaflet-marker-pane","leaflet-tooltip-pane"].forEach(cls=>{
            doc.querySelectorAll(`.${cls}`).forEach(el=>{
              const t=el.style.transform;
              if(t){
                const m=t.match(/translate3d\(([^,]+),\s*([^,]+),/)||t.match(/translate\(([^,]+),\s*([^)]+)\)/);
                if(m){el.style.transform="none";el.style.left=(parseFloat(m[1])||0)+"px";el.style.top=(parseFloat(m[2])||0)+"px";}
              }
            });
          });
          doc.querySelectorAll(".leaflet-overlay-pane svg").forEach(el=>{el.style.visibility="visible";el.style.display="block";el.style.overflow="visible";});
        },
      });
      sidebar.style.display=""; mapSide.style.width=""; mapRef.current.invalidateSize();
      const a=document.createElement("a");
      a.download=`${title.toLowerCase().replace(/\s+/g,"-")}-map.png`;
      a.href=canvas.toDataURL("image/png"); a.click();
    }catch(err){
      console.error(err);
      const sidebar=document.querySelector(".sidebar");
      const mapSide=document.querySelector(".map-side");
      if(sidebar)sidebar.style.display=""; if(mapSide)mapSide.style.width="";
      mapRef.current?.invalidateSize();
      alert("PNG export failed. Switch to 🗺 Street basemap — satellite tiles block cross-origin capture.");
    }finally{setExporting(false);}
  };

  // ── SVG Export (vector layers + map overlays, no raster tiles) ───────────
  const doExportSVG=()=>{
    const map=mapRef.current; if(!map) return;
    const surface=document.querySelector(".export-surface");
    const W=surface.offsetWidth, H=surface.offsetHeight;

    // Grab Leaflet overlay SVG content
    const overlaySvg=map.getPanes().overlayPane?.querySelector("svg");
    let overlayContent="";
    if(overlaySvg){
      const clone=overlaySvg.cloneNode(true);
      // Remove transform, convert to absolute coords
      clone.style.transform=""; clone.removeAttribute("transform");
      overlayContent=clone.innerHTML;
    }

    // Grab marker pane (convert marker img elements to SVG circles as fallback)
    const markerPts=[];
    map.getPanes().markerPane?.querySelectorAll(".leaflet-marker-icon").forEach(img=>{
      const rect=img.getBoundingClientRect();
      const surfRect=surface.getBoundingClientRect();
      markerPts.push({x:rect.left-surfRect.left+rect.width/2, y:rect.top-surfRect.top+rect.height/2, src:img.src, w:rect.width, h:rect.height});
    });

    // Tooltip labels
    const tooltipSvg=[];
    map.getPanes().tooltipPane?.querySelectorAll(".mv-label").forEach(el=>{
      const rect=el.getBoundingClientRect(); const surfRect=surface.getBoundingClientRect();
      tooltipSvg.push(`<text x="${rect.left-surfRect.left}" y="${rect.top-surfRect.top+11}" font-size="11" font-family="Arial" font-weight="600" fill="#111">${escapeXml(el.textContent)}</text>`);
    });

    // Legend
    const legendEl=surface.querySelector(".drag-el .legend-block, .drag-el");
    let legendSvg="";
    if(showLegend&&legendItems.length){
      const lx=legendPos.x, ly=legendPos.y??H-200;
      const lh=legendItems.length*24+20;
      legendSvg=`<g>
        <rect x="${lx}" y="${ly}" width="260" height="${lh}" fill="rgba(255,255,255,0.96)" stroke="#b8c4ce" stroke-width="1" rx="2"/>
        ${legendItems.map((item,i)=>`
          <g transform="translate(${lx+10},${ly+14+i*24})">
            ${item.type==="line"?`<line x1="0" y1="8" x2="20" y2="8" stroke="${item.color}" stroke-width="2.5"/>`
              :item.type==="marker"?`<circle cx="9" cy="9" r="7" fill="${item.color}"/>`
              :`<rect x="0" y="0" width="18" height="18" fill="${item.color}"/>`}
            <text x="26" y="13" font-size="13" font-family="Arial" fill="#1a2232">${escapeXml(item.text)}</text>
          </g>`).join("")}
      </g>`;
    }

    // Title block
    const tx=titlePos.x??W-250, ty=titlePos.y;
    const titleSvg=`<g>
      <rect x="${tx}" y="${ty}" width="240" height="62" fill="rgba(8,30,92,0.96)"/>
      <text x="${tx+14}" y="${ty+28}" font-size="18" font-family="Arial" font-weight="800" fill="#fff">${escapeXml(title)}</text>
      <text x="${tx+14}" y="${ty+48}" font-size="11" font-family="Arial" fill="rgba(255,255,255,0.8)">${escapeXml(subtitle)}</text>
    </g>`;

    // Annotations
    const annotSvg=annotations.map(a=>`<g>
      <rect x="${a.x}" y="${a.y}" width="${Math.max(80,a.text.length*8+16)}" height="32" fill="${a.color}"/>
      <text x="${a.x+10}" y="${a.y+21}" font-size="13" font-family="Arial" font-weight="700" fill="#fff">${escapeXml(a.text)}</text>
    </g>`).join("");

    // Callouts
    const calloutSvg=callouts.map(c=>{
      const lines=c.text.replace(/\\n/g,"\n").split("\n");
      const w=Math.max(80,Math.max(...lines.map(l=>l.length))*7.5+24);
      const h=lines.length*18+14;
      return `<g>
        <line x1="${c.pinX}" y1="${c.pinY}" x2="${c.boxX+w/2}" y2="${c.boxY+h}" stroke="${c.borderColor}" stroke-width="1.5" stroke-dasharray="5,3"/>
        <circle cx="${c.pinX}" cy="${c.pinY}" r="5" fill="${c.borderColor}"/>
        <rect x="${c.boxX}" y="${c.boxY}" width="${w}" height="${h}" fill="${c.bgColor}" stroke="${c.borderColor}" stroke-width="1.5" rx="3"/>
        ${lines.map((line,i)=>`<text x="${c.boxX+10}" y="${c.boxY+15+i*18}" font-size="12" font-family="Arial" font-weight="600" fill="${c.borderColor}">${escapeXml(line)}</text>`).join("")}
      </g>`;
    }).join("");

    // Curved labels
    const curveSvg=curvedLabels.map(cl=>{
      try{
        const p1=map.latLngToContainerPoint(cl.p1);
        const p2=map.latLngToContainerPoint(cl.p2);
        const mx=(p1.x+p2.x)/2, my=(p1.y+p2.y)/2;
        const dx=p2.x-p1.x, dy=p2.y-p1.y;
        const pid=`svgcvp-${cl.id}`;
        return `<defs><path id="${pid}" d="M ${p1.x} ${p1.y} Q ${mx-dy*0.25} ${my+dx*0.25} ${p2.x} ${p2.y}"/></defs>
          <text fill="${cl.color}" font-size="${cl.size}" font-family="Arial" font-weight="700" letter-spacing="2">
            <textPath href="#${pid}" startOffset="50%" text-anchor="middle">${escapeXml(cl.text)}</textPath>
          </text>`;
      }catch{return "";}
    }).join("");

    // North arrow
    const naSvg=northArrow?`<g transform="translate(20,20)">
      <circle cx="22" cy="22" r="20" fill="rgba(255,255,255,0.88)" stroke="#aaa" stroke-width="1"/>
      <polygon points="22,4 28,26 22,21 16,26" fill="#111"/>
      <polygon points="22,40 28,18 22,23 16,18" fill="#eee" stroke="#111" stroke-width="0.8"/>
      <text x="22" y="50" text-anchor="middle" font-size="10" font-weight="bold" fill="#111" font-family="Arial">N</text>
    </g>`:"";

    // Markers as SVG (base64 embedded images)
    const markersSvg=markerPts.map(pt=>`<image href="${pt.src}" x="${pt.x-pt.w/2}" y="${pt.y-pt.h/2}" width="${pt.w}" height="${pt.h}"/>`).join("");

    const svg=`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#e8e8e8"/>
  <g id="vectors">${overlayContent}</g>
  <g id="markers">${markersSvg}</g>
  <g id="labels">${tooltipSvg.join("")}</g>
  <g id="curved-text">${curveSvg}</g>
  <g id="callouts">${calloutSvg}</g>
  <g id="annotations">${annotSvg}</g>
  <g id="title">${titleSvg}</g>
  <g id="legend">${legendSvg}</g>
  <g id="north-arrow">${naSvg}</g>
</svg>`;

    const blob=new Blob([svg],{type:"image/svg+xml;charset=utf-8"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download=`${title.toLowerCase().replace(/\s+/g,"-")}-map.svg`; a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── Curved text renderer ──────────────────────────────────────────────────
  const renderCurvedLabels=()=>{
    const map=mapRef.current;if(!map||!curvedLabels.length)return null;
    return(
      <svg style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:1000}}>
        {curvedLabels.map(cl=>{
          try{
            const p1=map.latLngToContainerPoint(cl.p1);
            const p2=map.latLngToContainerPoint(cl.p2);
            const mx=(p1.x+p2.x)/2,my=(p1.y+p2.y)/2;
            const dx=p2.x-p1.x,dy=p2.y-p1.y;
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

  const mapW = containerRef.current?.offsetWidth??900;
  const titleX = titlePos.x!==null ? titlePos.x : mapW-254;
  const insetX = insetPos.x!==null ? insetPos.x : mapW-208;

  // ── Render ────────────────────────────────────────────────────────────────
  return(
    <div className="app-shell">
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
          <div className="hint-text">Drag title on map to reposition</div>
        </Sec>

        <Sec title="Branding">
          <Field label="Logo"><input type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&loadImageFile(e.target.files[0],setLogo)}/></Field>
          {logo&&<button className="btn-ghost" onClick={()=>setLogo(null)}>✕ Remove</button>}
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
          {showInset&&<>
            <div style={{marginTop:8}}>
              <div className="field-label">Upload inset image</div>
              <input type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&loadImageFile(e.target.files[0],setInsetImage)}/>
              {insetImage&&<button className="btn-ghost" onClick={()=>setInsetImage(null)}>✕ Remove</button>}
            </div>
          </>}
        </Sec>

        <Sec title="Image Overlay">
          <Field label="Upload raster (PNG/JPG)">
            <input type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&loadImageFile(e.target.files[0],src=>{setPendingOverlay(src);setPlacing("overlay-p1");})}/>
          </Field>
          {placing==="overlay-p1"&&<div className="place-hint">Click NW (top-left) corner on map</div>}
          {placing?.step==="overlay-p2"&&<div className="place-hint">Now click SE (bottom-right) corner</div>}
          {imageOverlays.map(o=>(
            <div key={o.id} className="overlay-row">
              <span className="overlay-name">{o.name}</span>
              <input type="range" min="0" max="1" step="0.05" value={o.opacity} onChange={e=>updateOverlayOpacity(o.id,+e.target.value)} style={{flex:1}}/>
              <button className="btn-icon-sm" onClick={()=>toggleOverlay(o.id)}>{o.visible?"👁":"🚫"}</button>
              <button className="btn-icon-sm" onClick={()=>removeOverlay(o.id)}>✕</button>
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

        <Sec title="Annotation Box">
          <Field label="Text"><input placeholder="~$1B USD MARKET CAP" value={annotDraft.text} onChange={e=>setAnnotDraft(d=>({...d,text:e.target.value}))}/></Field>
          <div className="color-pick-row"><span>Color</span><input type="color" value={annotDraft.color} onChange={e=>setAnnotDraft(d=>({...d,color:e.target.value}))}/></div>
          <button className={`btn mt-8 w100${placing==="annot"?" btn-placing":""}`} onClick={()=>setPlacing(placing==="annot"?null:"annot")}>
            {placing==="annot"?"🎯 Click map to place…":"＋ Place Box"}
          </button>
          <div className="hint-text">Drag boxes on map to reposition</div>
          {annotations.map(a=>(
            <div key={a.id} className="annot-row">
              <span className="annot-swatch" style={{background:a.color}}/>
              <input value={a.text} onChange={e=>setAnnotations(p=>p.map(x=>x.id===a.id?{...x,text:e.target.value}:x))}/>
              <button className="btn-icon-sm" onClick={()=>setAnnotations(p=>p.filter(x=>x.id!==a.id))}>✕</button>
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
          <div className="hint-text">Drag pin dot and box separately on map</div>
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
              <button className="btn-icon-sm" onClick={()=>setCurvedLabels(p=>p.filter(x=>x.id!==cl.id))}>✕</button>
            </div>
          ))}
        </Sec>

        <Sec title="Legend Editor">
          <div className="hint-text" style={{marginBottom:6}}>Drag legend on map to reposition</div>
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
          {layers.filter(l=>l.includeInLegend).length>0&&<button className="btn-ghost" style={{marginTop:6}} onClick={()=>{
            setLegendItems(p=>[...p,...layers.filter(l=>l.includeInLegend).map(l=>({id:crypto.randomUUID(),text:l.legendLabel,type:l.isPoint?"marker":"swatch",color:l.isPoint?l.markerColor:l.fillColor,markerType:l.markerType||"circle"}))]);
          }}>↓ Import from layers</button>}
        </Sec>

        <Sec title="Export">
          <button className="btn w100" onClick={fitAll} style={{marginBottom:6}}>Fit All Layers</button>
          <div className="row2" style={{marginBottom:4}}>
            <button className={`btn${exportType==="png"?" draw-active":""}`} onClick={()=>setExportType("png")}>PNG</button>
            <button className={`btn${exportType==="svg"?" draw-active":""}`} onClick={()=>setExportType("svg")}>SVG</button>
          </div>
          <button className={`btn btn-export w100${exporting?" btn-export-working":""}`}
            onClick={()=>exportType==="svg"?doExportSVG():doExportPNG()}
            disabled={exporting}>
            {exporting?"Exporting…":"⬇ Export"}
          </button>
          <div className="export-note">
            {exportType==="png"?"Use Street basemap · PNG captures full map":"SVG = vector layers only, designer-editable"}
          </div>
        </Sec>

        <Sec title={`Layers${layers.length?` (${layers.length})`:""}`}>
          {layers.length===0?<div className="empty-hint">No layers yet.</div>
            :layers.map((l,idx)=>(
              <LayerCard key={l.id} l={l} idx={idx} total={layers.length}
                onUpdate={p=>updateLayer(l.id,p)}
                onToggle={()=>toggleLayer(l.id)}
                onRemove={()=>removeLayer(l.id)}
                onMove={dir=>moveLayer(l.id,dir)}
              />
            ))
          }
        </Sec>
      </aside>

      {/* MAP SURFACE */}
      <div className="map-side export-surface" ref={containerRef}>
        <div id="map" style={{width:"100%",height:"100%"}}/>

        {renderCurvedLabels()}

        {/* Snap grid — shows when any drag is happening */}
        <SnapGrid active={draggingAny} containerRef={containerRef}/>

        {/* Callout boxes */}
        {callouts.map(c=>(
          <CalloutBox key={c.id} c={c} onChange={patch=>setCallouts(p=>p.map(x=>x.id===c.id?{...x,...patch}:x))}/>
        ))}

        {/* Draggable title */}
        <DraggableEl x={titleX} y={titlePos.y} onMove={p=>{setTitlePos(p);setDraggingAny(true);}} className="title-block">
          <div className="title-main" onMouseUp={()=>setDraggingAny(false)}>{title}</div>
          <div className="title-sub">{subtitle}</div>
        </DraggableEl>

        {/* Draggable logo */}
        {logo&&<DraggableEl x={logoPos.x} y={logoPos.y} onMove={p=>{setLogoPos(p);setDraggingAny(true);}}>
          <img src={logo} alt="Logo" className="logo-img" onMouseUp={()=>setDraggingAny(false)}/>
        </DraggableEl>}

        {/* North arrow */}
        {northArrow&&<div className="north-arrow">
          <svg viewBox="0 0 40 58" width="36" height="52">
            <polygon points="20,2 27,28 20,23 13,28" fill="#111"/>
            <polygon points="20,54 27,28 20,33 13,28" fill="#eee" stroke="#111" strokeWidth="0.8"/>
            <text x="20" y="53" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#111" fontFamily="Arial">N</text>
          </svg>
        </div>}

        {/* Draggable inset */}
        {showInset&&<DraggableEl x={insetX} y={insetPos.y} onMove={p=>{setInsetPos(p);setDraggingAny(true);}}>
          <div className="inset-wrap" onMouseUp={()=>setDraggingAny(false)}>
            {insetImage?<img src={insetImage} alt="Inset" style={{width:190,height:140,objectFit:"cover",display:"block"}}/>
              :<div className="inset-empty"><span>Upload inset image in sidebar</span></div>}
          </div>
        </DraggableEl>}

        {/* Draggable legend */}
        {showLegend&&legendItems.length>0&&<DraggableEl
          x={legendPos.x} y={legendPos.y??-1}
          onMove={p=>{setLegendPos(p);setDraggingAny(true);}}
          style={legendPos.y===-1?{bottom:30,top:"auto"}:{}}>
          <div className="legend-block" onMouseUp={()=>setDraggingAny(false)}>
            {legendItems.map(item=>(
              <div key={item.id} className="legend-row">
                <LegendSymbol item={item}/><span>{item.text}</span>
              </div>
            ))}
          </div>
        </DraggableEl>}

        {/* Draggable annotation boxes */}
        {annotations.map(a=>(
          <DraggableEl key={a.id} x={a.x} y={a.y} onMove={p=>{setAnnotations(prev=>prev.map(x=>x.id===a.id?{...x,...p}:x));setDraggingAny(true);}}>
            <div className="annotation-box" style={{background:a.color}} onMouseUp={()=>setDraggingAny(false)}>{a.text}</div>
          </DraggableEl>
        ))}
      </div>
    </div>
  );
}

// ─── Legend symbol ────────────────────────────────────────────────────────────
function LegendSymbol({item}){
  if(item.type==="marker") return <img src={markerSvgUrl(item.markerType,item.color,16)} width="16" height="16" style={{flexShrink:0}} alt=""/>;
  if(item.type==="line")   return <svg width="24" height="16" style={{flexShrink:0}}><line x1="0" y1="8" x2="24" y2="8" stroke={item.color} strokeWidth="2.5"/></svg>;
  return <span className="legend-swatch" style={{background:item.color}}/>;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Sec({title,children}){return <div className="sec"><div className="sec-title">{title}</div>{children}</div>;}
function Field({label,children}){return <div className="field"><div className="field-label">{label}</div>{children}</div>;}
function Toggle({label,checked,onChange}){
  return(<label className="toggle-row" onClick={()=>onChange(!checked)}>
    <span className={`toggle-track${checked?" on":""}`}><span className="toggle-thumb"/></span>
    <span>{label}</span>
  </label>);
}

function LayerCard({l,idx,total,onUpdate,onToggle,onRemove,onMove}){
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
          <Toggle label="Include in legend" checked={l.includeInLegend} onChange={v=>onUpdate({includeInLegend:v})}/>
        </div>
      )}
    </div>
  );
}
