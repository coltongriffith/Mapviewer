import { createScene } from "./types";

function getContainerSize(mapContainer) {
  const rect = mapContainer?.getBoundingClientRect?.();
  return {
    width: Math.round(rect?.width || 0) || mapContainer?.offsetWidth || 1600,
    height: Math.round(rect?.height || 0) || mapContainer?.offsetHeight || 1000,
  };
}

export function buildScene(mapContainer, project, map) {
  const { width, height } = getContainerSize(mapContainer);
  return createScene({ width, height, layers: project.layers, layout: project.layout, map });
}
