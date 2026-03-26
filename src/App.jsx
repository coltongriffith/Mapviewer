import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import shp from "shpjs";

export default function App() {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [layers, setLayers] = useState([]);

  useEffect(() => {
    const m = L.map("map").setView([40, -96], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "OSM",
    }).addTo(m);

    setMap(m);
  }, []);

  const addLayer = (geojson, name) => {
    const layer = L.geoJSON(geojson, {
      style: {
        color: "#c8f04a",
        weight: 2,
        fillOpacity: 0.3,
      },
    }).addTo(map);

    map.fitBounds(layer.getBounds());

    setLayers((prev) => [...prev, { layer, name }]);
  };

  const handleFile = async (file) => {
    if (!file || !map) return;

    if (file.name.endsWith(".zip")) {
      const buffer = await file.arrayBuffer();
      const geojson = await shp(buffer);
      addLayer(geojson, file.name);
    } else {
      const text = await file.text();
      addLayer(JSON.parse(text), file.name);
    }
  };

  const exportSVG = () => {
    const svg = document.querySelector("svg");
    if (!svg) return alert("No SVG found");

    const data = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([data], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "map.svg";
    a.click();
  };

  return (
    <div style={{ display: "flex" }}>
      <div className="sidebar">
        <input
          type="file"
          onChange={(e) => handleFile(e.target.files[0])}
        />
        <button onClick={exportSVG}>Export SVG</button>

        {layers.map((l, i) => (
          <div key={i}>
            {l.name}
            <button
              onClick={() => {
                map.removeLayer(l.layer);
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div id="map"></div>
    </div>
  );
}
