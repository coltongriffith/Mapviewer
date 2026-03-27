export function createInitialProjectState() {
  return {
    template: "exploration_v1",
    layers: [],
    layout: {
      title: "Project Map",
      subtitle: "Exploration Summary",
      basemap: "topo",
      logo: null,
      insetEnabled: true,
      exportSettings: {
        pixelRatio: 3,
        filename: "map-export",
      },
    },
    annotations: {
      callouts: [],
    },
  };
}
