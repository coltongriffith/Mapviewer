import { escapeXml } from "../../utils/svg";

const PE_NONE = `pointer-events="none"`;

export function renderLegend(scene) {
  const items = scene.layout?.legendItems || [];
  if (!items.length) return `<g id="legend"></g>`;

  const overlay = scene.layout?.overlays?.legend;
  if (overlay?.visible === false) return `<g id="legend"></g>`;

  const lx = overlay?.x ?? 24;
  const ly = overlay?.y ?? 96;
  const ls = scene.layout?.legendStyle || {};

  const bg        = escapeXml(ls.background || "#ffffff");
  const border    = escapeXml(ls.border     || "#d9d9d9");
  const textColor = escapeXml(ls.text       || "#1f1f1f");
  const boxWidth  = ls.width   || 220;
  const padding   = ls.padding ?? 12;

  const rowHeight = 22;
  const headerH   = 26;
  const totalH    = padding * 2 + headerH + items.length * rowHeight;

  const rows = items
    .map((item, i) => {
      const rowY   = ly + padding + headerH + i * rowHeight;
      const swatchX = lx + padding;
      const labelX  = swatchX + 24;
      const swatchY = rowY + rowHeight / 2;

      let swatch = "";
      if (item.type === "points") {
        const color = escapeXml(item.style?.markerColor || "#111111");
        swatch = `<circle cx="${swatchX + 6}" cy="${swatchY}" r="6" fill="${color}" stroke="${color}" stroke-width="1"/>`;
      } else {
        const fill   = escapeXml(item.style?.fill   || "#54a6ff");
        const stroke = escapeXml(item.style?.stroke || "#54a6ff");
        const op     = item.style?.fillOpacity ?? 1;
        swatch = `<rect x="${swatchX}" y="${swatchY - 6}" width="18" height="12" fill="${fill}" fill-opacity="${op}" stroke="${stroke}" stroke-width="1.5" rx="2"/>`;
      }

      const label = escapeXml(item.label || "");
      return `${swatch}\n    <text x="${labelX}" y="${swatchY + 4}" font-family="Arial" font-size="12" fill="${textColor}" ${PE_NONE}>${label}</text>`;
    })
    .join("\n    ");

  return `<g id="legend">
  <rect x="${lx}" y="${ly}" width="${boxWidth}" height="${totalH}" fill="${bg}" stroke="${border}" stroke-width="1" rx="8"/>
  <text x="${lx + padding}" y="${ly + padding + 16}" font-family="Arial" font-size="13" font-weight="bold" fill="${textColor}" ${PE_NONE}>Legend</text>
  ${rows}
</g>`;
}
