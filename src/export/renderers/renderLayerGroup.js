import { escapeXml } from "../../utils/svg";

export function renderLayerGroup(scene) {
  const polyLineLayers = (scene.projectedLayers || []).filter(
    (l) => l.paths && l.paths.length > 0
  );

  if (!polyLineLayers.length) return `<g id="polygon-layers"></g>`;

  const layerSvg = polyLineLayers
    .map((layer) => {
      const pathSvg = layer.paths
        .map((p) => {
          const fill = p.fill === "none" ? "none" : escapeXml(p.fill);
          const stroke = escapeXml(p.stroke);
          const dash = p.dashArray ? ` stroke-dasharray="${escapeXml(p.dashArray)}"` : "";
          const fillOpacityAttr = p.fill === "none" ? "" : ` fill-opacity="${p.fillOpacity}"`;
          return `<path d="${escapeXml(p.svgD)}" fill="${fill}"${fillOpacityAttr} stroke="${stroke}" stroke-width="${p.strokeWidth}"${dash} stroke-linejoin="round" stroke-linecap="round"/>`;
        })
        .join("\n    ");

      return `  <g id="layer-${escapeXml(layer.id)}">\n    ${pathSvg}\n  </g>`;
    })
    .join("\n");

  return `<g id="polygon-layers">\n${layerSvg}\n</g>`;
}
