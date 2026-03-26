import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import shp from "shpjs";

export default function App() {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [layers, setLayers] = useState([]);
  const [title, setTitle] = useState("Map Title");
  const [subtitle, setSubtitle] = useState("Subtitle");
  const [logo, setLogo] = useState(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView([40, -96], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

    L.control.scale().addTo(map);

    mapRef.current = map;
  }, []);

  const addLayer = (geojson, name) => {
    const map = mapRef.current;

    const layer = L.geoJSON(geojson, {
      style: {
        color: "#c8f04a",
        weight: 2,
        fillOpacity: 0.3,
      },
    }).addTo(map);

    setLayers(prev => [...prev, {
      id: Date.now(),
      name,
      layer,
      color: "#c8f04a",
      opacity: 0.3
    }]);

    map.fitBounds(layer.getBounds());
  };

  const handleFile = async (file) => {
    if (!file) return;

    if (file.name.endsWith(".zip")) {
      const buffer = await file.arrayBuffer();
      const geojson = await shp(buffer);
      addLayer(geojson, file.name);
    } else {
      const text = await file.text();
      addLayer(JSON.parse(text), file.name);
    }
  };

  const updateStyle = (id, key, value) => {
    setLayers(prev =>
      prev.map(l => {
        if (l.id !== id) return l;

        const updated = { ...l, [key]: value };

        l.layer.setStyle({
          color: updated.color,
          fillOpacity: updated.opacity
        });

        return updated;
      })
    );
  };

  const exportSVG = () => {
    const svg = document.querySelector(".leaflet-overlay-pane svg");
    if (!svg) return alert("Nothing to export");

    const data = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([data], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "map.svg";
    a.click();
  };

  return (
    <div className="app">
      <div className="sidebar">
        <h2>Mapviewer</h2>

        <input type="file" onChange={e => handleFile(e.target.files[0])} />

        <input value={title} onChange={e => setTitle(e.target.value)} />
        <input value={subtitle} onChange={e => setSubtitle(e.target.value)} />

        <input type="file" onChange={e => {
          const reader = new FileReader();
          reader.onload = () => setLogo(reader.result);
          reader.readAsDataURL(e.target.files[0]);
        }} />

        <button onClick={exportSVG}>Export SVG</button>

        {layers.map(l => (
          <div key={l.id}>
            <div>{l.name}</div>

            <input type="color"
              value={l.color}
              onChange={e => updateStyle(l.id, "color", e.target.value)}
            />

            <input type="range" min="0" max="1" step="0.1"
              value={l.opacity}
              onChange={e => updateStyle(l.id, "opacity", e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="map-wrapper">
        <div className="map-header">
          <h1>{title}</h1>
          <h3>{subtitle}</h3>
        </div>

        {logo && <img src={logo} className="logo" />}

        <div ref={containerRef} className="map"></div>

        <div className="legend">
          {layers.map(l => (
            <div key={l.id}>
              <span style={{ background: l.color }} className="legend-box"></span>
              {l.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
