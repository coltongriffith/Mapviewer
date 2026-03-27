import React, { useEffect, useState } from "react";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default function ScaleBar({ map, templateStyle }) {
  const [label, setLabel] = useState("1 km");
  const [barWidth, setBarWidth] = useState(100);

  useEffect(() => {
    if (!map) return;

    const updateScale = () => {
      try {
        const size = map.getSize();
        const y = size.y / 2;
        const x1 = 20;
        const x2 = 140;

        const latlng1 = map.containerPointToLatLng([x1, y]);
        const latlng2 = map.containerPointToLatLng([x2, y]);

        const meters = latlng1.distanceTo(latlng2);
        if (!Number.isFinite(meters) || meters <= 0) return;

        const candidates = [
          50, 100, 200, 250, 500,
          1000, 2000, 2500, 5000,
          10000, 20000, 25000, 50000,
          100000,
        ];

        const nice = candidates.reduce((best, n) =>
          Math.abs(n - meters) < Math.abs(best - meters) ? n : best
        , candidates[0]);

        const ratio = nice / meters;
        const width = clamp(Math.round((x2 - x1) * ratio), 50, 180);

        setBarWidth(width);
        setLabel(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`);
      } catch {
        // ignore transient map state
      }
    };

    updateScale();
    map.on("zoomend moveend resize", updateScale);

    return () => {
      map.off("zoomend moveend resize", updateScale);
    };
  }, [map]);

  const s = templateStyle || {};

  return (
    <div
      style={{
        background: s.background || "rgba(255,255,255,0.94)",
        border: s.border || "1px solid #cad2df",
        borderRadius: s.borderRadius ?? 6,
        padding: s.padding || "8px 12px",
        color: s.color || "#111",
        boxShadow: s.boxShadow || "0 2px 8px rgba(0,0,0,0.1)",
        display: "inline-block",
      }}
    >
      <div
        style={{
          width: barWidth,
          height: 8,
          border: "1.5px solid #111",
          background: "linear-gradient(to right, #111 0 50%, #fff 50% 100%)",
          marginBottom: 5,
        }}
      />
      <div style={{ fontSize: 11, fontFamily: "Arial, sans-serif", textAlign: "center" }}>
        {label}
      </div>
    </div>
  );
}
