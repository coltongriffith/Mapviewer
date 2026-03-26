import React, { useMemo, useRef, useState } from "react";
import MapCanvas from "./components/MapCanvas";
import Sidebar from "./components/Sidebar";
import LayerList from "./components/LayerList";
import { loadGeoJSON } from "./utils/importers";
import { buildScene } from "./export/buildScene";
import { exportPNG } from "./export/exportPNG";
import { exportSVG } from "./export/exportSVG";
import { createInitialProjectState } from "./projectState";
import { applyPresetToLayer, LAYER_PRESETS } from "./mapPresets";

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

  const updateProject = (patch) => {
    setProject((prev) => ({ ...prev, ...patch }));
  };

  const updateLayout = (patch) => {
    setProject((prev) => ({
      ...prev,
      layout: { ...prev.layout, ...patch },
    }));
  };

  const updateLayer = (layerId, patch) => {
    setProject((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) =>
        layer.id === layerId ? { ...layer, ...patch } : layer
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
      const L = window.L;
      if (!L) return;
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
      const baseName = file.name.replace(/\.(geojson|json)$/i, "");

      const presetLayer = applyPresetToLayer(
        {
          id,
          name: baseName || "Layer",
          type: "geojson",
          visible: true,
          geojson,
          style: {
            stroke: "#3b82f6",
            fill: "#3b82f6",
            fillOpacity: 0.2,
            strokeWidth: 2,
            markerColor: "#111111",
            markerSize: 10,
          },
          legend: {
            enabled: true,
            label: baseName || "Layer",
          },
        },
        "claim"
      );

      setProject((prev) => ({
        ...prev,
        layers: [...prev.layers, presetLayer],
      }));
      setSelectedLayerId(id);

      setTimeout(() => fitLayerBounds(geojson), 50);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await addGeoJSONLayer(file);
    e.target.value = "";
  };

  const handleExportPNG = async () => {
    if (!mapContainerRef.current) return;
    setExporting(true);
    try {
      const scene = buildScene(mapContainerRef.current, project);
      await exportPNG(scene);
    } catch (err) {
      console.error(err);
      alert(`PNG export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportSVG = async () => {
    if (!mapContainerRef.current || !leafletMapRef.current) return;
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

  return (
    <div className="app-shell">
      <Sidebar>
        <div className="sidebar-section">
          <div className="sidebar-title">Mapviewer</div>
          <div className="sidebar-subtitle">Clean rebuild baseline</div>
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

            <label className="field-label">Stroke</label>
            <input
              className="color-input"
              type="color"
              value={selectedLayer.style?.stroke || "#3b82f6"}
              onChange={(e) =>
                updateLayer(selectedLayer.id, {
                  style: { ...selectedLayer.style, stroke: e.target.value },
                })
              }
            />

            <label className="field-label">Fill</label>
            <input
              className="color-input"
              type="color"
              value={selectedLayer.style?.fill || "#3b82f6"}
              onChange={(e) =>
                updateLayer(selectedLayer.id, {
                  style: { ...selectedLayer.style, fill: e.target.value },
                })
              }
            />

            <label className="field-label">Fill Opacity</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={selectedLayer.style?.fillOpacity ?? 0.2}
              onChange={(e) =>
                updateLayer(selectedLayer.id, {
                  style: {
                    ...selectedLayer.style,
                    fillOpacity: Number(e.target.value),
                  },
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
                  style: {
                    ...selectedLayer.style,
                    strokeWidth: Number(e.target.value),
                  },
                })
              }
            />

            <label className="field-label">Legend Label</label>
            <input
              className="text-input"
              value={selectedLayer.legend?.label || ""}
              onChange={(e) =>
                updateLayer(selectedLayer.id, {
                  legend: {
                    ...selectedLayer.legend,
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
          <MapCanvas
            onReady={onMapReady}
            project={project}
          />

          {project.layout.legendItems?.length > 0 && (
            <div className="legend-box">
              <div className="legend-title">Legend</div>
              {project.layout.legendItems.map((item) => (
                <div key={item.id} className="legend-row">
                  <span
                    className="legend-swatch"
                    style={{
                      background: item.style?.fill || "#3b82f6",
                      borderColor: item.style?.stroke || "#3b82f6",
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
