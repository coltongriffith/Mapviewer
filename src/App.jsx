import React, { useMemo, useRef, useState } from "react";
import L from "leaflet";
import MapCanvas from "./components/MapCanvas";
import Sidebar from "./components/Sidebar";
import LayerList from "./components/LayerList";
import { loadGeoJSON } from "./utils/importers";
import { buildScene } from "./export/buildScene";
import { exportPNG } from "./export/exportPNG";
import { exportSVG } from "./export/exportSVG";
import { createInitialProjectState } from "./projectState";
import { applyPresetToLayer, LAYER_PRESETS } from "./mapPresets";

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

export default function App() {
  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const fileInputRef = useRef(null);

  const [project, setProject] = useState(createInitialProjectState());
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [exporting, setExporting] = useState(false);

  const selectedLayer = useMemo(
    () => project.layers.find((l) => l.id === selectedLayerId) || null,
    [project.layers, selectedLayerId]
  );

  const updateLayout = (patch) => {
    setProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        ...patch,
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
              style: patch.style
                ? { ...(layer.style || {}), ...patch.style }
                : layer.style,
              legend: patch.legend
                ? { ...(layer.legend || {}), ...patch.legend }
                : layer.legend,
            }
          : layer
      ),
    }));
  };

  const onMapReady = (map) => {
    leafletMapRef.current = map;
  };

  const fitLayerBounds = (geojson) => {
    const map = leafletMapRef.current;
    if (!map || !geojson) return;

    try {
      const tmp = L.geoJSON(geojson);
      const bounds = tmp.getBounds?.();
      if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    } catch {
      // no-op
    }
  };

  const addGeoJSONLayer = async (file) => {
    try {
      const geojson = await loadGeoJSON(file);
      const id = crypto.randomUUID();
      const baseName = file.name.replace(/\.(geojson|json)$/i, "") || "Layer";
      const kind = detectLayerKind(geojson);
      const presetKey = kind === "points" ? "drillhole" : "claim";

      const rawLayer = {
        id,
        name: baseName,
        type: kind,
        visible: true,
        geojson,
        style: {
          stroke: "#54a6ff",
          fill: "#54a6ff",
          fillOpacity: 0.22,
          strokeWidth: 2,
          markerColor: "#111111",
          markerSize: 10,
          dashArray: "",
        },
        legend: {
          enabled: true,
          label: baseName,
        },
      };

      const nextLayer = applyPresetToLayer(rawLayer, presetKey);

      setProject((prev) => ({
        ...prev,
        layers: [...prev.layers, nextLayer],
      }));

      setSelectedLayerId(id);

      setTimeout(() => {
        fitLayerBounds(geojson);
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

  const handleBuildLegend = () => {
    const legendItems = project.layers
      .filter((layer) => layer.legend?.enabled !== false)
      .map((layer) => ({
        id: layer.id,
        label: layer.legend?.label || layer.name,
        type: layer.type,
        style: layer.style,
      }));

    updateLayout({ legendItems });
  };

  const handleApplyPreset = (presetKey) => {
    if (!selectedLayer) return;
    const next = applyPresetToLayer(selectedLayer, presetKey);
    updateLayer(selectedLayer.id, next);
  };

  const handleExportPNG = async () => {
    if (!mapContainerRef.current) return;
    setExporting(true);
    try {
      const scene = buildScene(mapContainerRef.current, project, leafletMapRef.current);
      await exportPNG(scene);
    } catch (err) {
      console.error(err);
      alert(`PNG export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportSVG = async () => {
    if (!mapContainerRef.current) return;
    setExporting(true);
    try {
      const scene = buildScene(mapContainerRef.current, project, leafletMapRef.current);
      exportSVG(scene);
    } catch (err) {
      console.error(err);
      alert(`SVG export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar>
        <div className="sidebar-section">
          <div className="sidebar-title">Mapviewer</div>
          <div className="sidebar-subtitle">Step 1 · map renderer solid</div>
        </div>

        <div className="sidebar-section">
          <label className="field-label">Import GeoJSON</label>
          <button className="btn" onClick={() => fileInputRef.current?.click()}>
            Upload .geojson / .json
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json,application/json"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>

        <div className="sidebar-section">
          <label className="field-label">Title</label>
          <input
            className="text-input"
            value={project.layout.title}
            onChange={(e) => updateLayout({ title: e.target.value })}
          />

          <label className="field-label">Subtitle</label>
          <input
            className="text-input"
            value={project.layout.subtitle}
            onChange={(e) => updateLayout({ subtitle: e.target.value })}
          />
        </div>

        <div className="sidebar-section">
          <div className="row-between">
            <span className="field-label">Layers</span>
            <button className="btn btn-small" onClick={handleBuildLegend}>
              Build Legend
            </button>
          </div>

          <LayerList
            layers={project.layers}
            selectedLayerId={selectedLayerId}
            onSelect={setSelectedLayerId}
            onToggleVisible={(layerId) => {
              const layer = project.layers.find((l) => l.id === layerId);
              if (!layer) return;
              updateLayer(layerId, { visible: !layer.visible });
            }}
          />
        </div>

        {selectedLayer && (
          <div className="sidebar-section">
            <div className="field-label">Selected Layer</div>

            <label className="field-label">Name</label>
            <input
              className="text-input"
              value={selectedLayer.name}
              onChange={(e) => updateLayer(selectedLayer.id, { name: e.target.value })}
            />

            <label className="field-label">Preset</label>
            <select
              className="text-input"
              defaultValue=""
              onChange={(e) => e.target.value && handleApplyPreset(e.target.value)}
            >
              <option value="">Choose preset</option>
              {Object.keys(LAYER_PRESETS).map((key) => (
                <option key={key} value={key}>
                  {LAYER_PRESETS[key].label}
                </option>
              ))}
            </select>

            {selectedLayer.type !== "points" && (
              <>
                <label className="field-label">Stroke</label>
                <input
                  className="color-input"
                  type="color"
                  value={selectedLayer.style?.stroke || "#54a6ff"}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      style: { stroke: e.target.value },
                    })
                  }
                />

                <label className="field-label">Fill</label>
                <input
                  className="color-input"
                  type="color"
                  value={selectedLayer.style?.fill || "#54a6ff"}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      style: { fill: e.target.value },
                    })
                  }
                />

                <label className="field-label">Fill Opacity</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={selectedLayer.style?.fillOpacity ?? 0.22}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      style: { fillOpacity: Number(e.target.value) },
                    })
                  }
                />

                <label className="field-label">Stroke Width</label>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={selectedLayer.style?.strokeWidth ?? 2}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      style: { strokeWidth: Number(e.target.value) },
                    })
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
                    updateLayer(selectedLayer.id, {
                      style: { markerColor: e.target.value },
                    })
                  }
                />

                <label className="field-label">Marker Size</label>
                <input
                  type="range"
                  min="6"
                  max="24"
                  step="1"
                  value={selectedLayer.style?.markerSize ?? 10}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      style: { markerSize: Number(e.target.value) },
                    })
                  }
                />
              </>
            )}

            <label className="field-label">Legend Label</label>
            <input
              className="text-input"
              value={selectedLayer.legend?.label || ""}
              onChange={(e) =>
                updateLayer(selectedLayer.id, {
                  legend: {
                    enabled: true,
                    label: e.target.value,
                  },
                })
              }
            />
          </div>
        )}

        <div className="sidebar-section">
          <div className="field-label">Export</div>
          <div className="export-buttons">
            <button className="btn" disabled={exporting} onClick={handleExportPNG}>
              {exporting ? "Working..." : "Export PNG"}
            </button>
            <button className="btn" disabled={exporting} onClick={handleExportSVG}>
              {exporting ? "Working..." : "Export SVG"}
            </button>
          </div>
        </div>
      </Sidebar>

      <div className="map-stage">
        <div className="map-header">
          <div className="map-title-block">
            <div className="map-title">{project.layout.title}</div>
            <div className="map-subtitle">{project.layout.subtitle}</div>
          </div>
        </div>

        <div className="map-container" ref={mapContainerRef}>
          <MapCanvas onReady={onMapReady} project={project} />

          {project.layout.legendItems?.length > 0 && (
            <div className="legend-box">
              <div className="legend-title">Legend</div>
              {project.layout.legendItems.map((item) => (
                <div key={item.id} className="legend-row">
                  <span
                    className="legend-swatch"
                    style={{
                      background: item.type === "points"
                        ? item.style?.markerColor || "#111111"
                        : item.style?.fill || "#54a6ff",
                      borderColor: item.type === "points"
                        ? item.style?.markerColor || "#111111"
                        : item.style?.stroke || "#54a6ff",
                      borderRadius: item.type === "points" ? "999px" : "2px",
                    }}
                  />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
