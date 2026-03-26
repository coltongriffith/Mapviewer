import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import shp from "shpjs";

// ─── Constants ────────────────────────────────────────────────────────────────
const MARKER_TYPES = [
  { value: "circle",    label: "Circle" },
  { value: "drillhole", label: "Drillhole ▼" },
  { value: "diamond",   label: "Diamond" },
  { value: "square",    label: "Square" },
  { value: "triangle",  label: "Triangle ▲" },
];

const FILL_PATTERNS = [
  { value: "solid",      label: "Solid" },
  { value: "hatch",      label: "Hatch ////" },
  { value: "crosshatch", label: "Crosshatch ####" },
  { value: "dots",       label: "Dots ···" },
  { value: "none",       label: "No fill" },
];

const DRAW_MODES = ["none","circle","rectangle","polygon","line"];

// ─── Marker icon factory ──────────────────────────────────────────────────────
function makeMarkerIcon(type, color, size = 14) {
  const s = size, h = s / 2;
  let inner = "";
  if (type === "circle")         inner = `<circle cx="${h}" cy="${h}" r="${h-1.5}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
  else if (type === "drillhole") inner = `<polygon points="${h},${s-1} 1,1 ${s-1},1" fill="${color}" stroke="#fff" stroke-width="1"/><line x1="${h}" y1="0" x2="${h}" y2="${s}" stroke="${color}" stroke-width="2"/>`;
  else if (type === "diamond")   inner = `<polygon points="${h},1 ${s-1},${h} ${h},${s-1} 1,${h}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
  else if (type === "square")    inner = `<rect x="2" y="2" width="${s-4}" height="${s-4}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
  else if (type === "triangle")  inner = `<polygon points="${h},1 ${s-1},${s-1} 1,${s-1}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${inner}</svg>`)}`,
    iconSize:[s,s], iconAnchor:[h,h], popupAnchor:[0,-h-2],
  });
}

function markerSvgUrl(type, color, size = 16) {
  const s = size, h = s / 2;
  let inner = "";
  if (type === "circle")         inner = `<circle cx="${h}" cy="${h}" r="${h-1.5}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  else if (type === "drillhole") inner = `<polygon points="${h},${s-2} 2,2 ${s-2},2" fill="${color}" stroke="#444" stroke-width="1"/><line x1="${h}" y1="0" x2="${h}" y2="${s}" stroke="${color}" stroke-width="1.5"/>`;
  else if (type === "diamond")   inner = `<polygon points="${h},1 ${s-1},${h} ${h},${s-1} 1,${h}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  else if (type === "square")    inner = `<rect x="2" y="2" width="${s-4}" height="${s-4}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  else if (type === "triangle")  inner = `<polygon points="${h},1 ${s-1},${s-1} 1,${s-1}" fill="${color}" stroke="#444" stroke-width="1"/>`;
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
    const parts = line.split(",");
    const props = {};
    headers.forEach((h,i) => { props[h] = parts[i]?.trim(); });
    return { type:"Feature", geometry:{ type:"Point", coordinates:[+parts[lngIdx],+parts[latIdx]] }, properties:props };
  });
  return { type:"FeatureCollection", features };
}

function isPointLayer(geojson) {
  const features = geojson.features ?? (Array.isArray(geojson) ? geojson.flatMap(g => g.features??[]) : []);
  if (!features.length) return false;
  return features.filter(f => f.geometry?.type==="Point"||f.geometry?.type==="MultiPoint").length / features.length > 0.5;
}

