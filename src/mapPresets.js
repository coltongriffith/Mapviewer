export const LAYER_PRESETS = {
  claim: {
    label: "Claims",
    style: {
      stroke: "#2563eb",
      fill: "#2563eb",
      fillOpacity: 0.18,
      strokeWidth: 1.5,
      markerColor: "#2563eb",
      markerSize: 8,
    },
  },
  peer: {
    label: "Peer Claims",
    style: {
      stroke: "#7f8ea3",
      fill: "#7f8ea3",
      fillOpacity: 0.18,
      strokeWidth: 1.5,
      markerColor: "#7f8ea3",
      markerSize: 8,
    },
  },
  target: {
    label: "Target Area",
    style: {
      stroke: "#d97706",
      fill: "#fbbf24",
      fillOpacity: 0.3,
      strokeWidth: 2,
      markerColor: "#d97706",
      markerSize: 8,
      dashArray: "8,5",
    },
  },
  drillhole: {
    label: "Drillholes",
    style: {
      stroke: "#111111",
      fill: "#111111",
      fillOpacity: 1,
      strokeWidth: 1,
      markerColor: "#111111",
      markerSize: 6,
    },
  },
};

export const ROLE_STYLES = {
  claims: {
    stroke: "#2563eb",
    fill: "#2563eb",
    fillOpacity: 0.18,
    strokeWidth: 1.5,
    markerColor: "#2563eb",
    markerSize: 8,
    dashArray: "",
  },
  anomaly: {
    stroke: "#dc2626",
    fill: "#ef4444",
    fillOpacity: 0.28,
    strokeWidth: 1.5,
    markerColor: "#dc2626",
    markerSize: 8,
    dashArray: "6,4",
  },
  drillholes: {
    stroke: "#111111",
    fill: "#111111",
    fillOpacity: 1,
    strokeWidth: 1,
    markerColor: "#111111",
    markerSize: 6,
    dashArray: "",
  },
  drill_traces: {
    stroke: "#374151",
    fill: "#374151",
    fillOpacity: 0,
    strokeWidth: 1.5,
    markerColor: "#374151",
    markerSize: 6,
    dashArray: "4,3",
  },
  geophysics: {
    stroke: "#7c3aed",
    fill: "#8b5cf6",
    fillOpacity: 0.22,
    strokeWidth: 1,
    markerColor: "#7c3aed",
    markerSize: 6,
    dashArray: "",
  },
  highlight_zone: {
    stroke: "#d97706",
    fill: "#fbbf24",
    fillOpacity: 0.38,
    strokeWidth: 2,
    markerColor: "#d97706",
    markerSize: 8,
    dashArray: "",
  },
  other: {
    stroke: "#6b7280",
    fill: "#9ca3af",
    fillOpacity: 0.2,
    strokeWidth: 1.5,
    markerColor: "#6b7280",
    markerSize: 7,
    dashArray: "",
  },
};

export const ROLE_LABELS = {
  claims: "Claims",
  anomaly: "Anomaly",
  drillholes: "Drillholes",
  drill_traces: "Drill Traces",
  geophysics: "Geophysics",
  highlight_zone: "Highlight Zone",
  other: "Other",
};

export function getRoleStyle(role) {
  return ROLE_STYLES[role] || ROLE_STYLES.other;
}

export function applyRoleToLayer(layer, role) {
  const style = getRoleStyle(role);
  return {
    ...layer,
    role,
    style: {
      ...(layer.style || {}),
      ...style,
    },
    legend: {
      ...(layer.legend || {}),
      label: layer.legend?.label || ROLE_LABELS[role] || layer.name,
    },
  };
}

export function applyPresetToLayer(layer, presetKey) {
  const preset = LAYER_PRESETS[presetKey];
  if (!preset) return layer;

  return {
    ...layer,
    style: {
      ...(layer.style || {}),
      ...preset.style,
    },
  };
}
