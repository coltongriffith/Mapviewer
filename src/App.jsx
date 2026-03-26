import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import shp from "shpjs";

export default function App() {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [layers, setLayers] = useState([]);

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current).setView([40, -96], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    setTimeout(() => {
      map.invalidateSize();
    }, 100);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const addLayer = (geojson, name) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const style = {
      color: "#c8f04a",
      weight: 2,
      fillOpacity: 0.3,
    };

    const pointToLayer = (_, latlng) =>
      L.circleMarker(latlng, {
        radius: 5,
        color: "#4ab8ff",
        weight: 1.5,
        fillOpacity: 0.7,
      });

    const layer = L.geoJSON(geojson, {
      style,
      pointToLayer,
    }).addTo(map);

    try {
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    } catch {}

    setLayers((prev) => [
      ...prev,
      { id: `${name}-${Date.now()}`, name, layer, visible: true },
    ]);
  };

  const handleFile = async (file) => {
    const map = mapInstanceRef.current;
    if (!file || !map) return;

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

      alert("Supported files: .zip shapefile, .geojson, .json");
    } catch (err) {
      console.error(err);
      alert(`Import failed: ${err.message}`);
    }
  };

  const removeLayer = (id) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    setLayers((prev) => {
      const target = prev.find((l) => l.id === id);
      if (target) {
        map.removeLayer(target.layer);
      }
      return prev.filter((l) => l.id !== id);
    });
  };

  const toggleLayer = (id) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    setLayers((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;

        if (l.visible) {
          map.removeLayer(l.layer);
        } else {
          l.layer.addTo(map);
        }

        return { ...l, visible: !l.visible };
      })
    );
  };

  const fitAll = () => {
    const map = mapInstanceRef.current;
    if (!map || layers.length === 0) return;

    const visibleLayers = layers.filter((l) => l.visible).map((l) => l.layer);
    if (visibleLayers.length === 0) return;

    const group = L.featureGroup(visibleLayers);
    const bounds = group.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  };

  const exportSVG = () => {
    const mapEl = mapContainerRef.current;
    if (!mapEl) return;

    const pane = mapEl.querySelector(".leaflet-overlay-pane svg");
    if (!pane) {
      alert("No vector layer found to export.");
      return;
    }

    const data = new XMLSerializer().serializeToString(pane);
    const blob = new Blob([data], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "map.svg";
    a.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-shell">
      <div className="sidebar">
        <h2>Mapviewer</h2>

        <input
          type="file"
          accept=".zip,.geojson,.json"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        <button onClick={fitAll}>Fit All</button>
        <button onClick={exportSVG}>Export SVG</button>

        <div className="layer-list">
          {layers.length === 0 ? (
            <div className="layer-empty">No layers loaded</div>
          ) : (
            layers.map((l) => (
              <div key={l.id} className="layer-item">
                <span>{l.name}</span>
                <div className="layer-actions">
                  <button onClick={() => toggleLayer(l.id)}>
                    {l.visible ? "Hide" : "Show"}
                  </button>
                  <button onClick={() => removeLayer(l.id)}>Remove</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div ref={mapContainerRef} id="map" />
    </div>
  );
}
