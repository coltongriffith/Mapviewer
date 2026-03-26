import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import shp from "shpjs";

export default function App() {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [layers, setLayers] = useState([]);
  const [title, setTitle] = useState("RIFT PROJECT");
  const [subtitle, setSubtitle] = useState("Nebraska");
  const [logo, setLogo] = useState(null);
  const [insetImage, setInsetImage] = useState(null);
  const [northArrow, setNorthArrow] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [annotations, setAnnotations] = useState([]);
  const [annotationText, setAnnotationText] = useState("");
  const [annotationColor, setAnnotationColor] = useState("#0a2c78");
  const [drawMode, setDrawMode] = useState("none");

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView([40, -96], 5);

    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    });

    const esriSat = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Esri",
        maxZoom: 19,
      }
    );

    esriSat.addTo(map);
    map._baseLayers = { osm, esriSat };
    map._activeBase = esriSat;

    L.control.scale({ imperial: false }).addTo(map);

    mapRef.current = map;

    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const addLayer = (geojson, name) => {
    const map = mapRef.current;
    if (!map) return;

    const styleDefaults = {
      color: "#4e8cff",
      weight: 2,
      fillOpacity: 0.25,
      fillColor: "#4e8cff",
    };

    const layer = L.geoJSON(geojson, {
      style: () => styleDefaults,
      pointToLayer: (_, latlng) =>
        L.circleMarker(latlng, {
          radius: 5,
          color: "#000000",
          weight: 1.5,
          fillColor: "#000000",
          fillOpacity: 1,
        }),
      onEachFeature: (feature, l) => {
        const props = feature.properties || {};
        const content = Object.keys(props).length
          ? `<pre style="margin:0;font-size:11px;">${escapeHtml(
              JSON.stringify(props, null, 2)
            )}</pre>`
          : "No attributes";
        l.bindPopup(content);
      },
    }).addTo(map);

    try {
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    } catch {}

    setLayers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name,
        layer,
        visible: true,
        color: "#4e8cff",
        fillColor: "#4e8cff",
        fillOpacity: 0.25,
        weight: 2,
        pointRadius: 5,
        legendLabel: name,
        includeInLegend: true,
      },
    ]);
  };

  const handleFile = async (file) => {
    if (!file) return;
    try {
      if (file.name.endsWith(".zip")) {
        const buffer = await file.arrayBuffer();
        const geojson = await shp(buffer);
        addLayer(geojson, file.name);
        return;
      }

      if (file.name.endsWith(".geojson") || file.name.endsWith(".json")) {
        const text = await file.text();
        addLayer(JSON.parse(text), file.name);
        return;
      }

      if (file.name.endsWith(".csv")) {
        const text = await file.text();
        const geojson = csvToGeoJSON(text);
        addLayer(geojson, file.name);
        return;
      }

      alert("Supported: .zip, .geojson, .json, .csv");
    } catch (err) {
      console.error(err);
      alert(`Import failed: ${err.message}`);
    }
  };

  const updateLayerStyle = (id, patch) => {
    setLayers((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const updated = { ...item, ...patch };

        item.layer.setStyle?.({
          color: updated.color,
          weight: Number(updated.weight),
          fillColor: updated.fillColor,
          fillOpacity: Number(updated.fillOpacity),
        });

        item.layer.eachLayer?.((sub) => {
          if (sub instanceof L.CircleMarker) {
            sub.setStyle({
              radius: Number(updated.pointRadius),
              color: updated.color,
              fillColor: updated.fillColor,
            });
          }
        });

        return updated;
      })
    );
  };

  const toggleLayer = (id) => {
    const map = mapRef.current;
    if (!map) return;

    setLayers((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        if (item.visible) {
          map.removeLayer(item.layer);
        } else {
          item.layer.addTo(map);
        }

        return { ...item, visible: !item.visible };
      })
    );
  };

  const removeLayer = (id) => {
    const map = mapRef.current;
    if (!map) return;

    setLayers((prev) => {
      const target = prev.find((l) => l.id === id);
      if (target) map.removeLayer(target.layer);
      return prev.filter((l) => l.id !== id);
    });
  };

  const fitAll = () => {
    const map = mapRef.current;
    if (!map) return;
    const visible = layers.filter((l) => l.visible).map((l) => l.layer);
    if (!visible.length) return;
    const fg = L.featureGroup(visible);
    const bounds = fg.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
  };

  const switchBasemap = (type) => {
    const map = mapRef.current;
    if (!map) return;
    const { osm, esriSat } = map._baseLayers;
    if (map._activeBase) map.removeLayer(map._activeBase);
    const next = type === "osm" ? osm : esriSat;
    next.addTo(map);
    map._activeBase = next;
  };

  const addAnnotation = () => {
    if (!annotationText.trim()) return;
    setAnnotations((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        text: annotationText,
        color: annotationColor,
        x: 40,
        y: 120 + prev.length * 60,
      },
    ]);
    setAnnotationText("");
  };

  const updateAnnotation = (id, patch) => {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
    );
  };

  const removeAnnotation = (id) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  };

  const exportSVG = () => {
    const mapWrap = document.querySelector(".export-surface");
    const overlaySvg = mapWrap?.querySelector(".leaflet-overlay-pane svg");
    const width = mapWrap?.offsetWidth || 1200;
    const height = mapWrap?.offsetHeight || 800;

    let overlayMarkup = "";
    if (overlaySvg) {
      overlayMarkup = new XMLSerializer().serializeToString(overlaySvg);
      overlayMarkup = overlayMarkup
        .replace(/^<svg[^>]*>/, `<g transform="translate(0,0)">`)
        .replace(/<\/svg>$/, "</g>");
    }

    const legendItems = layers
      .filter((l) => l.includeInLegend)
      .map(
        (l, i) => `
        <g transform="translate(20, ${height - 180 + i * 26})">
          <rect x="0" y="0" width="18" height="18" fill="${l.fillColor}" fill-opacity="${l.fillOpacity}" stroke="${l.color}" stroke-width="${l.weight}" />
          <text x="28" y="14" font-size="18" font-family="Arial" fill="#111">${escapeXml(l.legendLabel)}</text>
        </g>
      `
      )
      .join("");

    const annotationMarkup = annotations
      .map(
        (a) => `
        <g transform="translate(${a.x},${a.y})">
          <rect x="0" y="0" rx="4" ry="4" width="260" height="44" fill="${a.color}" opacity="0.95"/>
          <text x="14" y="28" font-size="20" font-family="Arial" fill="#fff">${escapeXml(a.text)}</text>
        </g>
      `
      )
      .join("");

    const logoMarkup = logo
      ? `<image href="${logo}" x="${width - 210}" y="20" width="180" height="70" preserveAspectRatio="xMidYMid meet" />`
      : "";

    const insetMarkup = insetImage
      ? `<image href="${insetImage}" x="${width - 220}" y="100" width="190" height="190" preserveAspectRatio="xMidYMid meet" />`
      : "";

    const northMarkup = northArrow
      ? `
      <g transform="translate(40,40)">
        <text x="18" y="-8" font-size="18" font-family="Arial" fill="#111">N</text>
        <polygon points="20,0 28,28 20,22 12,28" fill="#111"/>
        <polygon points="20,40 28,12 20,18 12,12" fill="#111"/>
        <polygon points="0,20 28,12 22,20 28,28" fill="#111"/>
        <polygon points="40,20 12,12 18,20 12,28" fill="#111"/>
      </g>`
      : "";

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="${width}" height="${height}" fill="#ffffff"/>
        ${overlayMarkup}
        <g>
          <rect x="${width - 320}" y="20" width="300" height="58" fill="#0a2c78" opacity="0.95"/>
          <text x="${width - 300}" y="55" font-size="34" font-family="Arial" fill="#fff" font-weight="700">${escapeXml(
            title
          )}</text>
          <text x="${width - 300}" y="78" font-size="18" font-family="Arial" fill="#fff">${escapeXml(
            subtitle
          )}</text>
        </g>
        ${
          showLegend
            ? `
          <g>
            <rect x="10" y="${height - 210}" width="420" height="190" fill="#fff" opacity="0.95" stroke="#222"/>
            ${legendItems}
          </g>
        `
            : ""
        }
        ${logoMarkup}
        ${insetMarkup}
        ${northMarkup}
        ${annotationMarkup}
      </svg>
    `;

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "map-export.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-shell">
      <div className="sidebar">
        <h2>Mapviewer</h2>

        <div className="group">
          <label>Upload GIS</label>
          <input
            type="file"
            accept=".zip,.geojson,.json,.csv"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        <div className="group">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
          <label>Subtitle</label>
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        </div>

        <div className="group">
          <label>Logo</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => loadImage(e.target.files?.[0], setLogo)}
          />
          <label>Inset Image</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => loadImage(e.target.files?.[0], setInsetImage)}
          />
        </div>

        <div className="group">
          <label>Basemap</label>
          <div className="row">
            <button onClick={() => switchBasemap("sat")}>Satellite</button>
            <button onClick={() => switchBasemap("osm")}>Street</button>
          </div>
        </div>

        <div className="group">
          <label>
            <input
              type="checkbox"
              checked={northArrow}
              onChange={(e) => setNorthArrow(e.target.checked)}
            />
            Show North Arrow
          </label>
          <label>
            <input
              type="checkbox"
              checked={showLegend}
              onChange={(e) => setShowLegend(e.target.checked)}
            />
            Show Legend
          </label>
        </div>

        <div className="group">
          <label>Add Annotation</label>
          <input
            value={annotationText}
            onChange={(e) => setAnnotationText(e.target.value)}
            placeholder="~$1B USD MARKET CAP"
          />
          <input
            type="color"
            value={annotationColor}
            onChange={(e) => setAnnotationColor(e.target.value)}
          />
          <button onClick={addAnnotation}>Add Annotation Box</button>
        </div>

        <div className="group">
          <button onClick={fitAll}>Fit All</button>
          <button onClick={exportSVG}>Export SVG</button>
        </div>

        <div className="group">
          <h3>Layers</h3>
          {layers.length === 0 ? (
            <div className="empty">No layers loaded</div>
          ) : (
            layers.map((l) => (
              <div key={l.id} className="layer-card">
                <strong>{l.name}</strong>

                <label>Legend Label</label>
                <input
                  value={l.legendLabel}
                  onChange={(e) =>
                    updateLayerStyle(l.id, { legendLabel: e.target.value })
                  }
                />

                <div className="row">
                  <div>
                    <label>Stroke</label>
                    <input
                      type="color"
                      value={l.color}
                      onChange={(e) =>
                        updateLayerStyle(l.id, { color: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label>Fill</label>
                    <input
                      type="color"
                      value={l.fillColor}
                      onChange={(e) =>
                        updateLayerStyle(l.id, { fillColor: e.target.value })
                      }
                    />
                  </div>
                </div>

                <label>Fill Opacity</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={l.fillOpacity}
                  onChange={(e) =>
                    updateLayerStyle(l.id, { fillOpacity: e.target.value })
                  }
                />

                <label>Line Weight</label>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={l.weight}
                  onChange={(e) =>
                    updateLayerStyle(l.id, { weight: e.target.value })
                  }
                />

                <label>Point Radius</label>
                <input
                  type="range"
                  min="2"
                  max="12"
                  step="1"
                  value={l.pointRadius}
                  onChange={(e) =>
                    updateLayerStyle(l.id, { pointRadius: e.target.value })
                  }
                />

                <label>
                  <input
                    type="checkbox"
                    checked={l.includeInLegend}
                    onChange={(e) =>
                      updateLayerStyle(l.id, { includeInLegend: e.target.checked })
                    }
                  />
                  Include in legend
                </label>

                <div className="row">
                  <button onClick={() => toggleLayer(l.id)}>
                    {l.visible ? "Hide" : "Show"}
                  </button>
                  <button onClick={() => removeLayer(l.id)}>Remove</button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="group">
          <h3>Annotations</h3>
          {annotations.length === 0 ? (
            <div className="empty">No annotations</div>
          ) : (
            annotations.map((a) => (
              <div key={a.id} className="layer-card">
                <input
                  value={a.text}
                  onChange={(e) => updateAnnotation(a.id, { text: e.target.value })}
                />
                <input
                  type="color"
                  value={a.color}
                  onChange={(e) => updateAnnotation(a.id, { color: e.target.value })}
                />
                <label>X</label>
                <input
                  type="number"
                  value={a.x}
                  onChange={(e) => updateAnnotation(a.id, { x: Number(e.target.value) })}
                />
                <label>Y</label>
                <input
                  type="number"
                  value={a.y}
                  onChange={(e) => updateAnnotation(a.id, { y: Number(e.target.value) })}
                />
                <button onClick={() => removeAnnotation(a.id)}>Delete</button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="map-side export-surface">
        <div className="title-block">
          <div className="title-main">{title}</div>
          <div className="title-sub">{subtitle}</div>
        </div>

        {logo ? <img src={logo} alt="Logo" className="logo-block" /> : null}
        {insetImage ? <img src={insetImage} alt="Inset" className="inset-block" /> : null}
        {northArrow ? <div className="north-arrow">N</div> : null}

        <div ref={containerRef} id="map" />

        {showLegend ? (
          <div className="legend-block">
            {layers
              .filter((l) => l.includeInLegend)
              .map((l) => (
                <div className="legend-row" key={l.id}>
                  <span
                    className="legend-swatch"
                    style={{
                      background: l.fillColor,
                      opacity: l.fillOpacity,
                      border: `${l.weight}px solid ${l.color}`,
                    }}
                  />
                  <span>{l.legendLabel}</span>
                </div>
              ))}
          </div>
        ) : null}

        {annotations.map((a) => (
          <div
            key={a.id}
            className="annotation-box"
            style={{ left: a.x, top: a.y, background: a.color }}
          >
            {a.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function loadImage(file, setter) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setter(reader.result);
  reader.readAsDataURL(file);
}

function csvToGeoJSON(text) {
  const lines = text.trim().split("\\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  const latIndex = headers.findIndex((h) => /lat/i.test(h));
  const lngIndex = headers.findIndex((h) => /lon|lng|long/i.test(h));

  if (latIndex === -1 || lngIndex === -1) {
    throw new Error("CSV must include lat and lng/lon columns.");
  }

  const features = lines.slice(1).map((line) => {
    const parts = line.split(",");
    const props = {};
    headers.forEach((h, i) => {
      props[h] = parts[i];
    });

    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [Number(parts[lngIndex]), Number(parts[latIndex])],
      },
      properties: props,
    };
  });

  return { type: "FeatureCollection", features };
}

function escapeXml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
