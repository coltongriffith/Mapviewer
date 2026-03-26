import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import shp from "shpjs";

// ─── Marker symbol renderer ───────────────────────────────────────────────────
const MARKER_TYPES = [
  { value: "circle",    label: "Circle" },
  { value: "drillhole", label: "Drillhole ▼" },
  { value: "diamond",   label: "Diamond" },
  { value: "square",    label: "Square" },
  { value: "triangle",  label: "Triangle ▲" },
];

function makeMarkerIcon(type, color, size = 14) {
  const s = size;
  const h = s / 2;
  let inner = "";
  if (type === "circle") {
    inner = `<circle cx="${h}" cy="${h}" r="${h - 1.5}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
  } else if (type === "drillhole") {
    inner = `<polygon points="${h},${s-1} 1,1 ${s-1},1" fill="${color}" stroke="#fff" stroke-width="1"/>
             <line x1="${h}" y1="0" x2="${h}" y2="${s}" stroke="${color}" stroke-width="2"/>`;
  } else if (type === "diamond") {
    inner = `<polygon points="${h},1 ${s-1},${h} ${h},${s-1} 1,${h}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
  } else if (type === "square") {
    inner = `<rect x="2" y="2" width="${s-4}" height="${s-4}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
  } else if (type === "triangle") {
    inner = `<polygon points="${h},1 ${s-1},${s-1} 1,${s-1}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${inner}</svg>`;
  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
    iconSize: [s, s], iconAnchor: [h, h], popupAnchor: [0, -h - 2],
  });
}

function escapeXml(v) {
  return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&apos;");
}
function escapeHtml(v) {
  return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
function loadImageFile(file, setter) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => setter(r.result);
  r.readAsDataURL(file);
}

// BUG FIX: original split on literal "\\n" — fixed to real newline regex
function csvToGeoJSON(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.trim());
  const latIdx = headers.findIndex((h) => /^lat(itude)?$/i.test(h));
  const lngIdx = headers.findIndex((h) => /^lo?n(gitude|g)?$/i.test(h));
  if (latIdx < 0 || lngIdx < 0) throw new Error("CSV must include lat and lon/lng columns.");
  const features = lines.slice(1).filter(Boolean).map((line) => {
    const parts = line.split(",");
    const props = {};
    headers.forEach((h, i) => { props[h] = parts[i]?.trim(); });
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [+parts[lngIdx], +parts[latIdx]] },
      properties: props,
    };
  });
  return { type: "FeatureCollection", features };
}

function InsetMap({ mainMapRef }) {
  const elRef = useRef(null);
  const imapRef = useRef(null);
  const rectRef = useRef(null);

  useEffect(() => {
    if (!elRef.current || imapRef.current) return;

    const imap = L.map(elRef.current, {
      zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false, touchZoom: false,
    }).setView([40, -96], 3);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 10 }).addTo(imap);
    imapRef.current = imap;

    const sync = () => {
      const main = mainMapRef.current;
      if (!main) return;
      const bounds = main.getBounds();
      if (rectRef.current) imap.removeLayer(rectRef.current);
      rectRef.current = L.rectangle(bounds, {
        color: "#e63946", weight: 2, fill: true, fillOpacity: 0.18,
      }).addTo(imap);
      try { imap.fitBounds(bounds.pad(4), { animate: false }); } catch {}
    };

    const main = mainMapRef.current;
    if (main) { main.on("moveend zoomend", sync); sync(); }

    return () => {
      const m = mainMapRef.current;
      if (m) m.off("moveend zoomend", sync);
      imap.remove();
      imapRef.current = null;
    };
  }, [mainMapRef]);

  return <div ref={elRef} className="inset-map" />;
}

