import React from "react";

export default function NorthArrow({ templateStyle }) {
  const s = templateStyle || {};

  return (
    <div
      style={{
        background: s.background || "rgba(255,255,255,0.94)",
        border: s.border || "1px solid #cad2df",
        borderRadius: s.borderRadius ?? 6,
        padding: s.padding || "8px 10px",
        color: s.color || "#111",
        boxShadow: s.boxShadow || "0 2px 8px rgba(0,0,0,0.1)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        userSelect: "none",
        width: 46,
      }}
    >
      <svg width={28} height={44} viewBox="0 0 28 44">
        {/* North arrow body */}
        <polygon points="14,2 20,28 14,24 8,28" fill="#1a2130" />
        <polygon points="14,2 8,28 14,24" fill="#666" />
        {/* South pointer */}
        <polygon points="14,42 20,16 14,20 8,16" fill="#999" />
        <polygon points="14,42 8,16 14,20" fill="#bbb" />
        {/* Center circle */}
        <circle cx="14" cy="23" r="3" fill="#fff" stroke="#1a2130" strokeWidth="1" />
      </svg>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          marginTop: 2,
          fontFamily: "Georgia, serif",
          letterSpacing: 1,
        }}
      >
        N
      </div>
    </div>
  );
}
