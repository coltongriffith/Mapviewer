/**
 * Render visible Leaflet tile images to an off-screen canvas and return
 * the result as a PNG data-URL, ready to embed in an SVG <image> element.
 *
 * Tile images must be CORS-accessible for canvas.toDataURL() to succeed.
 * OpenStreetMap, CartoDB, and ArcGIS tiles are served with permissive CORS
 * headers, so this works in practice.  If drawing fails (tainted canvas),
 * we return null and the caller falls back to a plain background colour.
 *
 * @param {number} width  – output canvas width (= map container width)
 * @param {number} height – output canvas height (= map container height)
 * @returns {Promise<string|null>} base64 PNG data-URL or null on failure
 */
export async function captureBasemap(width, height) {
  const mapContainer = document.querySelector(".leaflet-container");
  const tilePaneEl   = document.querySelector(".leaflet-tile-pane");
  if (!tilePaneEl || !mapContainer) return null;

  const canvas = document.createElement("canvas");
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const mapRect = mapContainer.getBoundingClientRect();

  const tiles = Array.from(tilePaneEl.querySelectorAll("img.leaflet-tile"));

  const draws = tiles.map((img) =>
    new Promise((resolve) => {
      const tileRect = img.getBoundingClientRect();
      const tx = tileRect.left - mapRect.left;
      const ty = tileRect.top  - mapRect.top;
      const tw = tileRect.width;
      const th = tileRect.height;

      const drawImg = (source) => {
        try { ctx.drawImage(source, tx, ty, tw, th); } catch { /* tainted pixel */ }
        resolve();
      };

      // Always re-fetch with crossOrigin so the canvas isn't tainted.
      // If the tile is still loading (complete===false) we must also wait for
      // it here — the original load won't fire again, so we kick off a fresh
      // CORS-enabled request regardless of img.complete.
      const tmp = new Image();
      tmp.crossOrigin = "anonymous";
      tmp.onload  = () => drawImg(tmp);
      tmp.onerror = () => resolve(); // skip this tile on error
      tmp.src = img.src + (img.src.includes("?") ? "&" : "?") + "_cors=1";
    })
  );

  await Promise.all(draws);

  try {
    return canvas.toDataURL("image/png");
  } catch {
    // Canvas was tainted by at least one cross-origin image
    return null;
  }
}
