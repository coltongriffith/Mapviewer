import { escapeXml } from "../../utils/svg";

function renderTitleBlock(scene) {
  const overlay = scene.layout?.overlays?.title;
  if (overlay?.visible === false) return `<g id="title-block"></g>`;

  const tx = overlay?.x ?? 24;
  const ty = overlay?.y ?? 20;
  const title = escapeXml(scene.layout?.title || "Project Map");
  const subtitle = escapeXml(scene.layout?.subtitle || "");

  const boxW = 340;
  const boxH = subtitle ? 62 : 42;

  return `<g id="title-block">
  <rect x="${tx}" y="${ty}" width="${boxW}" height="${boxH}" fill="rgba(255,255,255,0.9)" stroke="#cccccc" stroke-width="1" rx="8"/>
  <text x="${tx + 14}" y="${ty + 24}" font-family="Arial" font-size="16" font-weight="bold" fill="#111111">${title}</text>
  ${subtitle ? `<text x="${tx + 14}" y="${ty + 44}" font-family="Arial" font-size="12" fill="#555555">${subtitle}</text>` : ""}
</g>`;
}

function renderNorthArrow(scene) {
  const overlay = scene.layout?.overlays?.northArrow;
  if (overlay?.visible === false) return `<g id="north-arrow"></g>`;

  const nx = (overlay?.x ?? 24) + 23; // center of the 46px wide box
  const ny = overlay?.y ?? 340;

  return `<g id="north-arrow">
  <rect x="${nx - 23}" y="${ny}" width="46" height="54" fill="rgba(255,255,255,0.92)" stroke="#d9d9d9" stroke-width="1" rx="8"/>
  <text x="${nx}" y="${ny + 18}" font-family="Arial" font-size="12" font-weight="bold" fill="#111111" text-anchor="middle">N</text>
  <text x="${nx}" y="${ny + 44}" font-family="Arial" font-size="22" fill="#111111" text-anchor="middle">↑</text>
</g>`;
}

function renderScaleBar(scene) {
  const overlay = scene.layout?.overlays?.scaleBar;
  if (overlay?.visible === false) return `<g id="scale-bar"></g>`;

  const sx = overlay?.x ?? 24;
  const sy = overlay?.y ?? 410;
  const { label = "1 km", barWidth = 100 } = scene.scaleInfo || {};
  const safeLabel = escapeXml(label);

  const boxW = barWidth + 24;

  return `<g id="scale-bar">
  <rect x="${sx}" y="${sy}" width="${boxW}" height="44" fill="rgba(255,255,255,0.92)" stroke="#d9d9d9" stroke-width="1" rx="8"/>
  <!-- hatch bar: left half dark, right half white -->
  <rect x="${sx + 12}" y="${sy + 10}" width="${Math.round(barWidth / 2)}" height="10" fill="#111111" stroke="#111111" stroke-width="1"/>
  <rect x="${sx + 12 + Math.round(barWidth / 2)}" y="${sy + 10}" width="${barWidth - Math.round(barWidth / 2)}" height="10" fill="#ffffff" stroke="#111111" stroke-width="1"/>
  <text x="${sx + 12}" y="${sy + 36}" font-family="Arial" font-size="11" fill="#111111">${safeLabel}</text>
</g>`;
}

function renderCallouts(scene) {
  const callouts = scene.layout?.callouts || [];
  if (!callouts.length) return `<g id="callouts"></g>`;

  const items = callouts
    .map((c) => {
      const lines = String(c.text || "").split("\n");
      const bw = c.w ?? Math.max(120, Math.max(...lines.map((l) => l.length)) * 7.5 + 24);
      const bh = c.h ?? lines.length * 18 + 14;
      const borderColor = escapeXml(c.borderColor || "#333333");
      const bgColor = escapeXml(c.bgColor || "#ffffff");
      const cx2 = c.boxX + bw / 2;
      const cy2 = c.boxY + bh;

      const textLines = lines
        .map((line, i) =>
          `<tspan x="${c.boxX + 8}" dy="${i === 0 ? 0 : 18}">${escapeXml(line)}</tspan>`
        )
        .join("");

      return `<g>
    <line x1="${c.pinX}" y1="${c.pinY}" x2="${cx2}" y2="${cy2}" stroke="${borderColor}" stroke-width="1.5" stroke-dasharray="5,3"/>
    <circle cx="${c.pinX}" cy="${c.pinY}" r="7" fill="${borderColor}"/>
    <rect x="${c.boxX}" y="${c.boxY}" width="${bw}" height="${bh}" fill="${bgColor}" stroke="${borderColor}" stroke-width="1.5" rx="3"/>
    <text x="${c.boxX + 8}" y="${c.boxY + 16}" font-family="Arial" font-size="12" font-weight="600" fill="${borderColor}">${textLines}</text>
  </g>`;
    })
    .join("\n  ");

  return `<g id="callouts">\n  ${items}\n</g>`;
}

export function renderLayoutItems(scene) {
  return [
    renderTitleBlock(scene),
    renderNorthArrow(scene),
    renderScaleBar(scene),
    renderCallouts(scene),
    `<g id="text-elements"></g>`,
    `<g id="logo"></g>`,
    `<g id="inset"></g>`,
  ].join("\n");
}
