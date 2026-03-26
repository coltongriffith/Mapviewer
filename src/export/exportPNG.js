import html2canvas from "html2canvas";

export async function exportPNG() {
  const el = document.querySelector(".map-container");
  if (!el) throw new Error("Map container not found.");

  const canvas = await html2canvas(el, {
    useCORS: true,
    backgroundColor: null,
  });

  const link = document.createElement("a");
  link.download = "map.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}
