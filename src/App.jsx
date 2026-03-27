import React, { useCallback, useMemo, useRef, useState } from "react";
import L from "leaflet";
import MapCanvas from "./components/MapCanvas";
import Sidebar from "./components/Sidebar";
import LayerList from "./components/LayerList";
import TemplateRenderer from "./components/TemplateRenderer";
import CalloutLayer from "./components/CalloutLayer";
import { loadGeoJSON } from "./utils/importers";
import { exportPNG } from "./export/exportPNG";
import { buildScene } from "./export/buildScene";
import { createInitialProjectState } from "./projectState";
import { applyRoleToLayer } from "./mapPresets";
import { getTemplate } from "./templates/index";

function detectLayerKind(geojson) {
  if (!geojson) return "geojson";
  const features =
    geojson.type === "FeatureCollection"
      ? geojson.features || []
      : geojson.type === "Feature"
        ? [geojson]
        : [];
  const first = features.find((f) => f?.geometry?.type);
  const type = first?.geometry?.type;
  if (type === "Point" || type === "MultiPoint") return "points";
  return "geojson";
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const fileInputRef = useRef(null);
  const logoInputRef = useRef(null);

  const [project, setProject] = useState(createInitialProjectState);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [activeTab, setActiveTab] = useState("layers");

  const template = useMemo(() => getTemplate(project.template), [project.template]);

  const selectedLayer = useMemo(
    () => project.layers.find((l) => l.id === selectedLayerId) || null,
    [project.layers, selectedLayerId]
  );

  // ── State updaters ──────────────────────────────────────────────

  const updateLayout = (patch) => {
    setProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        ...patch,
        exportSettings: patch.exportSettings
          ? { ...(prev.layout?.exportSettings || {}), ...patch.exportSettings }
          : prev.layout?.exportSettings,
      },
    }));
  };

  const updateLayer = (layerId, patch) => {
    setProject((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              ...patch,
              style: patch.style ? { ...(layer.style || {}), ...patch.style } : layer.style,
              legend: patch.legend ? { ...(layer.legend || {}), ...patch.legend } : layer.legend,
            }
          : layer
      ),
    }));
  };

  const removeLayer = (layerId) => {
    setProject((prev) => ({
      ...prev,
      layers: prev.layers.filter((l) => l.id !== layerId),
      annotations: {
        ...prev.annotations,
        callouts: (prev.annotations?.callouts || []).filter((c) => c.layerId !== layerId),
      },
    }));
    if (selectedLayerId === layerId) setSelectedLayerId(null);
  };

  const addCallout = useCallback((latlng, feature, layer) => {
    const name = feature?.properties?.name || feature?.properties?.Name ||
      feature?.properties?.hole_id || feature?.properties?.HoleID ||
      layer?.name || "Drillhole";
    const id = crypto.randomUUID();
    setProject((prev) => ({
      ...prev,
      annotations: {
        ...prev.annotations,
        callouts: [
          ...(prev.annotations?.callouts || []),
          {
            id,
            layerId: layer?.id,
            latlng: [latlng.lat, latlng.lng],
            offset: { x: 60, y: -70 },
            text: name + "\n",
          },
        ],
      },
    }));
  }, []);

  const updateCallout = (calloutId, patch) => {
    setProject((prev) => ({
      ...prev,
      annotations: {
        ...prev.annotations,
        callouts: (prev.annotations?.callouts || []).map((c) =>
          c.id === calloutId ? { ...c, ...patch } : c
        ),
      },
    }));
  };

  const removeCallout = (calloutId) => {
    setProject((prev) => ({
      ...prev,
      annotations: {
        ...prev.annotations,
        callouts: (prev.annotations?.callouts || []).filter((c) => c.id !== calloutId),
      },
    }));
  };

  // ── Import ──────────────────────────────────────────────────────

  const addGeoJSONLayer = async (file) => {
    try {
      const geojson = await loadGeoJSON(file);
      const id = crypto.randomUUID();
      const baseName = file.name.replace(/\.(zip|geojson|json)$/i, "") || "Layer";
      const kind = detectLayerKind(geojson);

      const rawLayer = {
        id,
        name: baseName,
        type: kind,
        visible: true,
        role: kind === "points" ? "drillholes" : "claims",
        geojson,
        style: {},
        legend: { enabled: true, label: baseName },
      };

      const nextLayer = applyRoleToLayer(rawLayer, rawLayer.role);

      setProject((prev) => ({
        ...prev,
        layers: [...prev.layers, nextLayer],
      }));

      setSelectedLayerId(id);

      setTimeout(() => {
        const map = leafletMapRef.current;
        if (!map) return;
        try {
          const tmp = L.geoJSON(geojson);
          const bounds = tmp.getBounds?.();
          if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: [20, 20] });
        } catch { /* no-op */ }
      }, 50);
    } catch (err) {
      console.error(err);
      alert(`Import failed: ${err.message}`);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await addGeoJSONLayer(file);
    e.target.value = "";
  };

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      updateLayout({ logo: dataUrl });
    } catch (err) {
      alert(`Logo import failed: ${err.message}`);
    } finally {
      e.target.value = "";
    }
  };

  // ── Export ──────────────────────────────────────────────────────

  const handleExportPNG = async () => {
    if (!mapContainerRef.current) return;
    setExporting(true);
    try {
      const scene = buildScene(mapContainerRef.current, project, leafletMapRef.current);
      await exportPNG(scene, project.layout?.exportSettings || {});
    } catch (err) {
      console.error(err);
      alert(`PNG export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  // ── Map ready ───────────────────────────────────────────────────

  const onMapReady = useCallback((map) => {
    leafletMapRef.current = map;
  }, []);

  // ── Sidebar tab content ─────────────────────────────────────────

  const exportSettings = project.layout?.exportSettings || {};

  const renderLayersTab = () => (
    <>
      <div className="sidebar-section">
        <button className="btn" onClick={() => fileInputRef.current?.click()}>
          + Import GIS Data
        </button>
        <div style={{ fontSize: 11, color: "#7a8599", marginTop: 5 }}>
          .zip shapefile / .geojson / .json
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,.geojson,.json,application/json"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      {project.layers.length > 0 && (
        <div className="sidebar-section">
          <div className="field-label">Layers</div>
          <LayerList
            layers={project.layers}
            selectedLayerId={selectedLayerId}
            onSelect={setSelectedLayerId}
            onToggleVisible={(layerId) => {
              const layer = project.layers.find((l) => l.id === layerId);
              if (layer) updateLayer(layerId, { visible: !layer.visible });
            }}
            onRoleChange={(layerId, role) => {
              if (!role) return;
              const layer = project.layers.find((l) => l.id === layerId);
              if (!layer) return;
              const updated = applyRoleToLayer(layer, role);
              setProject((prev) => ({
                ...prev,
                layers: prev.layers.map((l) => l.id === layerId ? updated : l),
              }));
            }}
          />

          {selectedLayer && (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              <label className="field-label">Legend Label</label>
              <input
                className="text-input"
                value={selectedLayer.legend?.label || ""}
                onChange={(e) =>
                  updateLayer(selectedLayer.id, {
                    legend: { ...(selectedLayer.legend || {}), label: e.target.value },
                  })
                }
              />

              <label className="field-label">Show in Legend</label>
              <select
                className="text-input"
                value={selectedLayer.legend?.enabled === false ? "no" : "yes"}
                onChange={(e) =>
                  updateLayer(selectedLayer.id, {
                    legend: { ...(selectedLayer.legend || {}), enabled: e.target.value === "yes" },
                  })
                }
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>

              {selectedLayer.type !== "points" && (
                <>
                  <label className="field-label">Fill Opacity</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedLayer.style?.fillOpacity ?? 0.22}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, { style: { fillOpacity: Number(e.target.value) } })
                    }
                  />
                  <label className="field-label">Stroke Color</label>
                  <input
                    className="color-input"
                    type="color"
                    value={selectedLayer.style?.stroke || "#54a6ff"}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, { style: { stroke: e.target.value, fill: e.target.value } })
                    }
                  />
                </>
              )}

              {selectedLayer.type === "points" && (
                <>
                  <label className="field-label">Marker Color</label>
                  <input
                    className="color-input"
                    type="color"
                    value={selectedLayer.style?.markerColor || "#111111"}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, { style: { markerColor: e.target.value } })
                    }
                  />
                  <label className="field-label">Marker Size</label>
                  <input
                    type="range"
                    min="3"
                    max="18"
                    step="1"
                    value={selectedLayer.style?.markerSize ?? 6}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, { style: { markerSize: Number(e.target.value) } })
                    }
                  />
                  {selectedLayer.role === "drillholes" && (
                    <div style={{ fontSize: 11, color: "#7abaff", marginTop: 4, lineHeight: 1.4 }}>
                      Click any drillhole on the map to add a callout label.
                    </div>
                  )}
                </>
              )}

              <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr", marginTop: 4 }}>
                <button
                  className="btn btn-small"
                  onClick={() => {
                    const map = leafletMapRef.current;
                    if (!map || !selectedLayer.geojson) return;
                    try {
                      const tmp = L.geoJSON(selectedLayer.geojson);
                      const bounds = tmp.getBounds?.();
                      if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: [20, 20] });
                    } catch { /* no-op */ }
                  }}
                >
                  Zoom to
                </button>
                <button
                  className="btn btn-small"
                  style={{ color: "#fca5a5" }}
                  onClick={() => removeLayer(selectedLayer.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {project.annotations?.callouts?.length > 0 && (
        <div className="sidebar-section">
          <div className="field-label">Callouts ({project.annotations.callouts.length})</div>
          <button
            className="btn btn-small"
            style={{ color: "#fca5a5" }}
            onClick={() =>
              setProject((prev) => ({
                ...prev,
                annotations: { ...prev.annotations, callouts: [] },
              }))
            }
          >
            Clear All Callouts
          </button>
        </div>
      )}
    </>
  );

  const renderLayoutTab = () => (
    <>
      <div className="sidebar-section">
        <label className="field-label">Title</label>
        <input
          className="text-input"
          value={project.layout.title || ""}
          placeholder="Project title"
          onChange={(e) => updateLayout({ title: e.target.value })}
        />

        <label className="field-label">Subtitle</label>
        <input
          className="text-input"
          value={project.layout.subtitle || ""}
          placeholder="e.g. Exploration Summary, Q1 2025"
          onChange={(e) => updateLayout({ subtitle: e.target.value })}
        />
      </div>

      <div className="sidebar-section">
        <label className="field-label">Basemap</label>
        <select
          className="text-input"
          value={project.layout?.basemap || "topo"}
          onChange={(e) => updateLayout({ basemap: e.target.value })}
        >
          <option value="topo">Topographic</option>
          <option value="light">Light</option>
          <option value="satellite">Satellite</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <div className="sidebar-section">
        <div className="row-between">
          <span className="field-label">Company Logo</span>
          <button className="btn btn-small" onClick={() => logoInputRef.current?.click()}>
            {project.layout?.logo ? "Replace" : "Upload"}
          </button>
        </div>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleLogoChange}
        />
        {project.layout?.logo && (
          <>
            <img
              src={project.layout.logo}
              alt="Logo preview"
              style={{ width: "100%", maxHeight: 60, objectFit: "contain", marginTop: 8, borderRadius: 4 }}
            />
            <button
              className="btn btn-small"
              style={{ marginTop: 6, color: "#fca5a5" }}
              onClick={() => updateLayout({ logo: null })}
            >
              Remove Logo
            </button>
          </>
        )}
      </div>

      <div className="sidebar-section">
        <label className="field-label">Inset Map</label>
        <select
          className="text-input"
          value={project.layout?.insetEnabled !== false ? "yes" : "no"}
          onChange={(e) => updateLayout({ insetEnabled: e.target.value === "yes" })}
        >
          <option value="yes">Visible</option>
          <option value="no">Hidden</option>
        </select>
      </div>

      <div className="sidebar-section">
        <div className="field-label" style={{ color: "#7a8599", fontSize: 11 }}>
          Template: {template?.name || "Template 1"}
        </div>
        <div style={{ fontSize: 11, color: "#535c6e", lineHeight: 1.5 }}>
          Layout elements (legend, north arrow, scale bar) are positioned automatically by the template.
        </div>
      </div>
    </>
  );

  const renderExportTab = () => (
    <div className="sidebar-section">
      <label className="field-label">Filename</label>
      <input
        className="text-input"
        value={exportSettings.filename || "map-export"}
        onChange={(e) =>
          updateLayout({ exportSettings: { filename: e.target.value } })
        }
      />

      <label className="field-label">Resolution</label>
      <select
        className="text-input"
        value={String(exportSettings.pixelRatio || 3)}
        onChange={(e) =>
          updateLayout({ exportSettings: { pixelRatio: Number(e.target.value) } })
        }
      >
        <option value="1">1× (screen)</option>
        <option value="2">2× (print quality)</option>
        <option value="3">3× (high res)</option>
        <option value="4">4× (ultra high res)</option>
      </select>

      <div style={{ marginTop: 16 }}>
        <button className="btn" disabled={exporting} onClick={handleExportPNG}>
          {exporting ? "Exporting…" : "Export PNG"}
        </button>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: "#535c6e", lineHeight: 1.5 }}>
        Exports the full map canvas including all overlays, legend, title block, north arrow, and scale bar.
      </div>
    </div>
  );

  return (
    <div className="app-shell">
      <Sidebar>
        {/* App header */}
        <div className="sidebar-section">
          <div className="sidebar-title">Exploration Map</div>
          <div className="sidebar-subtitle">Geology figure builder</div>
        </div>

        {/* Tabs */}
        <div className="sidebar-tabs">
          {["layers", "layout", "export"].map((tab) => (
            <button
              key={tab}
              className={`sidebar-tab${activeTab === tab ? " active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === "layers" && renderLayersTab()}
        {activeTab === "layout" && renderLayoutTab()}
        {activeTab === "export" && renderExportTab()}
      </Sidebar>

      <div className="map-stage">
        <div className="map-container" ref={mapContainerRef} style={{ position: "relative" }}>
          <MapCanvas
            onReady={onMapReady}
            project={project}
            onFeatureClick={addCallout}
          />

          <TemplateRenderer
            template={template}
            project={project}
            map={leafletMapRef.current}
          />

          <CalloutLayer
            callouts={project.annotations?.callouts || []}
            map={leafletMapRef.current}
            templateStyle={template?.calloutStyle}
            onUpdateCallout={updateCallout}
            onRemoveCallout={removeCallout}
          />
        </div>
      </div>
    </div>
  );
}