function getPropertyKeys(geojson) {
  const features = geojson.features ?? (Array.isArray(geojson) ? geojson.flatMap(g => g.features??[]) : []);
  const keys = new Set();
  features.slice(0,20).forEach(f => Object.keys(f.properties??{}).forEach(k => keys.add(k)));
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

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const mapRef        = useRef(null);
  const containerRef  = useRef(null);
  const drawStateRef  = useRef({ mode:"none", points:[], layer:null });

  const [layers,        setLayers]        = useState([]);
  const [title,         setTitle]         = useState("RIFT PROJECT");
  const [subtitle,      setSubtitle]      = useState("Nebraska");
  const [logo,          setLogo]          = useState(null);
  const [northArrow,    setNorthArrow]    = useState(true);
  const [showLegend,    setShowLegend]    = useState(true);

  // Inset — upload only
  const [showInset,     setShowInset]     = useState(true);
  const [insetImage,    setInsetImage]    = useState(null);

  // Annotations (plain boxes)
  const [annotations,   setAnnotations]   = useState([]);
  const [annotText,     setAnnotText]     = useState("");
  const [annotColor,    setAnnotColor]    = useState("#0a2c78");
  const [placingAnnot,  setPlacingAnnot]  = useState(false);

  // Callout boxes (with leader lines)
  const [callouts,      setCallouts]      = useState([]);
  const [calloutText,   setCalloutText]   = useState("");
  const [calloutColor,  setCalloutColor]  = useState("#ffffff");
  const [calloutBorder, setCalloutBorder] = useState("#1a3a6b");
  const [placingCallout,setPlacingCallout]= useState(false);

  // Curved text
  const [curvedLabels,  setCurvedLabels]  = useState([]);
  const [curvedText,    setCurvedText]    = useState("");
  const [curvedColor,   setCurvedColor]   = useState("#111111");
  const [curvedSize,    setCurvedSize]    = useState(18);
  const [placingCurved, setPlacingCurved] = useState(false); // "p1"|"p2"|false
  const curvedTempRef = useRef(null);

  // Draw tools
  const [drawMode,      setDrawMode]      = useState("none");
  const [drawColor,     setDrawColor]     = useState("#e63946");
  const [drawFill,      setDrawFill]      = useState("#e63946");
  const [drawOpacity,   setDrawOpacity]   = useState(0.25);

  // Image overlay
  const [imageOverlays, setImageOverlays] = useState([]);
  const [overlayImage,  setOverlayImage]  = useState(null);
  const [placingOverlay,setPlacingOverlay]= useState(false); // "p1"|"p2"|false
  const overlayTempRef  = useRef({ p1:null });

  const [exportStatus,  setExportStatus]  = useState("idle");

  // ── Map init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([40,-96],5);
    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM",maxZoom:19});
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{attribution:"Esri",maxZoom:19});
    sat.addTo(map);
    map._baseLayers={osm,sat}; map._activeBase=sat;
    L.control.scale({imperial:false}).addTo(map);
    mapRef.current=map;
    setTimeout(()=>map.invalidateSize(),100);
    return ()=>{ if(mapRef.current){mapRef.current.remove();mapRef.current=null;} };
  },[]);

  // ── Unified map click handler ─────────────────────────────────────────────
  useEffect(()=>{
    const map = mapRef.current; if(!map) return;
    const el = map.getContainer();

    const onClick = (e) => {
      const latlng = e.latlng;
      const rect   = containerRef.current.getBoundingClientRect();
      const px     = { x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top };

      // ── Plain annotation ──
      if (placingAnnot) {
        setAnnotations(p=>[...p,{ id:crypto.randomUUID(), text:annotText.trim()||"Label", color:annotColor, x:px.x, y:px.y }]);
        setAnnotText(""); setPlacingAnnot(false); el.style.cursor=""; return;
      }

      // ── Callout (leader line) ──
      if (placingCallout) {
        setCallouts(p=>[...p,{
          id:crypto.randomUUID(), text:calloutText.trim()||"Label",
          color:calloutColor, border:calloutBorder,
          pinX:px.x, pinY:px.y,
          boxX:px.x+20, boxY:px.y-60,
        }]);
        setCalloutText(""); setPlacingCallout(false); el.style.cursor=""; return;
      }

      // ── Curved text — pick p1 then p2 ──
      if (placingCurved === "p1") {
        curvedTempRef.current = { p1:latlng };
        setPlacingCurved("p2"); return;
      }
      if (placingCurved === "p2") {
        const p1 = curvedTempRef.current.p1;
        setCurvedLabels(prev=>[...prev,{
          id:crypto.randomUUID(), text:curvedText, color:curvedColor, size:curvedSize,
          p1, p2:latlng,
        }]);
        setPlacingCurved(false); el.style.cursor=""; curvedTempRef.current=null; return;
      }

      // ── Image overlay — pick NW then SE corners ──
      if (placingOverlay === "p1") {
        overlayTempRef.current.p1 = latlng;
        setPlacingOverlay("p2"); return;
      }
      if (placingOverlay === "p2") {
        const p1 = overlayTempRef.current.p1;
        const bounds = L.latLngBounds(p1, latlng);
        const id = crypto.randomUUID();
        const leafLayer = L.imageOverlay(overlayImage, bounds, { opacity:0.8, interactive:false });
        leafLayer.addTo(map);
        setImageOverlays(prev=>[...prev,{ id, src:overlayImage, bounds, opacity:0.8, leafLayer, visible:true, name:"Image overlay" }]);
        setOverlayImage(null); setPlacingOverlay(false); el.style.cursor=""; return;
      }

      // ── Draw tools ──
      if (drawMode === "none") return;
      const ds = drawStateRef.current;

      if (drawMode === "circle") {
        if (ds.points.length === 0) {
          ds.points = [latlng];
          ds.center = latlng;
        } else {
          const radius = ds.center.distanceTo(latlng);
          if (ds.layer) map.removeLayer(ds.layer);
          const drawn = L.circle(ds.center, {
            radius, color:drawColor, weight:2,
            fill:true, fillColor:drawFill, fillOpacity:drawOpacity,
          }).addTo(map);
          addDrawnLayer(drawn, "circle", null);
          ds.points=[]; ds.layer=null;
        }
        return;
      }

      if (drawMode === "rectangle") {
        if (ds.points.length === 0) {
          ds.points = [latlng];
        } else {
          const drawn = L.rectangle(L.latLngBounds(ds.points[0], latlng),{
            color:drawColor, weight:2, fill:true, fillColor:drawFill, fillOpacity:drawOpacity,
          }).addTo(map);
          addDrawnLayer(drawn,"rectangle",null);
          ds.points=[];
        }
        return;
      }

      if (drawMode === "polygon" || drawMode === "line") {
        ds.points.push(latlng);
        if (ds.layer) map.removeLayer(ds.layer);
        if (drawMode==="polygon" && ds.points.length>2) {
          ds.layer = L.polygon(ds.points,{ color:drawColor, weight:2, fill:true, fillColor:drawFill, fillOpacity:drawOpacity, dashArray:"" }).addTo(map);
        } else if (drawMode==="line") {
          ds.layer = L.polyline(ds.points,{ color:drawColor, weight:2 }).addTo(map);
        }
        return;
      }
    };

    const onDblClick = (e) => {
      const ds = drawStateRef.current;
      if ((drawMode==="polygon"||drawMode==="line") && ds.points.length>=2) {
        L.DomEvent.stopPropagation(e);
        if (ds.layer) map.removeLayer(ds.layer);
        const drawn = drawMode==="polygon"
          ? L.polygon(ds.points,{ color:drawColor, weight:2, fill:true, fillColor:drawFill, fillOpacity:drawOpacity })
          : L.polyline(ds.points,{ color:drawColor, weight:2 });
        drawn.addTo(map);
        addDrawnLayer(drawn,drawMode,null);
        ds.points=[]; ds.layer=null;
      }
    };

    map.on("click",onClick);
    map.on("dblclick",onDblClick);

    // Cursor
    const anyPlacing = placingAnnot||placingCallout||placingCurved||placingOverlay||drawMode!=="none";
    el.style.cursor = anyPlacing ? "crosshair" : "";

    return ()=>{ map.off("click",onClick); map.off("dblclick",onDblClick); el.style.cursor=""; };
  },[placingAnnot,annotText,annotColor,
     placingCallout,calloutText,calloutColor,calloutBorder,
     placingCurved,curvedText,curvedColor,curvedSize,
     placingOverlay,overlayImage,
     drawMode,drawColor,drawFill,drawOpacity]);

  // ── Drawn shape → layer state ─────────────────────────────────────────────
  const addDrawnLayer = useCallback((leafLayer, type, geojson) => {
    const id = crypto.randomUUID();
    setLayers(p=>[...p,{
      id, name:`Drawn ${type}`, layer:leafLayer, _geojson:geojson,
      visible:true, isPoint:false, isDrawn:true,
      color:drawColor, fillColor:drawFill, fillOpacity:drawOpacity,
      fillPattern:"solid", weight:2, layerOpacity:1,
      legendLabel:`Drawn ${type}`, includeInLegend:true,
      propKeys:[], showLabels:false, labelField:"",
    }]);
  },[drawColor,drawFill,drawOpacity]);

  // ── GeoJSON layer builder ─────────────────────────────────────────────────
  const buildLeafletLayer = useCallback((geojson, cfg) => {
    const map = mapRef.current; if(!map) return null;
    let fillStyle = {};
    if (cfg.fillPattern==="none")  fillStyle={ fill:false, fillOpacity:0 };
    else if (cfg.fillPattern==="solid") fillStyle={ fill:true, fillColor:cfg.fillColor, fillOpacity:+cfg.fillOpacity };
    else fillStyle={ fill:true, fillColor:cfg.fillColor, fillOpacity:+cfg.fillOpacity*0.4 };

    return L.geoJSON(geojson,{
      style:()=>({ color:cfg.color, weight:+cfg.weight, opacity:+cfg.layerOpacity, ...fillStyle }),
      pointToLayer:(_,latlng)=>L.marker(latlng,{ icon:makeMarkerIcon(cfg.markerType,cfg.markerColor,+cfg.pointRadius*2), opacity:+cfg.layerOpacity }),
      onEachFeature:(feature,l)=>{
        const p=feature.properties||{};
        l.bindPopup(Object.keys(p).length
          ? `<pre style="margin:0;font-size:11px;max-width:260px;overflow:auto">${escapeHtml(JSON.stringify(p,null,2))}</pre>`
          : "No attributes");
        if(cfg.showLabels&&cfg.labelField&&p[cfg.labelField]!=null){
          l.bindTooltip(String(p[cfg.labelField]),{ permanent:true, direction:"right", className:"mv-label", offset:[10,0] });
        }
      },
    });
  },[]);

  const reRenderLayer = useCallback((item,patch)=>{
    const map=mapRef.current; if(!map) return item;
    const u={...item,...patch};
    if(item.layer) map.removeLayer(item.layer);
    if(u.isDrawn) return u; // drawn shapes re-style in place
    const newLayer=buildLeafletLayer(u._geojson,u);
    if(newLayer&&u.visible) newLayer.addTo(map);
    return {...u,layer:newLayer};
  },[buildLeafletLayer]);

  const RERENDER=new Set(["color","fillColor","fillOpacity","fillPattern","weight","pointRadius","markerType","markerColor","layerOpacity","showLabels","labelField"]);

  const addLayer = useCallback((geojson,name)=>{
    const map=mapRef.current; if(!map) return;
    const propKeys=getPropertyKeys(geojson);
    const isPoint=isPointLayer(geojson);
    const cfg={
      id:crypto.randomUUID(), name, _geojson:geojson, visible:true, isPoint, isDrawn:false,
      color:"#4e8cff", fillColor:"#4e8cff", fillOpacity:0.35, fillPattern:"solid",
      weight:2, pointRadius:7, markerType:"drillhole", markerColor:"#111111",
      layerOpacity:1, showLabels:false, labelField:propKeys[0]??"",
      propKeys, legendLabel:name, includeInLegend:true,
    };
    const layer=buildLeafletLayer(geojson,cfg);
    if(!layer) return;
    layer.addTo(map);
    try{ const b=layer.getBounds(); if(b.isValid()) map.fitBounds(b,{padding:[20,20]}); }catch{}
    setLayers(p=>[...p,{...cfg,layer}]);
  },[buildLeafletLayer]);

  const handleFile = async(file)=>{
    if(!file) return;
    try{
      if(file.name.endsWith(".zip"))    { addLayer(await shp(await file.arrayBuffer()),file.name.replace(".zip","")); return; }
      if(file.name.endsWith(".geojson")||file.name.endsWith(".json")) { addLayer(JSON.parse(await file.text()),file.name); return; }
      if(file.name.endsWith(".csv"))    { addLayer(csvToGeoJSON(await file.text()),file.name.replace(".csv","")); return; }
      alert("Supported: .zip, .geojson, .json, .csv");
    }catch(err){ console.error(err); alert(`Import failed: ${err.message}`); }
  };

  const updateLayer = useCallback((id,patch)=>{
    const needsRerender=Object.keys(patch).some(k=>RERENDER.has(k));
    setLayers(p=>p.map(item=>{
      if(item.id!==id) return item;
      if(needsRerender) return reRenderLayer(item,patch);
      // For drawn layers, update style in place
      if(item.isDrawn&&item.layer){
        const u={...item,...patch};
        item.layer.setStyle?.({ color:u.color,weight:+u.weight,fillColor:u.fillColor,fillOpacity:+u.fillOpacity,opacity:+u.layerOpacity });
        return u;
      }
      return {...item,...patch};
    }));
  },[reRenderLayer]);

  const toggleLayer=(id)=>{
    const map=mapRef.current;
    setLayers(p=>p.map(item=>{ if(item.id!==id) return item; if(item.visible) map.removeLayer(item.layer); else item.layer?.addTo(map); return{...item,visible:!item.visible}; }));
  };
  const removeLayer=(id)=>{
    const map=mapRef.current;
    setLayers(p=>{ const t=p.find(l=>l.id===id); if(t) map?.removeLayer(t.layer); return p.filter(l=>l.id!==id); });
  };
  const moveLayer=(id,dir)=>{
    setLayers(p=>{
      const idx=p.findIndex(l=>l.id===id); if(idx<0) return p;
      const ni=idx+dir; if(ni<0||ni>=p.length) return p;
      const next=[...p]; [next[idx],next[ni]]=[next[ni],next[idx]];
      const map=mapRef.current;
      if(map) next.forEach(item=>{ if(item.visible&&item.layer){ map.removeLayer(item.layer); item.layer.addTo(map); } });
      return next;
    });
  };

  // Image overlay controls
  const updateOverlayOpacity=(id,opacity)=>{
    setImageOverlays(p=>p.map(o=>{ if(o.id!==id) return o; o.leafLayer.setOpacity(opacity); return{...o,opacity}; }));
  };
  const toggleOverlay=(id)=>{
    const map=mapRef.current;
    setImageOverlays(p=>p.map(o=>{ if(o.id!==id) return o; if(o.visible) map.removeLayer(o.leafLayer); else o.leafLayer.addTo(map); return{...o,visible:!o.visible}; }));
  };
  const removeOverlay=(id)=>{
    const map=mapRef.current;
    setImageOverlays(p=>{ const t=p.find(o=>o.id===id); if(t) map?.removeLayer(t.leafLayer); return p.filter(o=>o.id!==id); });
  };

  const fitAll=()=>{
    const map=mapRef.current; if(!map) return;
    const vis=layers.filter(l=>l.visible&&l.layer).map(l=>l.layer);
    if(!vis.length) return;
    try{ const b=L.featureGroup(vis).getBounds(); if(b.isValid()) map.fitBounds(b,{padding:[20,20]}); }catch{}
  };

  const switchBase=(type)=>{
    const map=mapRef.current; if(!map) return;
    const {osm,sat}=map._baseLayers;
    if(map._activeBase) map.removeLayer(map._activeBase);
    const next=type==="osm"?osm:sat; next.addTo(map); map._activeBase=next;
  };

  // ── Export — fixed centering ──────────────────────────────────────────────
  const doExport = async(format)=>{
    setExportStatus("working");
    try{
      const scripts=[loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js")];
      if(format==="pdf") scripts.push(loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"));
      await Promise.all(scripts);

      // Freeze map — scroll to top, hide sidebar temporarily
      window.scrollTo(0,0);
      const sidebar=document.querySelector(".sidebar");
      const mapSide=document.querySelector(".map-side");
      const origSidebarDisplay=sidebar.style.display;
      sidebar.style.display="none";
      mapSide.style.width="100vw";

      const map=mapRef.current;
      map.invalidateSize();
      await new Promise(r=>setTimeout(r,400)); // let map reflow

      // Wait for tiles
      await new Promise(resolve=>{
        let pending=0;
        document.querySelectorAll(".leaflet-tile-container img").forEach(img=>{ if(!img.complete) pending++; });
        if(!pending) return resolve();
        let done=0;
        document.querySelectorAll(".leaflet-tile-container img").forEach(img=>{
          if(!img.complete){
            const cb=()=>{ done++; if(done>=pending) resolve(); };
            img.addEventListener("load",cb,{once:true});
            img.addEventListener("error",cb,{once:true});
          }
        });
        setTimeout(resolve,4000);
      });

      const surface=document.querySelector(".export-surface");
      const canvas=await window.html2canvas(surface,{
        useCORS:true, allowTaint:true, scale:2, logging:false,
        backgroundColor:"#ffffff", imageTimeout:15000,
        onclone:(doc)=>{
          // Fix Leaflet pane transforms in clone so layers align
          doc.querySelectorAll(".leaflet-map-pane,.leaflet-tile-pane,.leaflet-overlay-pane,.leaflet-shadow-pane,.leaflet-marker-pane,.leaflet-tooltip-pane,.leaflet-popup-pane").forEach(el=>{
            const t=el.style.transform;
            if(t&&t.includes("translate")){
              const m=t.match(/translate\(([^,]+),\s*([^)]+)\)/);
              if(m){ el.style.transform="none"; el.style.left=(parseFloat(m[1])||0)+"px"; el.style.top=(parseFloat(m[2])||0)+"px"; }
            }
          });
          // Make SVG overlays visible
          doc.querySelectorAll(".leaflet-overlay-pane svg").forEach(el=>{ el.style.visibility="visible"; el.style.display="block"; });
        },
      });

      // Restore sidebar
      sidebar.style.display=origSidebarDisplay;
      mapSide.style.width="";
      map.invalidateSize();

      if(format==="png"){
        const a=document.createElement("a");
        a.download=`${title.toLowerCase().replace(/\s+/g,"-")}-map.png`;
        a.href=canvas.toDataURL("image/png"); a.click();
      } else {
        const W=surface.offsetWidth, H=surface.offsetHeight;
        const {jsPDF}=window.jspdf;
        const pdf=new jsPDF({orientation:W>H?"landscape":"portrait",unit:"px",format:[W,H]});
        pdf.addImage(canvas.toDataURL("image/png"),"PNG",0,0,W,H);
        pdf.save(`${title.toLowerCase().replace(/\s+/g,"-")}-map.pdf`);
      }
      setExportStatus("done");
    }catch(err){
      console.error(err); setExportStatus("error");
      alert("Export failed. Switch to 🗺 Street basemap — satellite tiles block cross-origin capture.");
    }finally{ setTimeout(()=>setExportStatus("idle"),3000); }
  };

  // ── Render curved labels as SVG overlay ──────────────────────────────────
  const renderCurvedLabels=()=>{
    const map=mapRef.current; if(!map||!curvedLabels.length) return null;
    return curvedLabels.map(cl=>{
      try{
        const p1=map.latLngToContainerPoint(cl.p1);
        const p2=map.latLngToContainerPoint(cl.p2);
        const mx=(p1.x+p2.x)/2, my=(p1.y+p2.y)/2;
        const dx=p2.x-p1.x, dy=p2.y-p1.y;
        const len=Math.sqrt(dx*dx+dy*dy);
        const cx=mx-dy*0.3, cy=my+dx*0.3;
        const pathId=`cp-${cl.id}`;
        return(
          <svg key={cl.id} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:1000}} xmlns="http://www.w3.org/2000/svg">
            <defs>
              <path id={pathId} d={`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`}/>
            </defs>
            <text fill={cl.color} fontSize={cl.size} fontFamily="Arial" fontWeight="700" letterSpacing="1">
              <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">{cl.text}</textPath>
            </text>
          </svg>
        );
      }catch{ return null; }
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return(
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header"><span className="app-wordmark">◈ Mapviewer</span></div>

        <Sec title="Import GIS Data">
          <label className="file-drop">
            <input type="file" accept=".zip,.geojson,.json,.csv" onChange={e=>handleFile(e.target.files?.[0])}/>
            <span className="file-drop-hint">Click or drop file<br/><small>.zip · .geojson · .json · .csv</small></span>
          </label>
        </Sec>

        <Sec title="Map Labels">
          <Field label="Title"><input value={title} onChange={e=>setTitle(e.target.value)}/></Field>
          <Field label="Subtitle"><input value={subtitle} onChange={e=>setSubtitle(e.target.value)}/></Field>
        </Sec>

        <Sec title="Branding">
          <Field label="Logo"><input type="file" accept="image/*" onChange={e=>loadImageFile(e.target.files?.[0],setLogo)}/></Field>
          {logo&&<button className="btn-ghost" onClick={()=>setLogo(null)}>✕ Remove logo</button>}
        </Sec>

        <Sec title="Basemap">
          <div className="row2">
            <button className="btn" onClick={()=>switchBase("sat")}>🛰 Satellite</button>
            <button className="btn" onClick={()=>switchBase("osm")}>🗺 Street</button>
          </div>
          <div className="export-note" style={{marginTop:6}}>Use Street basemap for best export results</div>
        </Sec>

        <Sec title="Overlays">
          <Toggle label="North Arrow" checked={northArrow} onChange={setNorthArrow}/>
          <Toggle label="Legend"      checked={showLegend} onChange={setShowLegend}/>
          <Toggle label="Inset Map"   checked={showInset}  onChange={setShowInset}/>
          {showInset&&(
            <div style={{marginTop:8}}>
              <div className="field-label">Upload inset image</div>
              <input type="file" accept="image/*" onChange={e=>loadImageFile(e.target.files?.[0],setInsetImage)}/>
              {insetImage&&<button className="btn-ghost" onClick={()=>setInsetImage(null)}>✕ Remove inset</button>}
            </div>
          )}
        </Sec>

        {/* ── Image overlay (magnetics raster) ── */}
        <Sec title="Image Overlay">
          <div className="field-label">Upload raster (PNG/JPG)</div>
          <input type="file" accept="image/*" onChange={e=>loadImageFile(e.target.files?.[0],setOverlayImage)}/>
          {overlayImage&&!placingOverlay&&(
            <button className="btn btn-placing-outline" style={{marginTop:6,width:"100%"}}
              onClick={()=>setPlacingOverlay("p1")}>
              📌 Click NW corner on map
            </button>
          )}
          {placingOverlay==="p1"&&<div className="place-hint">Click the NW (top-left) corner of the image on the map</div>}
          {placingOverlay==="p2"&&<div className="place-hint">Now click the SE (bottom-right) corner</div>}
          {imageOverlays.length>0&&(
            <div style={{marginTop:10}}>
              {imageOverlays.map(o=>(
                <div key={o.id} className="overlay-row">
                  <span className="layer-card-name">{o.name}</span>
                  <input type="range" min="0" max="1" step="0.05" value={o.opacity}
                    onChange={e=>updateOverlayOpacity(o.id,+e.target.value)} style={{flex:1}}/>
                  <button className="btn-icon-sm" onClick={()=>toggleOverlay(o.id)}>{o.visible?"👁":"🚫"}</button>
                  <button className="btn-icon-sm" onClick={()=>removeOverlay(o.id)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Sec>

        {/* ── Draw tools ── */}
        <Sec title="Draw on Map">
          <div className="draw-tools">
            {["none","circle","rectangle","polygon","line"].map(m=>(
              <button key={m}
                className={`btn draw-btn${drawMode===m?" draw-active":""}`}
                onClick={()=>{ setDrawMode(m); drawStateRef.current={mode:m,points:[],layer:null}; }}
              >
                {m==="none"?"✋ Off":m==="circle"?"⬤ Circle":m==="rectangle"?"▬ Rect":m==="polygon"?"⬠ Poly":"╱ Line"}
              </button>
            ))}
          </div>
          {drawMode!=="none"&&(
            <div style={{marginTop:8}}>
              <div className="draw-hint">
                {drawMode==="circle"&&"Click center, then click edge to set radius"}
                {drawMode==="rectangle"&&"Click two opposite corners"}
                {(drawMode==="polygon"||drawMode==="line")&&"Click points, double-click to finish"}
              </div>
              <div className="color-trio" style={{marginTop:8}}>
                <div><div className="field-label">Stroke</div><input type="color" value={drawColor} onChange={e=>setDrawColor(e.target.value)}/></div>
                <div><div className="field-label">Fill</div><input type="color" value={drawFill} onChange={e=>setDrawFill(e.target.value)}/></div>
                <div><div className="field-label">Opacity</div>
                  <input type="range" min="0" max="1" step="0.05" value={drawOpacity} onChange={e=>setDrawOpacity(+e.target.value)} style={{marginTop:6}}/>
                </div>
              </div>
            </div>
          )}
        </Sec>

        {/* ── Annotations ── */}
        <Sec title="Annotations">
          <div className="annot-tabs">
            <span className="annot-tab-label">Plain box</span>
          </div>
          <Field label="Text">
            <input placeholder="~$1B USD MARKET CAP" value={annotText} onChange={e=>setAnnotText(e.target.value)}/>
          </Field>
          <div className="color-pick-row"><span>Color</span><input type="color" value={annotColor} onChange={e=>setAnnotColor(e.target.value)}/></div>
          <button className={`btn${placingAnnot?" btn-placing":""}`} onClick={()=>setPlacingAnnot(p=>!p)} style={{marginTop:8,width:"100%"}}>
            {placingAnnot?"🎯 Click map to place…":"＋ Place Box"}
          </button>
          {annotations.length>0&&(
            <div className="annot-list">
              {annotations.map(a=>(
                <div key={a.id} className="annot-row">
                  <span className="annot-swatch" style={{background:a.color}}/>
                  <input value={a.text} onChange={e=>setAnnotations(p=>p.map(x=>x.id===a.id?{...x,text:e.target.value}:x))}/>
                  <button className="btn-icon-sm" onClick={()=>setAnnotations(p=>p.filter(x=>x.id!==a.id))}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Sec>

        {/* ── Callout boxes ── */}
        <Sec title="Callout Boxes">
          <Field label="Text (use \\n for line breaks)">
            <input placeholder="NEC11-004&#10;236.19m @ 2.10% REO" value={calloutText} onChange={e=>setCalloutText(e.target.value)}/>
          </Field>
          <div className="color-trio">
            <div><div className="field-label">Background</div><input type="color" value={calloutColor} onChange={e=>setCalloutColor(e.target.value)}/></div>
            <div><div className="field-label">Border</div><input type="color" value={calloutBorder} onChange={e=>setCalloutBorder(e.target.value)}/></div>
          </div>
          <button className={`btn${placingCallout?" btn-placing":""}`} onClick={()=>setPlacingCallout(p=>!p)} style={{marginTop:8,width:"100%"}}>
            {placingCallout?"🎯 Click point on map…":"＋ Place Callout"}
          </button>
          {callouts.length>0&&(
            <div className="annot-list">
              {callouts.map(c=>(
                <div key={c.id} className="annot-row">
                  <span className="annot-swatch" style={{background:c.border,borderRadius:0}}/>
                  <input value={c.text} onChange={e=>setCallouts(p=>p.map(x=>x.id===c.id?{...x,text:e.target.value}:x))}/>
                  <button className="btn-icon-sm" onClick={()=>setCallouts(p=>p.filter(x=>x.id!==c.id))}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Sec>

        {/* ── Curved text ── */}
        <Sec title="Curved Text">
          <Field label="Text">
            <input placeholder="Elk Creek Carbonatite Complex" value={curvedText} onChange={e=>setCurvedText(e.target.value)}/>
          </Field>
          <div className="color-trio">
            <div><div className="field-label">Color</div><input type="color" value={curvedColor} onChange={e=>setCurvedColor(e.target.value)}/></div>
            <div><div className="field-label">Size</div>
              <input type="range" min="10" max="48" step="1" value={curvedSize} onChange={e=>setCurvedSize(+e.target.value)} style={{marginTop:6}}/>
              <div style={{fontSize:10,color:"#4b5a7a",marginTop:2}}>{curvedSize}px</div>
            </div>
          </div>
          <button className={`btn${placingCurved?" btn-placing":""}`}
            onClick={()=>{ if(!curvedText.trim()){alert("Enter text first.");return;} setPlacingCurved("p1"); }}
            style={{marginTop:8,width:"100%"}}>
            {placingCurved==="p1"?"🎯 Click start point…":placingCurved==="p2"?"🎯 Click end point…":"＋ Place Curved Text"}
          </button>
          {curvedLabels.length>0&&(
            <div className="annot-list">
              {curvedLabels.map(cl=>(
                <div key={cl.id} className="annot-row">
                  <span style={{fontSize:11,color:cl.color,fontWeight:700,flexShrink:0}}>A</span>
                  <input value={cl.text} onChange={e=>setCurvedLabels(p=>p.map(x=>x.id===cl.id?{...x,text:e.target.value}:x))}/>
                  <button className="btn-icon-sm" onClick={()=>setCurvedLabels(p=>p.filter(x=>x.id!==cl.id))}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Sec>

        <Sec title="Export">
          <button className="btn" onClick={fitAll} style={{width:"100%",marginBottom:6}}>Fit All Layers</button>
          <div className="row2">
            <button className={`btn btn-export${exportStatus==="done"?" btn-export-done":""}`} onClick={()=>doExport("png")} disabled={exportStatus==="working"}>
              {exportStatus==="working"?"…":"PNG"}
            </button>
            <button className={`btn btn-export${exportStatus==="done"?" btn-export-done":""}`} onClick={()=>doExport("pdf")} disabled={exportStatus==="working"}>
              {exportStatus==="working"?"…":"PDF"}
            </button>
          </div>
          <div className="export-note">PDF opens in Illustrator / Acrobat for editing</div>
        </Sec>

        <Sec title={`Layers${layers.length?` (${layers.length})`:""}`}>
          {layers.length===0
            ?<div className="empty-hint">No layers yet. Import or draw above.</div>
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

      {/* ── Map surface ── */}
      <div className="map-side export-surface">
        <div className="title-block">
          <div className="title-main">{title}</div>
          <div className="title-sub">{subtitle}</div>
        </div>

        {logo&&<img src={logo} alt="Logo" className="logo-block"/>}

        {northArrow&&(
          <div className="north-arrow">
            <svg viewBox="0 0 40 58" width="36" height="52">
              <polygon points="20,2 27,28 20,23 13,28" fill="#111"/>
              <polygon points="20,54 27,28 20,33 13,28" fill="#eee" stroke="#111" strokeWidth="0.8"/>
              <text x="20" y="53" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#111" fontFamily="Arial">N</text>
            </svg>
          </div>
        )}

        {showInset&&insetImage&&(
          <div className="inset-map" style={{overflow:"hidden",padding:0}}>
            <img src={insetImage} alt="Inset" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
          </div>
        )}
        {showInset&&!insetImage&&(
          <div className="inset-map inset-empty">
            <span>Upload inset image in sidebar</span>
          </div>
        )}

        <div ref={containerRef} id="map"/>

        {/* Curved text SVG layer — re-renders on map move */}
        <MapMoveRenderer mapRef={mapRef} render={renderCurvedLabels}/>

        {/* Callout boxes with leader lines */}
        {callouts.map(c=>(
          <CalloutBox key={c.id} c={c} onChange={patch=>setCallouts(p=>p.map(x=>x.id===c.id?{...x,...patch}:x))}/>
        ))}

        {/* Plain annotation boxes */}
        {annotations.map(a=>(
          <div key={a.id} className="annotation-box" style={{left:a.x,top:a.y,background:a.color}}>
            {a.text}
          </div>
        ))}

        {showLegend&&layers.some(l=>l.includeInLegend)&&(
          <div className="legend-block">
            {layers.filter(l=>l.includeInLegend).map(l=>(
              <div key={l.id} className="legend-row">
                {l.isPoint
                  ?<img src={markerSvgUrl(l.markerType,l.markerColor,16)} width="16" height="16" style={{flexShrink:0}} alt=""/>
                  :<span className="legend-swatch" style={{background:l.fillColor,opacity:l.fillOpacity,border:`${Math.max(1,l.weight)}px solid ${l.color}`}}/>
                }
                <span>{l.legendLabel}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Callout box component ─────────────────────────────────────────────────────
function CalloutBox({ c, onChange }) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);

  const onMouseDown = (e) => {
    e.preventDefault();
    const startX = e.clientX - c.boxX;
    const startY = e.clientY - c.boxY;
    const onMove = (ev) => onChange({ boxX: ev.clientX - startX, boxY: ev.clientY - startY });
    const onUp   = () => { window.removeEventListener("mousemove",onMove); window.removeEventListener("mouseup",onUp); };
    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
  };

  const lines = c.text.replace(/\\n/g,"\n").split("\n");
  const w = Math.max(...lines.map(l=>l.length)) * 8 + 20;

  return (
    <svg style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:1001}} xmlns="http://www.w3.org/2000/svg">
      {/* Leader line */}
      <line x1={c.pinX} y1={c.pinY} x2={c.boxX+w/2} y2={c.boxY+lines.length*18+8}
        stroke={c.border} strokeWidth="1.5" strokeDasharray="4,2"/>
      {/* Pin dot */}
      <circle cx={c.pinX} cy={c.pinY} r="4" fill={c.border}/>
      {/* Box — pointer-events on this g only */}
      <g style={{pointerEvents:"all",cursor:"move"}} onMouseDown={onMouseDown}>
        <rect x={c.boxX} y={c.boxY} width={w} height={lines.length*18+12}
          fill={c.color} stroke={c.border} strokeWidth="1.5" rx="3"/>
        {lines.map((line,i)=>(
          <text key={i} x={c.boxX+10} y={c.boxY+16+i*18}
            fontSize="12" fontFamily="Arial" fontWeight="600" fill={c.border}>
            {line}
          </text>
        ))}
      </g>
    </svg>
  );
}

// ── Re-render trigger for curved text (needs map reprojection on move) ────────
function MapMoveRenderer({ mapRef, render }) {
  const [, forceUpdate] = useState(0);
  useEffect(()=>{
    const map=mapRef.current; if(!map) return;
    const fn=()=>forceUpdate(n=>n+1);
    map.on("move zoom moveend zoomend",fn);
    return ()=>map.off("move zoom moveend zoomend",fn);
  },[mapRef]);
  return <>{render()}</>;
}

// ── Sub-components ────────────────────────────────────────────────────────────
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
          <Field label={`Layer opacity — ${Math.round(+l.layerOpacity*100)}%`}>
            <input type="range" min="0" max="1" step="0.05" value={l.layerOpacity} onChange={e=>onUpdate({layerOpacity:e.target.value})}/>
          </Field>
          <div className="color-trio">
            <div><div className="field-label">Stroke</div><input type="color" value={l.color} onChange={e=>onUpdate({color:e.target.value})}/></div>
            <div><div className="field-label">Fill</div><input type="color" value={l.fillColor} onChange={e=>onUpdate({fillColor:e.target.value})}/></div>
            {l.isPoint&&<div><div className="field-label">Marker</div><input type="color" value={l.markerColor} onChange={e=>onUpdate({markerColor:e.target.value})}/></div>}
          </div>
          <Field label="Fill pattern">
            <select value={l.fillPattern} onChange={e=>onUpdate({fillPattern:e.target.value})}>
              {FILL_PATTERNS.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
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
