export const MARKER_TYPES = [
  { value: 'circle', label: '● Circle / Dot' },
  { value: 'drillhole', label: '▼ Drillhole' },
  { value: 'diamond', label: '◆ Diamond' },
  { value: 'square', label: '■ Square' },
  { value: 'triangle', label: '▲ Triangle' },
  { value: 'cross', label: '✚ Cross' },
];

export const FILL_PATTERNS = [
  { value: 'solid', label: 'Solid' },
  { value: 'hatch', label: 'Hatch ////' },
  { value: 'crosshatch', label: 'Crosshatch' },
  { value: 'dots', label: 'Dots ···' },
  { value: 'none', label: 'No fill' },
];

export const SNAP_THRESHOLD = 10;

export const EXPORT_LAYER_IDS = {
  BASEMAP: 'basemap-image',
  IMAGES: 'canvas-images',
  CLAIMS: 'claims',
  POINTS: 'point-layers',
  LABELS: 'labels',
  CURVED_LABELS: 'curved-text',
  CALLOUTS: 'callouts',
  TEXT: 'text-elements',
  TITLE: 'title-block',
  LEGEND: 'legend',
  LOGO: 'logo',
  INSET: 'inset',
  NORTH_ARROW: 'north-arrow',
};
