import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import shp from "shpjs";

// ─── Constants ────────────────────────────────────────────────────────────────
const MARKER_TYPES = [
  { value:"circle",    label:"Circle" },
  { value:"drillhole", label:"Drillhole ▼" },
  { value:"diamond",   label:"Diamond" },
  { value:"square",    label:"Square" },
  { value:"triangle",  label:"Triangle ▲" },
];

const FILL_PATTERNS = [
  { value:"solid",      label:"Solid" },
  { value:"hatch",      label:"Hatch ////" },
  { value:"crosshatch", label:"Crosshatch" },
  { value:"dots",       label:"Dots" },
  { value:"none",       label:"No fill" },
];

// ─── Drag helper — stops event from reaching Leaflet ─────────────────────────
function useDrag(pos, setPos) {
  const onMouseDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX - pos.x;
    const startY = e.clientY - pos.y;
    const onMove = (ev) => setPos({ x: ev.clientX - startX, y: ev.clientY - startY });
    const onUp   = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos, setPos]);
  return onMouseDown;
}

// ─── SVG pattern injection into Leaflet overlay pane ─────────────────────────
function injectPatterns(map, color) {
  const overlayPane = map.getPanes().overlayPane;
  let svg = overlayPane?.querySelector("svg");
  if (!svg) return;
  let defs = svg.querySelector("defs");
  if (!defs) { defs = document.createElementNS("http://www.w3.org/2000/svg","defs"); svg.prepend(defs); }

  const patternDefs = [
    { id:"mvp-hatch",      html:`<pattern id="mvp-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="${color}" stroke-width="2.5"/></pattern>` },
    { id:"mvp-crosshatch", html:`<pattern id="mvp-crosshatch" patternUnits="userSpaceOnUse" width="8" height="8"><line x1="0" y1="0" x2="0" y2="8" stroke="${color}" stroke-width="1.5"/><line x1="0" y1="0" x2="8" y2="0" stroke="${color}" stroke-width="1.5"/></pattern>` },
    { id:"mvp-dots",       html:`<pattern id="mvp-dots" patternUnits="userSpaceOnUse" width="8" height="8"><circle cx="4" cy="4" r="2" fill="${color}"/></pattern>` },
  ];
  patternDefs.forEach(({ id, html }) => {
    const existing = defs.querySelector(`#${id}`);
    if (existing) existing.remove();
    defs.insertAdjacentHTML("beforeend", html);
  });
}

// ─── Marker icon factory ──────────────────────────────────────────────────────
function makeMarkerIcon(type, color, size = 14) {
  const s = size, h = s / 2;
  let inner = "";
  if      (type==="circle")    inner = `<circle cx="${h}" cy="${h}" r="${h-1.5}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
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
  if      (type==="circle")    inner = `<circle cx="${h}" cy="${h}" r="${h-1.5}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  else if (type==="drillhole") inner = `<polygon points="${h},${s-2} 2,2 ${s-2},2" fill="${color}" stroke="#444" stroke-width="1"/><line x1="${h}" y1="0" x2="${h}" y2="${s}" stroke="${color}" stroke-width="1.5"/>`;
  else if (type==="diamond")   inner = `<polygon points="${h},1 ${s-1},${h} ${h},${s-1} 1,${h}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  else if (type==="square")    inner = `<rect x="2" y="2" width="${s-4}" height="${s-4}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  else if (type==="triangle")  inner = `<polygon points="${h},1 ${s-1},${s-1} 1,${s-1}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  return `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${inner}</svg>`)}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const escapeHtml = v => String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

function loadImageFile(file, setter) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => setter(r.result);
  r.readAsDataURL(file);
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
  return features.filter(f=>f.geometry?.type==="Point"||f.geometry?.type==="MultiPoint").length / features.length > 0.5;
}

function getPropertyKeys(geojson) {
  const features = geojson.features ?? (Array.isArray(geojson) ? geojson.flatMap(g=>g.features??[]) : []);
  const keys = new Set();
  features.slice(0,20).forEach(f => Object.keys(f.properties??{}).forEach(k=>keys.add(k)));
  return [...keys];
}

async function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  return new Promise((res,rej) => {
    const s = document.createElement("script");
    s.src=src; s.onload=res; s.onerror=rej;
    document.head.appendChild(s);
  });
}

