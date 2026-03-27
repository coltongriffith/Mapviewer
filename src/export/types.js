export function createScene({ width, height, layers, projectedLayers, layout, scaleInfo, map }) {
  return {
    width,
    height,
    layers,
    projectedLayers: projectedLayers || [],
    layout,
    scaleInfo: scaleInfo || { label: "1 km", barWidth: 100 },
    map,
  };
}
