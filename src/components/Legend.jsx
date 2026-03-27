import React from "react";

function getGeometryCategory(layer) {
  const features = layer.geojson?.features || [];
  const first = features.find((f) => f?.geometry?.type);
  const type = first?.geometry?.type || "";
  if (type === "Point" || type === "MultiPoint" || layer.type === "points") return "point";
  if (type === "LineString" || type === "MultiLineString") return "line";
  return "polygon";
}

function Swatch({ layer }) {
  const style = layer.style || {};
  const cat = getGeometryCategory(layer);

  if (cat === "point") {
    const size = Math.min(style.markerSize || 6, 10);
    return (
      <svg width={16} height={16} style={{ flexShrink: 0 }}>
        <circle
          cx={8}
          cy={8}
          r={size / 2}
          fill={style.markerColor || "#111"}
          stroke={style.markerColor || "#111"}
          strokeWidth={1}
        />
      </svg>
    );
  }

  if (cat === "line") {
    const dashArray = style.dashArray || "";
    return (
      <svg width={20} height={10} style={{ flexShrink: 0 }}>
        <line
          x1={0}
          y1={5}
          x2={20}
          y2={5}
          stroke={style.stroke || "#333"}
          strokeWidth={style.strokeWidth || 2}
          strokeDasharray={dashArray}
        />
      </svg>
    );
  }

  return (
    <svg width={18} height={12} style={{ flexShrink: 0 }}>
      <rect
        x={1}
        y={1}
        width={16}
        height={10}
        fill={style.fill || "#54a6ff"}
        fillOpacity={style.fillOpacity ?? 0.6}
        stroke={style.stroke || "#54a6ff"}
        strokeWidth={style.strokeWidth || 1.5}
        strokeDasharray={style.dashArray || ""}
      />
    </svg>
  );
}

export default function Legend({ layers, templateStyle }) {
  const items = (layers || []).filter(
    (l) => l.visible !== false && l.legend?.enabled !== false
  );

  if (!items.length) return null;

  const s = templateStyle || {};

  return (
    <div
      style={{
        background: s.background || "rgba(255,255,255,0.96)",
        border: s.border || "1px solid #cad2df",
        borderRadius: s.borderRadius ?? 6,
        padding: s.padding || "10px 14px",
        color: s.color || "#1b2533",
        fontFamily: s.fontFamily || "Arial, sans-serif",
        maxWidth: s.maxWidth || 240,
        boxShadow: s.boxShadow || "0 2px 10px rgba(0,0,0,0.12)",
        minWidth: 140,
      }}
    >
      <div
        style={{
          fontSize: s.titleFontSize || 12,
          fontWeight: s.titleFontWeight || 700,
          marginBottom: 8,
          letterSpacing: 0.3,
          textTransform: "uppercase",
        }}
      >
        Legend
      </div>

      {items.map((layer) => (
        <div
          key={layer.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 7,
          }}
        >
          <Swatch layer={layer} />
          <span style={{ fontSize: s.itemFontSize || 12, lineHeight: 1.3 }}>
            {layer.legend?.label || layer.name}
          </span>
        </div>
      ))}
    </div>
  );
}
