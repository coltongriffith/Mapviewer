const LAYOUT_KEYS = ['titlePos', 'logoPos', 'legendPos', 'insetPos'];

function stripLayer(layer) {
  const {
    layer: leafletLayer,
    _tooltipLayer,
    _labelLayer,
    ...rest
  } = layer;
  return rest;
}

export function serializeProject(state) {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    title: state.title,
    subtitle: state.subtitle,
    baseMap: state.baseMap,
    northArrow: state.northArrow,
    showLegend: state.showLegend,
    showInset: state.showInset,
    logo: state.logo,
    insetImage: state.insetImage,
    legendItems: state.legendItems,
    canvasImages: state.canvasImages,
    textEls: state.textEls,
    callouts: state.callouts,
    curvedLabels: state.curvedLabels,
    groups: state.groups,
    layers: state.layers.map(stripLayer),
    exportScale: state.exportScale,
    ...Object.fromEntries(LAYOUT_KEYS.map((key) => [key, state[key]])),
  };
}

export function downloadProjectFile(project, filenameBase = 'mapviewer-project') {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filenameBase}.mapviewer.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function parseProjectFile(file) {
  const raw = JSON.parse(await file.text());
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid project file.');
  }
  if (!Array.isArray(raw.layers)) {
    throw new Error('Project file is missing layers.');
  }
  return raw;
}
