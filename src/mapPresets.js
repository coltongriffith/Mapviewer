export const LAYER_PRESETS = [
  {
    value: 'claims-primary',
    label: 'Claims — Primary',
    patch: {
      color: '#8ec5ff',
      fillColor: '#8ec5ff',
      fillOpacity: 0.3,
      fillPattern: 'solid',
      weight: 2,
      layerOpacity: 1,
      legendSymbol: 'swatch',
      legendDashArray: '',
    },
  },
  {
    value: 'claims-peer',
    label: 'Claims — Peer/Adjacent',
    patch: {
      color: '#63c7d8',
      fillColor: '#63c7d8',
      fillOpacity: 0.24,
      fillPattern: 'solid',
      weight: 2,
      layerOpacity: 1,
      legendSymbol: 'swatch',
      legendDashArray: '',
    },
  },
  {
    value: 'target-area',
    label: 'Target Area — Dashed',
    patch: {
      color: '#e24b4b',
      fillColor: '#e24b4b',
      fillOpacity: 0.08,
      fillPattern: 'none',
      weight: 3,
      layerOpacity: 1,
      dashArray: '10,6',
      legendSymbol: 'dashed-area',
      legendDashArray: '10,6',
    },
  },
  {
    value: 'railway',
    label: 'Railway',
    patch: {
      color: '#111111',
      fillColor: '#111111',
      fillOpacity: 0,
      fillPattern: 'none',
      weight: 3,
      layerOpacity: 1,
      dashArray: '14,6,2,6',
      legendSymbol: 'rail',
      legendDashArray: '14,6,2,6',
    },
  },
  {
    value: 'highway',
    label: 'Highway',
    patch: {
      color: '#777777',
      fillColor: '#777777',
      fillOpacity: 0,
      fillPattern: 'none',
      weight: 3,
      layerOpacity: 1,
      legendSymbol: 'line',
      legendDashArray: '',
    },
  },
  {
    value: 'drillholes',
    label: 'Drillholes',
    patch: {
      markerType: 'drillhole',
      markerColor: '#111111',
      pointRadius: 7,
      layerOpacity: 1,
      legendSymbol: 'marker',
    },
  },
];

export function getPresetByValue(value) {
  return LAYER_PRESETS.find((preset) => preset.value === value) || null;
}

export function applyPresetToLayer(layer, presetValue) {
  const preset = getPresetByValue(presetValue);
  if (!preset) return layer;
  return {
    ...layer,
    preset: presetValue,
    legendLabel: layer.legendLabel || preset.label,
    ...preset.patch,
  };
}

export function makeLegendItemFromLayer(layer) {
  const symbol = layer.legendSymbol || (layer.isPoint ? 'marker' : (layer.dashArray ? 'line' : 'swatch'));
  return {
    id: crypto.randomUUID(),
    text: layer.legendLabel || layer.name,
    type: symbol,
    color: layer.isPoint ? layer.markerColor : layer.fillColor,
    strokeColor: layer.color,
    markerType: layer.markerType || 'circle',
    dashArray: layer.legendDashArray || layer.dashArray || '',
  };
}
