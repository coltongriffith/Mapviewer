function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[data-mapviewer-html2canvas="true"]'
    );

    if (existing) {
      existing.addEventListener("load", () => resolve(window.html2canvas), {
        once: true,
      });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load html2canvas.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    script.async = true;
    script.dataset.mapviewerHtml2canvas = "true";

    script.onload = () => {
      if (!window.html2canvas) {
        reject(new Error("html2canvas loaded but unavailable."));
        return;
      }
      resolve(window.html2canvas);
    };

    script.onerror = () =>
      reject(new Error("Failed to load html2canvas."));

    document.head.appendChild(script);
  });
}

function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function waitForTiles() {
  const tiles = document.querySelectorAll(".leaflet-tile");
  if (!tiles.length) return;
  await Promise.all(
    Array.from(tiles).map(
      (tile) =>
        new Promise((resolve) => {
          if (tile.complete) return resolve();
          tile.onload  = resolve;
          tile.onerror = resolve;
        })
    )
  );
}

export async function exportPNG(scene, options = {}) {
  const el = document.querySelector(".map-container");
  if (!el) throw new Error("Map container not found.");

  const html2canvas = await loadHtml2Canvas();

  const pixelRatio = options.pixelRatio || 2;
  const filename   = options.filename   || "map";

  // Allow tiles to fully settle (panning causes a brief re-layout)
  await wait(400);
  await waitForTiles();

  const rect = el.getBoundingClientRect();

  const canvas = await html2canvas(el, {
    useCORS: true,
    backgroundColor: "#ffffff",
    scale: pixelRatio,
    width:  rect.width,
    height: rect.height,
    // Crop origin: the container lives to the right of the sidebar,
    // so x/y tell html2canvas where in the page to start the clip.
    x: rect.left,
    y: rect.top,
    scrollX: -window.scrollX,
    scrollY: -window.scrollY,
    windowWidth:  document.documentElement.offsetWidth,
    windowHeight: document.documentElement.offsetHeight,
    logging: false,
    onclone: (clonedDoc) => {
      // html2canvas 1.4.1 mishandles Leaflet's transform:translate3d() on
      // .leaflet-map-pane, causing the vector/SVG layer to be offset from
      // the raster tile layer.  Convert the 3D translate to plain left/top
      // so both layers share the same coordinate system in the clone.
      const pane = clonedDoc.querySelector(".leaflet-map-pane");
      if (pane) {
        const t = pane.style.transform || "";
        const m = t.match(/translate3d\(\s*([^,]+),\s*([^,]+)/);
        if (m) {
          pane.style.transform = "none";
          pane.style.position  = "absolute";
          pane.style.left      = m[1].trim();
          pane.style.top       = m[2].trim();
        }
      }
    },
  });

  const link = document.createElement("a");
  link.download = `${filename}.png`;
  link.href = canvas.toDataURL("image/png", 1.0);
  link.click();
}
