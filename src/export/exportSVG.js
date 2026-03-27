import { renderLayerGroup } from "./renderers/renderLayerGroup";
import { renderPointGroup } from "./renderers/renderPointGroup";
import { renderLegend } from "./renderers/renderLegend";
import { renderLayoutItems } from "./renderers/renderLayoutItems";
import { downloadBlob } from "../utils/svg";

export function exportSVG(scene, options = {}) {
  const { width, height } = scene;
  const filename = options.filename || "map";

  const body = [
    `<rect width="100%" height="100%" fill="#e8e8e8"/>`,
    renderLayerGroup(scene),
    renderPointGroup(scene),
    renderLayoutItems(scene),
    renderLegend(scene),
  ].join("\n  ");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${body}
</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(`${filename}.svg`, blob);
}
