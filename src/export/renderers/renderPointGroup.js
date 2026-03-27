import { escapeXml } from "../../utils/svg";

export function renderPointGroup(scene) {
  const pointLayers = (scene.projectedLayers || []).filter(
    (l) => l.points && l.points.length > 0
  );

  if (!pointLayers.length) return `<g id="point-layers"></g>`;

  const layerSvg = pointLayers
    .map((layer) => {
      const circleSvg = layer.points
        .map((p) => {
          const color = escapeXml(p.color);
          return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${color}" stroke="${color}" stroke-width="1"/>`;
        })
        .join("\n    ");

      return `  <g id="points-${escapeXml(layer.id)}">\n    ${circleSvg}\n  </g>`;
    })
    .join("\n");

  return `<g id="point-layers">\n${layerSvg}\n</g>`;
}
