import { buildScene } from './buildScene';
import { renderLayerGroup } from './renderers/renderLayerGroup';
import { renderPointGroup } from './renderers/renderPointGroup';
import { renderLegend } from './renderers/renderLegend';
import { renderLayoutItems } from './renderers/renderLayoutItems';
import { downloadBlob } from '../utils/svg';

export function exportSVG({ width, height, project, filename = 'map-export.svg' }) {
  const scene = buildScene({ width, height, project });
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#e8e8e8"/>
  ${renderLayerGroup(scene)}
  ${renderPointGroup(scene)}
  ${renderLayoutItems(scene)}
  ${renderLegend(scene)}
</svg>`;

  downloadBlob(filename, new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
}
