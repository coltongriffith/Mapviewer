export function createInitialProjectState() {
  return {
    layers: [],
    layout: {
      title: "Map Title",
      subtitle: "",
      legendItems: [],
      text: [],
      callouts: [],
      images: [],
    },
  };
}

export function buildSceneFromState(mapContainer, state) {
  return {
    width: mapContainer?.offsetWidth || 1600,
    height: mapContainer?.offsetHeight || 1000,
    layers: state.layers || [],
    layout: state.layout || {},
  };
}
