import React from "react";
import { ROLE_LABELS } from "../mapPresets";

const ROLES = [
  { value: "", label: "— assign role —" },
  { value: "claims", label: "Claims" },
  { value: "anomaly", label: "Anomaly" },
  { value: "drillholes", label: "Drillholes" },
  { value: "drill_traces", label: "Drill Traces" },
  { value: "geophysics", label: "Geophysics" },
  { value: "highlight_zone", label: "Highlight Zone" },
  { value: "other", label: "Other" },
];

const ROLE_COLORS = {
  claims: "#2563eb",
  anomaly: "#dc2626",
  drillholes: "#111111",
  drill_traces: "#374151",
  geophysics: "#7c3aed",
  highlight_zone: "#d97706",
  other: "#6b7280",
};

export default function LayerList({
  layers,
  selectedLayerId,
  onSelect,
  onToggleVisible,
  onRoleChange,
}) {
  return (
    <div className="layer-list">
      {layers.map((layer) => (
        <div
          key={layer.id}
          className={`layer-item ${selectedLayerId === layer.id ? "active" : ""}`}
          onClick={() => onSelect?.(layer.id)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            {layer.role && (
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: ROLE_COLORS[layer.role] || "#6b7280",
                  flexShrink: 0,
                }}
              />
            )}
            <div className="layer-name">{layer.name || "Layer"}</div>
            <button
              className="btn layer-toggle"
              style={{ marginLeft: "auto" }}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisible?.(layer.id);
              }}
            >
              {layer.visible === false ? "Off" : "On"}
            </button>
          </div>

          <div onClick={(e) => e.stopPropagation()}>
            <select
              className="text-input"
              style={{ fontSize: 11, padding: "3px 6px", marginTop: 2 }}
              value={layer.role || ""}
              onChange={(e) => onRoleChange?.(layer.id, e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}
