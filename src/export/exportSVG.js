import { renderLayerGroup   } from "./renderers/renderLayerGroup";
import { renderPointGroup  } from "./renderers/renderPointGroup";
import { renderLegend      } from "./renderers/renderLegend";
import { renderLayoutItems } from "./renderers/renderLayoutItems";
import { captureBasemap    } from "./captureBasemap";
import { downloadBlob      } from "../utils/svg";
import { wait, waitForTiles } from "./exportUtils";

export async function exportSVG(scene, options = {}) {
  const { width, height } = scene;
  const filename = options.filename || "map";

  // Allow tiles to settle after any recent pan/zoom before capturing.
  // Without this delay, newly loaded tiles may still be in-flight and
  // captureBasemap would draw a blank canvas (same race condition that
  // exportPNG already guards against with its own wait).
  await wait(400);
  await waitForTiles();

  // Try to embed the raster basemap as a base64 image so the exported SVG
  // looks like the on-screen map.  Falls back to a plain background colour
  // if tiles can't be captured (CORS restriction or empty tile layer).
  const basemapDataUrl = await captureBasemap(width, height);
  const baseBg = basemapDataUrl
    ? `<image x="0" y="0" width="${width}" height="${height}" href="${basemapDataUrl}" preserveAspectRatio="none"/>`
    : `<rect width="100%" height="100%" fill="#eef1f5"/>`;

  const body = [
    baseBg,
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
