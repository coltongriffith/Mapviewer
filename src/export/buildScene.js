import { createScene } from "./types";

export function buildScene(mapContainer, state, map = null) {
  return createScene({
    width: mapContainer?.offsetWidth || 1600,
    height: mapContainer?.offsetHeight || 1000,
    layers: state?.layers || [],
    layout: state?.layout || {},
    map,
  });
}
