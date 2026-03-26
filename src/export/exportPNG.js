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
        reject(new Error("html2canvas loaded but was not available."));
        return;
      }
      resolve(window.html2canvas);
    };

    script.onerror = () => reject(new Error("Failed to load html2canvas."));
    document.head.appendChild(script);
  });
}

export async function exportPNG() {
  const el = document.querySelector(".map-container");
  if (!el) throw new Error("Map container not found.");

  const html2canvas = await loadHtml2Canvas();

  const canvas = await html2canvas(el, {
    useCORS: true,
    backgroundColor: null,
    scale: 2,
  });

  const link = document.createElement("a");
  link.download = "map.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}