// ─── Draggable overlay wrapper ────────────────────────────────────────────────
function DraggableOverlay({ x, y, onPosChange, children, className="", style={} }) {
  const startRef = useRef(null);

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    startRef.current = { mx: e.clientX, my: e.clientY, ox: x, oy: y };

    const onMove = (ev) => {
      const dx = ev.clientX - startRef.current.mx;
      const dy = ev.clientY - startRef.current.my;
      onPosChange({ x: startRef.current.ox + dx, y: startRef.current.oy + dy });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className={`draggable-overlay ${className}`}
      style={{ position:"absolute", left:x, top:y, cursor:"move", zIndex:1001, userSelect:"none", ...style }}
      onMouseDown={onMouseDown}
    >
      {children}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const mapRef       = useRef(null);
  const containerRef = useRef(null);
  const drawRef      = useRef({ mode:"none", points:[], preview:null });

  // Map labels & branding
  const [title,        setTitle]        = useState("RIFT PROJECT");
  const [subtitle,     setSubtitle]     = useState("Nebraska");
  const [titlePos,     setTitlePos]     = useState({ x:null, y:18 }); // null = right-anchored default
  const [logo,         setLogo]         = useState(null);
  const [logoPos,      setLogoPos]      = useState({ x:18, y:18 });

  // Overlays
  const [northArrow,   setNorthArrow]   = useState(true);
  const [showLegend,   setShowLegend]   = useState(true);
  const [legendPos,    setLegendPos]    = useState({ x:16, y:null }); // null = bottom-anchored default
  const [showInset,    setShowInset]    = useState(true);
  const [insetImage,   setInsetImage]   = useState(null);
  const [insetPos,     setInsetPos]     = useState({ x:null, y:80 });

  // GIS layers
  const [layers,       setLayers]       = useState([]);

  // Image overlays
  const [imageOverlays, setImageOverlays] = useState([]);
  const [pendingOverlay, setPendingOverlay] = useState(null); // { src, step:"p1"|"p2", p1:latlng }

  // Annotations
  const [annotations,  setAnnotations]  = useState([]); // { id, text, color, x, y }
  const [annotDraft,   setAnnotDraft]   = useState({ text:"", color:"#0a2c78" });

  // Callouts
  const [callouts,     setCallouts]     = useState([]); // { id, text, bgColor, borderColor, pinX, pinY, boxX, boxY }
  const [calloutDraft, setCalloutDraft] = useState({ text:"", bgColor:"#ffffff", borderColor:"#1a3a6b" });

  // Curved text
  const [curvedLabels, setCurvedLabels] = useState([]); // { id, text, color, size, p1:latlng, p2:latlng }
  const [curvedDraft,  setCurvedDraft]  = useState({ text:"", color:"#111111", size:20 });
  const [curvedStep,   setCurvedStep]   = useState(null); // null|"p1"|"p2"
  const curvedP1Ref = useRef(null);

  // Draw
  const [drawMode,     setDrawMode]     = useState("none");
  const [drawStyle,    setDrawStyle]    = useState({ color:"#e63946", fill:"#e63946", opacity:0.25, weight:2 });
  const [drawActive,   setDrawActive]   = useState(false); // currently drawing

  // Legend editor
  const [legendItems,  setLegendItems]  = useState([]); // { id, text, type:"swatch"|"marker"|"line", color, markerType }
  const [legendDraft,  setLegendDraft]  = useState({ text:"", type:"swatch", color:"#4e8cff", markerType:"circle" });

  // Export
  const [exporting,    setExporting]    = useState(false);

  // Map mode indicator
  const [mapCursor, setMapCursor] = useState("grab");

  // ── Map init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { doubleClickZoom: false }).setView([40,-96],5);
    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM",maxZoom:19});
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{attribution:"Esri",maxZoom:19});
    sat.addTo(map);
    map._baseLayers={osm,sat}; map._activeBase=sat;
    L.control.scale({imperial:false}).addTo(map);
    mapRef.current=map;
    setTimeout(()=>map.invalidateSize(),100);
    return ()=>{ if(mapRef.current){mapRef.current.remove();mapRef.current=null;} };
  },[]);

  // ── Unified map click ─────────────────────────────────────────────────────
  const anyPlacing = drawMode!=="none"||curvedStep||pendingOverlay||
    (annotDraft._placing)||( calloutDraft._placing);

  useEffect(()=>{
    const map=mapRef.current; if(!map) return;

    const onClick=(e)=>{
      const latlng=e.latlng;
      const rect=containerRef.current.getBoundingClientRect();
      const px={ x:e.originalEvent.clientX-rect.left, y:e.originalEvent.clientY-rect.top };

      // Annotation placement
      if(annotDraft._placing){
        setAnnotations(p=>[...p,{ id:crypto.randomUUID(), text:annotDraft.text||"Label", color:annotDraft.color, x:px.x, y:px.y }]);
        setAnnotDraft(d=>({...d,_placing:false})); return;
      }

      // Callout placement
      if(calloutDraft._placing){
        setCallouts(p=>[...p,{
          id:crypto.randomUUID(), text:calloutDraft.text||"Label",
          bgColor:calloutDraft.bgColor, borderColor:calloutDraft.borderColor,
          pinX:px.x, pinY:px.y, boxX:px.x+24, boxY:px.y-64,
        }]);
        setCalloutDraft(d=>({...d,_placing:false})); return;
      }

      // Curved text
      if(curvedStep==="p1"){ curvedP1Ref.current=latlng; setCurvedStep("p2"); return; }
      if(curvedStep==="p2"){
        setCurvedLabels(p=>[...p,{
          id:crypto.randomUUID(), text:curvedDraft.text, color:curvedDraft.color,
          size:curvedDraft.size, p1:curvedP1Ref.current, p2:latlng,
        }]);
        setCurvedStep(null); return;
      }

      // Image overlay corners
      if(pendingOverlay?.step==="p1"){ setPendingOverlay(o=>({...o,p1:latlng,step:"p2"})); return; }
      if(pendingOverlay?.step==="p2"){
        const bounds=L.latLngBounds(pendingOverlay.p1,latlng);
        const id=crypto.randomUUID();
        const ll=L.imageOverlay(pendingOverlay.src,bounds,{opacity:0.8,interactive:false});
        ll.addTo(map);
        setImageOverlays(p=>[...p,{id,name:"Image overlay",src:pendingOverlay.src,bounds,opacity:0.8,leafLayer:ll,visible:true}]);
        setPendingOverlay(null); return;
      }

      // Draw
      const ds=drawRef.current;
      if(drawMode==="none") return;

      if(drawMode==="circle"){
        if(!ds.points.length){ ds.points=[latlng]; }
        else{
          const r=ds.center.distanceTo(latlng);
          if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
          const layer=L.circle(ds.center,{radius:r,color:drawStyle.color,weight:drawStyle.weight,fill:true,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity}).addTo(map);
          commitDrawnLayer(layer,"Circle"); ds.points=[]; ds.center=null;
        }
        return;
      }
      if(drawMode==="rectangle"){
        if(!ds.points.length){ ds.points=[latlng]; }
        else{
          if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
          const layer=L.rectangle(L.latLngBounds(ds.points[0],latlng),{color:drawStyle.color,weight:drawStyle.weight,fill:true,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity}).addTo(map);
          commitDrawnLayer(layer,"Rectangle"); ds.points=[];
        }
        return;
      }
      if(drawMode==="polygon"||drawMode==="line"){
        ds.points.push(latlng);
        if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
        if(drawMode==="polygon"&&ds.points.length>1)
          ds.preview=L.polygon(ds.points,{color:drawStyle.color,weight:drawStyle.weight,fill:true,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity,dashArray:"6,4"}).addTo(map);
        else if(drawMode==="line"&&ds.points.length>1)
          ds.preview=L.polyline(ds.points,{color:drawStyle.color,weight:drawStyle.weight,dashArray:"6,4"}).addTo(map);
        setDrawActive(true);
        return;
      }
    };

    const onMouseMove=(e)=>{
      const ds=drawRef.current;
      if(drawMode==="circle"&&ds.points.length===1){
        ds.center=ds.points[0];
        const r=ds.center.distanceTo(e.latlng);
        if(ds.preview) map.removeLayer(ds.preview);
        ds.preview=L.circle(ds.center,{radius:r,color:drawStyle.color,weight:1,fill:true,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity*0.5,dashArray:"4,4"}).addTo(map);
      }
    };

    const onDblClick=(e)=>{
      const ds=drawRef.current;
      if((drawMode==="polygon"||drawMode==="line")&&ds.points.length>=2){
        L.DomEvent.stopPropagation(e);
        if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
        const layer=drawMode==="polygon"
          ?L.polygon(ds.points,{color:drawStyle.color,weight:drawStyle.weight,fill:true,fillColor:drawStyle.fill,fillOpacity:drawStyle.opacity})
          :L.polyline(ds.points,{color:drawStyle.color,weight:drawStyle.weight});
        layer.addTo(map);
        commitDrawnLayer(layer,drawMode==="polygon"?"Polygon":"Line");
        ds.points=[]; setDrawActive(false);
      }
    };

    // ESC to cancel draw
    const onKey=(e)=>{
      if(e.key==="Escape"){
        const ds=drawRef.current;
        if(ds.preview){map.removeLayer(ds.preview);ds.preview=null;}
        ds.points=[];
        setDrawMode("none"); setDrawActive(false);
        setCurvedStep(null); setPendingOverlay(null);
        setAnnotDraft(d=>({...d,_placing:false}));
        setCalloutDraft(d=>({...d,_placing:false}));
      }
    };

    map.on("click",onClick);
    map.on("mousemove",onMouseMove);
    map.on("dblclick",onDblClick);
    window.addEventListener("keydown",onKey);

    const isPlacing=drawMode!=="none"||curvedStep||pendingOverlay||annotDraft._placing||calloutDraft._placing;
    map.getContainer().style.cursor=isPlacing?"crosshair":"";

    return ()=>{
      map.off("click",onClick);
      map.off("mousemove",onMouseMove);
      map.off("dblclick",onDblClick);
      window.removeEventListener("keydown",onKey);
    };
  },[drawMode,drawStyle,curvedStep,pendingOverlay,annotDraft,calloutDraft]);

  // ── Commit drawn shape to layer list ─────────────────────────────────────
  const commitDrawnLayer=useCallback((leafLayer,type)=>{
    setLayers(p=>[...p,{
      id:crypto.randomUUID(), name:type, layer:leafLayer, _geojson:null,
      visible:true, isPoint:false, isDrawn:true,
      color:drawStyle.color, fillColor:drawStyle.fill, fillOpacity:drawStyle.opacity,
      fillPattern:"solid", weight:drawStyle.weight, layerOpacity:1,
      legendLabel:type, includeInLegend:false,
      propKeys:[], showLabels:false, labelField:"",
    }]);
  },[drawStyle]);

  // ── GeoJSON layer builder ─────────────────────────────────────────────────
  const buildLeafletLayer=useCallback((geojson,cfg)=>{
    const map=mapRef.current; if(!map||!geojson) return null;

    // Inject SVG patterns
    injectPatterns(map,cfg.fillColor);

    let fillStyle={};
    if(cfg.fillPattern==="none")  fillStyle={fill:false,fillOpacity:0};
    else if(cfg.fillPattern==="solid") fillStyle={fill:true,fillColor:cfg.fillColor,fillOpacity:+cfg.fillOpacity};
    else {
      // Use SVG pattern URL
      const patId=`mvp-${cfg.fillPattern}`;
      fillStyle={fill:true,fillColor:`url(#${patId})`,fillOpacity:1,className:`mvpat-${cfg.fillPattern}`};
    }

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
    const map=mapRef.current; if(!map) return item;
    const u={...item,...patch};
    if(item.layer) map.removeLayer(item.layer);
    if(u.isDrawn){
      // Re-style drawn layers
      if(item.layer) item.layer.addTo(map);
      return u;
    }
    const newLayer=buildLeafletLayer(u._geojson,u);
    if(newLayer&&u.visible) newLayer.addTo(map);
    return{...u,layer:newLayer};
  },[buildLeafletLayer]);

  const RERENDER=new Set(["color","fillColor","fillOpacity","fillPattern","weight","pointRadius","markerType","markerColor","layerOpacity","showLabels","labelField"]);

  const addLayer=useCallback((geojson,name)=>{
    const map=mapRef.current; if(!map) return;
    const propKeys=getPropertyKeys(geojson);
    const isPoint=isPointLayer(geojson);
    const cfg={
      id:crypto.randomUUID(),name,_geojson:geojson,visible:true,isPoint,isDrawn:false,
      color:"#4e8cff",fillColor:"#4e8cff",fillOpacity:0.35,fillPattern:"solid",
      weight:2,pointRadius:7,markerType:"drillhole",markerColor:"#111111",
      layerOpacity:1,showLabels:false,labelField:propKeys[0]??"",
      propKeys,legendLabel:name,includeInLegend:true,
    };
    const layer=buildLeafletLayer(geojson,cfg);
    if(!layer) return;
    layer.addTo(map);
    try{ const b=layer.getBounds(); if(b.isValid()) map.fitBounds(b,{padding:[20,20]}); }catch{}
    setLayers(p=>[...p,{...cfg,layer}]);
  },[buildLeafletLayer]);

  const handleFile=async(file)=>{
    if(!file) return;
    try{
      if(file.name.endsWith(".zip"))    {addLayer(await shp(await file.arrayBuffer()),file.name.replace(".zip",""));return;}
      if(file.name.endsWith(".geojson")||file.name.endsWith(".json")){addLayer(JSON.parse(await file.text()),file.name);return;}
      if(file.name.endsWith(".csv"))    {addLayer(csvToGeoJSON(await file.text()),file.name.replace(".csv",""));return;}
      alert("Supported: .zip, .geojson, .json, .csv");
    }catch(err){console.error(err);alert(`Import failed: ${err.message}`);}
  };

  const updateLayer=useCallback((id,patch)=>{
    const needsRerender=Object.keys(patch).some(k=>RERENDER.has(k));
    setLayers(p=>p.map(item=>{
      if(item.id!==id) return item;
      if(item.isDrawn){
        const u={...item,...patch};
        item.layer?.setStyle?.({color:u.color,weight:+u.weight,fillColor:u.fillColor,fillOpacity:+u.fillOpacity,opacity:+u.layerOpacity});
        return u;
      }
      if(needsRerender) return reRenderLayer(item,patch);
      return{...item,...patch};
    }));
  },[reRenderLayer]);

  const toggleLayer=(id)=>{
    const map=mapRef.current;
    setLayers(p=>p.map(item=>{ if(item.id!==id) return item; if(item.visible) map.removeLayer(item.layer); else item.layer?.addTo(map); return{...item,visible:!item.visible}; }));
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
      if(map) next.forEach(item=>{if(item.visible&&item.layer){map.removeLayer(item.layer);item.layer.addTo(map);}});
      return next;
    });
  };

  // Image overlay controls
  const updateOverlayOpacity=(id,opacity)=>{ setImageOverlays(p=>p.map(o=>{ if(o.id!==id)return o; o.leafLayer.setOpacity(opacity); return{...o,opacity}; })); };
  const toggleOverlay=(id)=>{ const map=mapRef.current; setImageOverlays(p=>p.map(o=>{ if(o.id!==id)return o; if(o.visible)map.removeLayer(o.leafLayer);else o.leafLayer.addTo(map); return{...o,visible:!o.visible}; })); };
  const removeOverlay=(id)=>{ const map=mapRef.current; setImageOverlays(p=>{const t=p.find(o=>o.id===id);if(t)map?.removeLayer(t.leafLayer);return p.filter(o=>o.id!==id);}); };

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

  // ── PNG Export — captures map area at fixed size ──────────────────────────
  const doExport=async()=>{
    setExporting(true);
    try{
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");

      // Hide sidebar, expand map to full width, wait for reflow + tiles
      const sidebar=document.querySelector(".sidebar");
      const mapSide=document.querySelector(".map-side");
      sidebar.style.display="none";
      mapSide.style.width="100vw";
      mapRef.current.invalidateSize();
      await new Promise(r=>setTimeout(r,500));

      await new Promise(resolve=>{
        let total=0,done=0;
        document.querySelectorAll(".leaflet-tile-container img").forEach(img=>{ if(!img.complete){total++; img.addEventListener("load",()=>{done++;if(done>=total)resolve();},{once:true}); img.addEventListener("error",()=>{done++;if(done>=total)resolve();},{once:true});} });
        if(!total) resolve();
        setTimeout(resolve,5000);
      });

      const surface=document.querySelector(".export-surface");
      const canvas=await window.html2canvas(surface,{
        useCORS:true,allowTaint:true,scale:2,logging:false,backgroundColor:"#ffffff",imageTimeout:20000,
        onclone:(doc)=>{
          // Convert Leaflet pane transforms to top/left so layers align
          ["leaflet-map-pane","leaflet-tile-pane","leaflet-overlay-pane","leaflet-shadow-pane","leaflet-marker-pane","leaflet-tooltip-pane","leaflet-popup-pane"].forEach(cls=>{
            doc.querySelectorAll(`.${cls}`).forEach(el=>{
              const t=el.style.transform;
              if(t&&t.includes("translate")){
                const m=t.match(/translate3d\(([^,]+),\s*([^,]+),/)||t.match(/translate\(([^,]+),\s*([^)]+)\)/);
                if(m){el.style.transform="none";el.style.left=(parseFloat(m[1])||0)+"px";el.style.top=(parseFloat(m[2])||0)+"px";}
              }
            });
          });
          doc.querySelectorAll(".leaflet-overlay-pane svg").forEach(el=>{el.style.visibility="visible";el.style.display="block";});
        },
      });

      sidebar.style.display="";
      mapSide.style.width="";
      mapRef.current.invalidateSize();

      const a=document.createElement("a");
      a.download=`${title.toLowerCase().replace(/\s+/g,"-")}-map.png`;
      a.href=canvas.toDataURL("image/png");a.click();
    }catch(err){
      console.error(err);
      alert("Export failed. Switch to 🗺 Street basemap first — satellite tiles block cross-origin capture.");
    }finally{setExporting(false);}
  };

  // ── Curved label renderer (SVG layer over map) ────────────────────────────
  const [, tick]=useState(0);
  useEffect(()=>{
    const map=mapRef.current;if(!map)return;
    const fn=()=>tick(n=>n+1);
    map.on("move zoom moveend zoomend",fn);
    return ()=>map.off("move zoom moveend zoomend",fn);
  },[]);

  const renderCurvedLabels=()=>{
    const map=mapRef.current; if(!map||!curvedLabels.length) return null;
    return(
      <svg style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:1000}} xmlns="http://www.w3.org/2000/svg">
        {curvedLabels.map(cl=>{
          try{
            const p1=map.latLngToContainerPoint(cl.p1);
            const p2=map.latLngToContainerPoint(cl.p2);
            const mx=(p1.x+p2.x)/2,my=(p1.y+p2.y)/2;
            const dx=p2.x-p1.x,dy=p2.y-p1.y;
            const cx=mx-dy*0.25,cy=my+dx*0.25;
            const pid=`cvp-${cl.id}`;
            return(
              <g key={cl.id}>
                <defs><path id={pid} d={`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`}/></defs>
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

  // ── Compute title position ────────────────────────────────────────────────
  const mapWidth = containerRef.current?.offsetWidth ?? 900;
  const titleX = titlePos.x !== null ? titlePos.x : mapWidth - 250;

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
          <div className="hint-text">Drag the title block on the map to reposition</div>
        </Sec>

        <Sec title="Branding">
          <Field label="Logo"><input type="file" accept="image/*" onChange={e=>loadImageFile(e.target.files?.[0],setLogo)}/></Field>
          {logo&&<button className="btn-ghost" onClick={()=>setLogo(null)}>✕ Remove logo</button>}
          <div className="hint-text">Drag logo on map to reposition</div>
        </Sec>

        <Sec title="Basemap">
          <div className="row2">
            <button className="btn" onClick={()=>switchBase("sat")}>🛰 Satellite</button>
            <button className="btn" onClick={()=>switchBase("osm")}>🗺 Street</button>
          </div>
          <div className="export-note" style={{marginTop:6}}>Use Street basemap for PNG export</div>
        </Sec>

        <Sec title="Overlays">
          <Toggle label="North Arrow" checked={northArrow} onChange={setNorthArrow}/>
          <Toggle label="Legend"      checked={showLegend} onChange={setShowLegend}/>
          <Toggle label="Inset Map"   checked={showInset}  onChange={setShowInset}/>
          {showInset&&<>
            <div className="field-label" style={{marginTop:8}}>Inset image</div>
            <input type="file" accept="image/*" onChange={e=>loadImageFile(e.target.files?.[0],setInsetImage)}/>
            {insetImage&&<button className="btn-ghost" onClick={()=>setInsetImage(null)}>✕ Remove</button>}
            <div className="hint-text">Drag inset on map to reposition</div>
          </>}
        </Sec>

        {/* Image overlay */}
        <Sec title="Image Overlay">
          <Field label="Upload raster (PNG/JPG)">
            <input type="file" accept="image/*" onChange={e=>{
              if(!e.target.files?.[0]) return;
              loadImageFile(e.target.files[0],(src)=>setPendingOverlay({src,step:"p1",p1:null}));
            }}/>
          </Field>
          {pendingOverlay&&<div className="place-hint">{pendingOverlay.step==="p1"?"Click NW (top-left) corner on map":"Click SE (bottom-right) corner on map"}</div>}
          {imageOverlays.map(o=>(
            <div key={o.id} className="overlay-row">
              <span className="overlay-name">{o.name}</span>
              <input type="range" min="0" max="1" step="0.05" value={o.opacity} onChange={e=>updateOverlayOpacity(o.id,+e.target.value)} style={{flex:1}}/>
              <button className="btn-icon-sm" onClick={()=>toggleOverlay(o.id)}>{o.visible?"👁":"🚫"}</button>
              <button className="btn-icon-sm" onClick={()=>removeOverlay(o.id)}>✕</button>
            </div>
          ))}
        </Sec>

        {/* Draw */}
        <Sec title="Draw on Map">
          <div className="draw-grid">
            {[{m:"none",label:"✋",tip:"Off"},{m:"circle",label:"⬤",tip:"Circle"},{m:"rectangle",label:"▬",tip:"Rectangle"},{m:"polygon",label:"⬠",tip:"Polygon"},{m:"line",label:"╱",tip:"Line"}].map(({m,label,tip})=>(
              <button key={m} title={tip}
                className={`btn draw-btn${drawMode===m?" draw-active":""}`}
                onClick={()=>{ setDrawMode(m); drawRef.current={mode:m,points:[],preview:null}; setDrawActive(false); }}>
                <span>{label}</span><span className="draw-btn-label">{tip}</span>
              </button>
            ))}
          </div>
          {drawMode!=="none"&&<div className="draw-hint">
            {drawMode==="circle"&&(drawRef.current.points.length===0?"Click to set center":"Click to set radius")}
            {drawMode==="rectangle"&&(drawRef.current.points.length===0?"Click first corner":"Click opposite corner")}
            {(drawMode==="polygon"||drawMode==="line")&&(drawActive?"Double-click to finish · Esc to cancel":"Click to start")}
            {" "}<span style={{color:"#7cc67c"}}>Esc cancels</span>
          </div>}
          <div className="color-trio" style={{marginTop:8}}>
            <div><div className="field-label">Stroke</div><input type="color" value={drawStyle.color} onChange={e=>setDrawStyle(s=>({...s,color:e.target.value}))}/></div>
            <div><div className="field-label">Fill</div><input type="color" value={drawStyle.fill} onChange={e=>setDrawStyle(s=>({...s,fill:e.target.value}))}/></div>
            <div><div className="field-label">Opacity</div><input type="range" min="0" max="1" step="0.05" value={drawStyle.opacity} onChange={e=>setDrawStyle(s=>({...s,opacity:+e.target.value}))}/></div>
          </div>
        </Sec>

        {/* Annotation boxes */}
        <Sec title="Annotation Box">
          <Field label="Text"><input placeholder="~$1B USD MARKET CAP" value={annotDraft.text} onChange={e=>setAnnotDraft(d=>({...d,text:e.target.value}))}/></Field>
          <div className="color-pick-row"><span>Color</span><input type="color" value={annotDraft.color} onChange={e=>setAnnotDraft(d=>({...d,color:e.target.value}))}/></div>
          <button className={`btn${annotDraft._placing?" btn-placing":""}`} style={{marginTop:8,width:"100%"}}
            onClick={()=>setAnnotDraft(d=>({...d,_placing:!d._placing}))}>
            {annotDraft._placing?"🎯 Click map to place…":"＋ Place Box"}
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

        {/* Callout boxes */}
        <Sec title="Callout Box">
          <Field label="Text (\\n = new line)">
            <input placeholder="NEC11-004&#10;236m @ 2.10% REO" value={calloutDraft.text} onChange={e=>setCalloutDraft(d=>({...d,text:e.target.value}))}/>
          </Field>
          <div className="color-trio">
            <div><div className="field-label">Background</div><input type="color" value={calloutDraft.bgColor} onChange={e=>setCalloutDraft(d=>({...d,bgColor:e.target.value}))}/></div>
            <div><div className="field-label">Border/text</div><input type="color" value={calloutDraft.borderColor} onChange={e=>setCalloutDraft(d=>({...d,borderColor:e.target.value}))}/></div>
          </div>
          <button className={`btn${calloutDraft._placing?" btn-placing":""}`} style={{marginTop:8,width:"100%"}}
            onClick={()=>setCalloutDraft(d=>({...d,_placing:!d._placing}))}>
            {calloutDraft._placing?"🎯 Click pin location…":"＋ Place Callout"}
          </button>
          <div className="hint-text">Drag callout box on map · leader line follows</div>
          {callouts.map(c=>(
            <div key={c.id} className="annot-row">
              <span className="annot-swatch" style={{background:c.borderColor,borderRadius:0}}/>
              <input value={c.text} onChange={e=>setCallouts(p=>p.map(x=>x.id===c.id?{...x,text:e.target.value}:x))}/>
              <button className="btn-icon-sm" onClick={()=>setCallouts(p=>p.filter(x=>x.id!==c.id))}>✕</button>
            </div>
          ))}
        </Sec>

        {/* Curved text */}
        <Sec title="Curved Text">
          <Field label="Text">
            <input placeholder="Elk Creek Carbonatite Complex" value={curvedDraft.text} onChange={e=>setCurvedDraft(d=>({...d,text:e.target.value}))}/>
          </Field>
          <div className="color-trio">
            <div><div className="field-label">Color</div><input type="color" value={curvedDraft.color} onChange={e=>setCurvedDraft(d=>({...d,color:e.target.value}))}/></div>
            <div><div className="field-label">Size ({curvedDraft.size}px)</div><input type="range" min="10" max="52" value={curvedDraft.size} onChange={e=>setCurvedDraft(d=>({...d,size:+e.target.value}))}/></div>
          </div>
          <button className={`btn${curvedStep?" btn-placing":""}`} style={{marginTop:8,width:"100%"}}
            onClick={()=>{ if(!curvedDraft.text.trim()){alert("Enter text first.");return;} setCurvedStep(curvedStep?"p2":"p1"); }}>
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

        {/* Legend editor */}
        <Sec title="Legend Editor">
          <div className="hint-text" style={{marginBottom:8}}>Drag legend on map to reposition</div>
          <div className="legend-editor-row">
            <input placeholder="Label text" value={legendDraft.text} onChange={e=>setLegendDraft(d=>({...d,text:e.target.value}))} style={{flex:2}}/>
            <select value={legendDraft.type} onChange={e=>setLegendDraft(d=>({...d,type:e.target.value}))} style={{flex:1}}>
              <option value="swatch">■ Swatch</option>
              <option value="marker">● Marker</option>
              <option value="line">― Line</option>
            </select>
            <input type="color" value={legendDraft.color} onChange={e=>setLegendDraft(d=>({...d,color:e.target.value}))}/>
          </div>
          {legendDraft.type==="marker"&&(
            <select value={legendDraft.markerType} onChange={e=>setLegendDraft(d=>({...d,markerType:e.target.value}))} style={{marginTop:4}}>
              {MARKER_TYPES.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          )}
          <button className="btn" style={{marginTop:6,width:"100%"}} onClick={()=>{
            if(!legendDraft.text.trim()) return;
            setLegendItems(p=>[...p,{id:crypto.randomUUID(),...legendDraft}]);
            setLegendDraft(d=>({...d,text:""}));
          }}>＋ Add Legend Entry</button>
          {legendItems.length>0&&(
            <div style={{marginTop:8}}>
              {legendItems.map((item,i)=>(
                <div key={item.id} className="legend-edit-row">
                  <LegendSymbol item={item}/>
                  <span style={{flex:1,fontSize:11,color:"#c8d3e8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.text}</span>
                  <button className="btn-order" onClick={()=>setLegendItems(p=>{const n=[...p];if(i>0)[n[i],n[i-1]]=[n[i-1],n[i]];return n;})}>▲</button>
                  <button className="btn-order" onClick={()=>setLegendItems(p=>{const n=[...p];if(i<n.length-1)[n[i],n[i+1]]=[n[i+1],n[i]];return n;})}>▼</button>
                  <button className="btn-icon-sm" onClick={()=>setLegendItems(p=>p.filter(x=>x.id!==item.id))}>✕</button>
                </div>
              ))}
            </div>
          )}
          {/* Auto-add from layers */}
          {layers.filter(l=>l.includeInLegend).length>0&&(
            <button className="btn-ghost" style={{marginTop:6}} onClick={()=>{
              const toAdd=layers.filter(l=>l.includeInLegend).map(l=>({
                id:crypto.randomUUID(),text:l.legendLabel,
                type:l.isPoint?"marker":"swatch",
                color:l.isPoint?l.markerColor:l.fillColor,
                markerType:l.markerType||"circle",
              }));
              setLegendItems(p=>[...p,...toAdd]);
            }}>↓ Import from layers</button>
          )}
        </Sec>

        <Sec title="Export">
          <button className="btn" onClick={fitAll} style={{width:"100%",marginBottom:6}}>Fit All Layers</button>
          <button className={`btn btn-export${exporting?" btn-export-working":""}`} onClick={doExport} disabled={exporting} style={{width:"100%"}}>
            {exporting?"Exporting…":"⬇ Export PNG"}
          </button>
          <div className="export-note">Switch to Street basemap for best results</div>
        </Sec>

        <Sec title={`Layers${layers.length?` (${layers.length})`:""}`}>
          {layers.length===0
            ?<div className="empty-hint">No layers yet.</div>
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

      {/* ── MAP SURFACE ── */}
      <div className="map-side export-surface">
        <div ref={containerRef} id="map"/>

        {/* Curved text SVG */}
        {renderCurvedLabels()}

        {/* Callout boxes — SVG so leader line is always visible */}
        {callouts.map(c=>(
          <CalloutBox key={c.id} c={c}
            onChange={patch=>setCallouts(p=>p.map(x=>x.id===c.id?{...x,...patch}:x))}
          />
        ))}

        {/* Draggable title block */}
        <DraggableOverlay x={titleX} y={titlePos.y} onPosChange={p=>setTitlePos(p)} className="title-block">
          <div className="title-main">{title}</div>
          <div className="title-sub">{subtitle}</div>
        </DraggableOverlay>

        {/* Draggable logo */}
        {logo&&(
          <DraggableOverlay x={logoPos.x} y={logoPos.y} onPosChange={setLogoPos}>
            <img src={logo} alt="Logo" className="logo-img"/>
          </DraggableOverlay>
        )}

        {/* North arrow — fixed top-left */}
        {northArrow&&(
          <div className="north-arrow">
            <svg viewBox="0 0 40 58" width="36" height="52">
              <polygon points="20,2 27,28 20,23 13,28" fill="#111"/>
              <polygon points="20,54 27,28 20,33 13,28" fill="#eee" stroke="#111" strokeWidth="0.8"/>
              <text x="20" y="53" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#111" fontFamily="Arial">N</text>
            </svg>
          </div>
        )}

        {/* Draggable inset */}
        {showInset&&(
          <DraggableOverlay x={insetPos.x??10} y={insetPos.y} onPosChange={setInsetPos} className="inset-wrap">
            {insetImage
              ?<img src={insetImage} alt="Inset" style={{width:190,height:140,objectFit:"cover",display:"block"}}/>
              :<div className="inset-empty"><span>Upload inset image in sidebar</span></div>
            }
          </DraggableOverlay>
        )}

        {/* Draggable legend */}
        {showLegend&&legendItems.length>0&&(
          <DraggableOverlay
            x={legendPos.x}
            y={legendPos.y??-1} // will be bottom via CSS if -1
            onPosChange={setLegendPos}
            className="legend-block"
            style={legendPos.y===-1?{bottom:30,top:"auto"}:{}}
          >
            {legendItems.map(item=>(
              <div key={item.id} className="legend-row">
                <LegendSymbol item={item}/>
                <span>{item.text}</span>
              </div>
            ))}
          </DraggableOverlay>
        )}

        {/* Draggable plain annotation boxes */}
        {annotations.map(a=>(
          <DraggableOverlay key={a.id} x={a.x} y={a.y} onPosChange={p=>setAnnotations(prev=>prev.map(x=>x.id===a.id?{...x,...p}:x))}>
            <div className="annotation-box" style={{background:a.color}}>{a.text}</div>
          </DraggableOverlay>
        ))}
      </div>
    </div>
  );
}

// ─── Legend symbol display ────────────────────────────────────────────────────
function LegendSymbol({ item }) {
  if (item.type==="marker") return <img src={markerSvgUrl(item.markerType,item.color,16)} width="16" height="16" style={{flexShrink:0}} alt=""/>;
  if (item.type==="line")   return <svg width="24" height="16" style={{flexShrink:0}}><line x1="0" y1="8" x2="24" y2="8" stroke={item.color} strokeWidth="2.5"/></svg>;
  return <span className="legend-swatch" style={{background:item.color}}/>;
}

// ─── Callout box (SVG with draggable box, fixed pin) ─────────────────────────
function CalloutBox({ c, onChange }) {
  const lines = c.text.replace(/\\n/g,"\n").split("\n");
  const w = Math.max(...lines.map(l=>l.length))*8+24;
  const h = lines.length*18+14;

  const onBoxMouseDown=(e)=>{
    if(e.button!==0) return;
    e.stopPropagation(); e.preventDefault();
    const startX=e.clientX-c.boxX, startY=e.clientY-c.boxY;
    const onMove=(ev)=>onChange({boxX:ev.clientX-startX,boxY:ev.clientY-startY});
    const onUp=()=>{ window.removeEventListener("mousemove",onMove); window.removeEventListener("mouseup",onUp); };
    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
  };

  return(
    <svg style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:1001}} xmlns="http://www.w3.org/2000/svg">
      <line x1={c.pinX} y1={c.pinY} x2={c.boxX+w/2} y2={c.boxY+h} stroke={c.borderColor} strokeWidth="1.5" strokeDasharray="5,3"/>
      <circle cx={c.pinX} cy={c.pinY} r="5" fill={c.borderColor}/>
      <g style={{pointerEvents:"all",cursor:"move"}} onMouseDown={onBoxMouseDown}>
        <rect x={c.boxX} y={c.boxY} width={w} height={h} fill={c.bgColor} stroke={c.borderColor} strokeWidth="1.5" rx="3"/>
        {lines.map((line,i)=>(
          <text key={i} x={c.boxX+10} y={c.boxY+16+i*18} fontSize="12" fontFamily="Arial" fontWeight="600" fill={c.borderColor}>{line}</text>
        ))}
      </g>
    </svg>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Sec({title,children}){ return <div className="sec"><div className="sec-title">{title}</div>{children}</div>; }
function Field({label,children}){ return <div className="field"><div className="field-label">{label}</div>{children}</div>; }
function Toggle({label,checked,onChange}){
  return(
    <label className="toggle-row" onClick={()=>onChange(!checked)}>
      <span className={`toggle-track${checked?" on":""}`}><span className="toggle-thumb"/></span>
      <span>{label}</span>
    </label>
  );
}

function LayerCard({l,idx,total,onUpdate,onToggle,onRemove,onMove}){
  const [open,setOpen]=useState(false);
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
              <input type="range" min="3" max="20" step="1" value={l.pointRadius} onChange={e=>onUpdate({pointRadius:e.target.value})}/>
            </Field>
            <div className="label-section">
              <Toggle label="Show feature labels" checked={l.showLabels} onChange={v=>onUpdate({showLabels:v})}/>
              {l.showLabels&&l.propKeys.length>0&&(
                <Field label="Label field">
                  <select value={l.labelField} onChange={e=>onUpdate({labelField:e.target.value})}>
                    {l.propKeys.map(k=><option key={k} value={k}>{k}</option>)}
                  </select>
                </Field>
              )}
            </div>
          </>}
          <Toggle label="Include in legend" checked={l.includeInLegend} onChange={v=>onUpdate({includeInLegend:v})}/>
        </div>
      )}
    </div>
  );
}