export default function App() {
  const mapRef       = useRef(null);
  const containerRef = useRef(null);

  const [layers,       setLayers]       = useState([]);
  const [title,        setTitle]        = useState("RIFT PROJECT");
  const [subtitle,     setSubtitle]     = useState("Nebraska");
  const [logo,         setLogo]         = useState(null);
  const [northArrow,   setNorthArrow]   = useState(true);
  const [showLegend,   setShowLegend]   = useState(true);
  const [showInset,    setShowInset]    = useState(true);
  const [annotations,  setAnnotations]  = useState([]);
  const [annotText,    setAnnotText]    = useState("");
  const [annotColor,   setAnnotColor]   = useState("#0a2c78");
  const [placingAnnot, setPlacingAnnot] = useState(false);
  const [exporting,    setExporting]    = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([40, -96], 5);
    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OSM", maxZoom: 19 });
    const sat = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Esri", maxZoom: 19 }
    );
    sat.addTo(map);
    map._baseLayers = { osm, sat };
    map._activeBase = sat;
    L.control.scale({ imperial: false }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const el = map.getContainer();

    const handler = (e) => {
      if (!placingAnnot) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.originalEvent.clientX - rect.left;
      const y = e.originalEvent.clientY - rect.top;
      setAnnotations((p) => [
        ...p,
        { id: crypto.randomUUID(), text: annotText.trim() || "Label", color: annotColor, x, y },
      ]);
      setAnnotText("");
      setPlacingAnnot(false);
      el.style.cursor = "";
    };

    map.on("click", handler);
    el.style.cursor = placingAnnot ? "crosshair" : "";
    return () => { map.off("click", handler); el.style.cursor = ""; };
  }, [placingAnnot, annotText, annotColor]);

  const addLayer = useCallback((geojson, name) => {
    const map = mapRef.current;
    if (!map) return;
    const defaults = { color: "#4e8cff", weight: 2, fillOpacity: 0.3, fillColor: "#4e8cff" };
    const layer = L.geoJSON(geojson, {
      style: () => defaults,
      pointToLayer: (_, latlng) => L.marker(latlng, { icon: makeMarkerIcon("drillhole", "#111111", 14) }),
      onEachFeature: (feature, l) => {
        const p = feature.properties || {};
        const html = Object.keys(p).length
          ? `<pre style="margin:0;font-size:11px;max-width:260px;overflow:auto">${escapeHtml(JSON.stringify(p, null, 2))}</pre>`
          : "No attributes";
        l.bindPopup(html);
      },
    }).addTo(map);
    try { const b = layer.getBounds(); if (b.isValid()) map.fitBounds(b, { padding: [20, 20] }); } catch {}
    setLayers((p) => [...p, {
      id: crypto.randomUUID(), name, layer, visible: true,
      color: "#4e8cff", fillColor: "#4e8cff", fillOpacity: 0.3,
      weight: 2, pointRadius: 7, markerType: "drillhole", markerColor: "#111111",
      legendLabel: name, includeInLegend: true,
    }]);
  }, []);

  const handleFile = async (file) => {
    if (!file) return;
    try {
      if (file.name.endsWith(".zip")) { addLayer(await shp(await file.arrayBuffer()), file.name.replace(".zip","")); return; }
      if (file.name.endsWith(".geojson") || file.name.endsWith(".json")) { addLayer(JSON.parse(await file.text()), file.name); return; }
      if (file.name.endsWith(".csv")) { addLayer(csvToGeoJSON(await file.text()), file.name.replace(".csv","")); return; }
      alert("Supported: .zip (Shapefile), .geojson, .json, .csv");
    } catch (err) { console.error(err); alert(`Import failed: ${err.message}`); }
  };

  const updateLayer = (id, patch) => {
    setLayers((p) => p.map((item) => {
      if (item.id !== id) return item;
      const u = { ...item, ...patch };
      item.layer.setStyle?.({ color: u.color, weight: +u.weight, fillColor: u.fillColor, fillOpacity: +u.fillOpacity });
      if ("markerType" in patch || "markerColor" in patch || "pointRadius" in patch) {
        item.layer.eachLayer?.((sub) => {
          if (sub instanceof L.Marker) sub.setIcon(makeMarkerIcon(u.markerType, u.markerColor, +u.pointRadius * 2));
        });
      }
      return u;
    }));
  };

  const toggleLayer = (id) => {
    const map = mapRef.current;
    setLayers((p) => p.map((item) => {
      if (item.id !== id) return item;
      if (item.visible) map.removeLayer(item.layer); else item.layer.addTo(map);
      return { ...item, visible: !item.visible };
    }));
  };

  const removeLayer = (id) => {
    const map = mapRef.current;
    setLayers((p) => { const t = p.find((l) => l.id === id); if (t) map?.removeLayer(t.layer); return p.filter((l) => l.id !== id); });
  };

  const fitAll = () => {
    const map = mapRef.current; if (!map) return;
    const vis = layers.filter((l) => l.visible).map((l) => l.layer);
    if (!vis.length) return;
    const b = L.featureGroup(vis).getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [20, 20] });
  };

  const switchBase = (type) => {
    const map = mapRef.current; if (!map) return;
    const { osm, sat } = map._baseLayers;
    if (map._activeBase) map.removeLayer(map._activeBase);
    const next = type === "osm" ? osm : sat;
    next.addTo(map); map._activeBase = next;
  };

  const exportPNG = async () => {
    setExporting(true);
    try {
      if (!window.html2canvas) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      const surface = document.querySelector(".export-surface");
      const canvas = await window.html2canvas(surface, {
        useCORS: true, allowTaint: true, scale: 2, logging: false, backgroundColor: "#fff",
      });
      const a = document.createElement("a");
      a.download = `${title.toLowerCase().replace(/\s+/g,"-")}-map.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (err) {
      console.error(err);
      alert("PNG export failed. If using Satellite basemap, try switching to Street first (CORS restriction on tile images).");
    } finally { setExporting(false); }
  };

  const exportSVG = () => {
    const wrap = document.querySelector(".export-surface");
    const overlaySvg = wrap?.querySelector(".leaflet-overlay-pane svg");
    const W = wrap?.offsetWidth || 1200, H = wrap?.offsetHeight || 800;
    let overlay = "";
    if (overlaySvg) {
      overlay = new XMLSerializer().serializeToString(overlaySvg)
        .replace(/^<svg[^>]*>/, "<g>").replace(/<\/svg>$/, "</g>");
    }
    const legendItems = layers.filter((l) => l.includeInLegend).map((l, i) => `
      <g transform="translate(20,${H - 200 + i * 28})">
        <rect x="0" y="0" width="18" height="18" fill="${l.fillColor}" fill-opacity="${l.fillOpacity}" stroke="${l.color}" stroke-width="${l.weight}"/>
        <text x="28" y="14" font-size="14" font-family="Arial" fill="#111">${escapeXml(l.legendLabel)}</text>
      </g>`).join("");
    const annotMarkup = annotations.map((a) => `
      <g transform="translate(${a.x},${a.y})">
        <rect x="0" y="0" rx="4" ry="4" width="240" height="38" fill="${a.color}" opacity="0.95"/>
        <text x="12" y="25" font-size="15" font-family="Arial" fill="#fff" font-weight="700">${escapeXml(a.text)}</text>
      </g>`).join("");
    const logoMarkup = logo ? `<image href="${logo}" x="${W-210}" y="20" width="180" height="70" preserveAspectRatio="xMidYMid meet"/>` : "";
    const northMarkup = northArrow ? `
      <g transform="translate(38,38)">
        <polygon points="20,0 28,28 20,22 12,28" fill="#111"/>
        <polygon points="20,44 28,16 20,22 12,16" fill="#fff" stroke="#111" stroke-width="1"/>
        <text x="20" y="56" text-anchor="middle" font-size="13" font-weight="700" fill="#111" font-family="Arial">N</text>
      </g>` : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="${W}" height="${H}" fill="#fff"/>
      ${overlay}
      <rect x="${W-330}" y="16" width="310" height="62" fill="#0a2c78" opacity="0.95"/>
      <text x="${W-312}" y="52" font-size="26" font-family="Arial" fill="#fff" font-weight="700">${escapeXml(title)}</text>
      <text x="${W-312}" y="72" font-size="14" font-family="Arial" fill="#cdd5e0">${escapeXml(subtitle)}</text>
      ${showLegend && layers.some(l=>l.includeInLegend) ? `<rect x="10" y="${H-220}" width="360" height="${20+layers.filter(l=>l.includeInLegend).length*28+20}" fill="#fff" opacity="0.95" stroke="#ccc" stroke-width="1"/>${legendItems}` : ""}
      ${logoMarkup}${northMarkup}${annotMarkup}
    </svg>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = "map-export.svg"; a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="app-wordmark">◈ Mapviewer</span>
        </div>

        <Sec title="Import">
          <label className="file-drop">
            <input type="file" accept=".zip,.geojson,.json,.csv"
              onChange={(e) => handleFile(e.target.files?.[0])} />
            <span className="file-drop-hint">Drop file or click to browse<br/>
              <small>.zip · .geojson · .json · .csv</small>
            </span>
          </label>
        </Sec>

        <Sec title="Map Labels">
          <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Subtitle"><input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} /></Field>
        </Sec>

        <Sec title="Branding">
          <Field label="Logo">
            <input type="file" accept="image/*" onChange={(e) => loadImageFile(e.target.files?.[0], setLogo)} />
          </Field>
          {logo && <button className="btn-ghost" onClick={() => setLogo(null)}>✕ Remove logo</button>}
        </Sec>

        <Sec title="Basemap">
          <div className="row2">
            <button className="btn" onClick={() => switchBase("sat")}>🛰 Satellite</button>
            <button className="btn" onClick={() => switchBase("osm")}>🗺 Street</button>
          </div>
        </Sec>

        <Sec title="Overlays">
          <Toggle label="North Arrow" checked={northArrow} onChange={setNorthArrow} />
          <Toggle label="Legend"      checked={showLegend} onChange={setShowLegend} />
          <Toggle label="Inset Map"   checked={showInset}  onChange={setShowInset} />
        </Sec>

        <Sec title="Annotations">
          <Field label="Label text">
            <input placeholder="e.g. ~$1B USD MARKET CAP" value={annotText}
              onChange={(e) => setAnnotText(e.target.value)} />
          </Field>
          <div className="color-pick-row">
            <span>Color</span>
            <input type="color" value={annotColor} onChange={(e) => setAnnotColor(e.target.value)} />
          </div>
          <button
            className={`btn ${placingAnnot ? "btn-placing" : ""}`}
            onClick={() => setPlacingAnnot((p) => !p)}
            style={{ marginTop: 8, width: "100%" }}
          >
            {placingAnnot ? "🎯 Click map to place…" : "＋ Place on Map"}
          </button>
          {annotations.length > 0 && (
            <div className="annot-list">
              {annotations.map((a) => (
                <div key={a.id} className="annot-row">
                  <span className="annot-swatch" style={{ background: a.color }} />
                  <input value={a.text}
                    onChange={(e) => setAnnotations((p) => p.map((x) => x.id === a.id ? { ...x, text: e.target.value } : x))} />
                  <button className="btn-icon-sm" onClick={() => setAnnotations((p) => p.filter((x) => x.id !== a.id))}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Sec>

        <Sec title="Export">
          <div className="row2" style={{ marginBottom: 8 }}>
            <button className="btn" onClick={fitAll}>Fit All</button>
            <button className="btn" onClick={exportSVG}>SVG</button>
          </div>
          <button className="btn btn-export" onClick={exportPNG} disabled={exporting}>
            {exporting ? "Exporting…" : "⬇ Export PNG"}
          </button>
        </Sec>

        <Sec title={`Layers${layers.length ? ` (${layers.length})` : ""}`}>
          {layers.length === 0
            ? <div className="empty-hint">No layers loaded yet.<br/>Import a GIS file above.</div>
            : layers.map((l) => (
                <LayerCard key={l.id} l={l}
                  onUpdate={(p) => updateLayer(l.id, p)}
                  onToggle={() => toggleLayer(l.id)}
                  onRemove={() => removeLayer(l.id)}
                />
              ))
          }
        </Sec>
      </aside>

      <div className="map-side export-surface">
        <div className="title-block">
          <div className="title-main">{title}</div>
          <div className="title-sub">{subtitle}</div>
        </div>

        {logo && <img src={logo} alt="Logo" className="logo-block" />}

        {northArrow && (
          <div className="north-arrow">
            <svg viewBox="0 0 40 58" width="36" height="52">
              <polygon points="20,2 27,28 20,23 13,28" fill="#111"/>
              <polygon points="20,54 27,28 20,33 13,28" fill="#eee" stroke="#111" strokeWidth="0.8"/>
              <text x="20" y="53" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#111" fontFamily="Arial">N</text>
            </svg>
          </div>
        )}

        {showInset && <InsetMap mainMapRef={mapRef} />}

        <div ref={containerRef} id="map" />

        {showLegend && layers.some((l) => l.includeInLegend) && (
          <div className="legend-block">
            {layers.filter((l) => l.includeInLegend).map((l) => (
              <div key={l.id} className="legend-row">
                <span className="legend-swatch" style={{
                  background: l.fillColor, opacity: l.fillOpacity,
                  border: `${Math.max(1,l.weight)}px solid ${l.color}`,
                }} />
                <span>{l.legendLabel}</span>
              </div>
            ))}
          </div>
        )}

        {annotations.map((a) => (
          <div key={a.id} className="annotation-box"
            style={{ left: a.x, top: a.y, background: a.color }}>
            {a.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Sec({ title, children }) {
  return (
    <div className="sec">
      <div className="sec-title">{title}</div>
      {children}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
    </div>
  );
}
function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle-row" onClick={() => onChange(!checked)}>
      <span className={`toggle-track ${checked ? "on" : ""}`}>
        <span className="toggle-thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}
function LayerCard({ l, onUpdate, onToggle, onRemove }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`layer-card ${open ? "open" : ""}`}>
      <div className="layer-card-header">
        <button className="btn-chevron" onClick={() => setOpen((o) => !o)}>{open ? "▾" : "▸"}</button>
        <span className="layer-card-name" title={l.name}>{l.name}</span>
        <button className="btn-icon-sm" onClick={onToggle}>{l.visible ? "👁" : "🚫"}</button>
        <button className="btn-icon-sm" onClick={onRemove}>✕</button>
      </div>
      {open && (
        <div className="layer-card-body">
          <Field label="Legend label">
            <input value={l.legendLabel} onChange={(e) => onUpdate({ legendLabel: e.target.value })} />
          </Field>
          <div className="color-trio">
            <div><div className="field-label">Stroke</div>
              <input type="color" value={l.color} onChange={(e) => onUpdate({ color: e.target.value })} /></div>
            <div><div className="field-label">Fill</div>
              <input type="color" value={l.fillColor} onChange={(e) => onUpdate({ fillColor: e.target.value })} /></div>
            <div><div className="field-label">Marker</div>
              <input type="color" value={l.markerColor} onChange={(e) => onUpdate({ markerColor: e.target.value })} /></div>
          </div>
          <Field label="Marker type">
            <select value={l.markerType} onChange={(e) => onUpdate({ markerType: e.target.value })}>
              {MARKER_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label={`Fill opacity — ${Math.round(+l.fillOpacity * 100)}%`}>
            <input type="range" min="0" max="1" step="0.05" value={l.fillOpacity}
              onChange={(e) => onUpdate({ fillOpacity: e.target.value })} />
          </Field>
          <Field label={`Line weight — ${l.weight}px`}>
            <input type="range" min="1" max="8" step="1" value={l.weight}
              onChange={(e) => onUpdate({ weight: e.target.value })} />
          </Field>
          <Field label={`Marker size — ${+l.pointRadius * 2}px`}>
            <input type="range" min="3" max="16" step="1" value={l.pointRadius}
              onChange={(e) => onUpdate({ pointRadius: e.target.value })} />
          </Field>
          <Toggle label="Include in legend" checked={l.includeInLegend}
            onChange={(v) => onUpdate({ includeInLegend: v })} />
        </div>
      )}
    </div>
  );
}
