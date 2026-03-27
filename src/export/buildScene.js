import { createScene } from "./types";

function getContainerSize(mapContainer) {
  const rect = mapContainer?.getBoundingClientRect?.();

  return {
    width:
      Math.round(rect?.width || 0) ||
      mapContainer?.offsetWidth ||
      1600,
    height:
      Math.round(rect?.height || 0) ||
      mapContainer?.offsetHeight ||
      1000,
  };
}

// Project a GeoJSON [lng, lat] pair to container pixel [x, y]
function project(lngLat, map) {
  const pt = map.latLngToContainerPoint([lngLat[1], lngLat[0]]);
  return [pt.x, pt.y];
}

// Build an SVG path "d" string from a ring of [lng, lat] coords
function ringToPath(ring, map) {
  return ring
    .map((coord, i) => {
      const [x, y] = project(coord, map);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ") + " Z";
}

// Recursively project coordinates based on geometry type, return SVG path strings
function projectGeometry(geometry, map, style) {
  const fill = style.fill || "#54a6ff";
  const stroke = style.stroke || "#54a6ff";
  const strokeWidth = style.strokeWidth ?? 2;
  const fillOpacity = style.fillOpacity ?? 0.22;
  const dashArray = style.dashArray || "";

  const type = geometry.type;
  const coords = geometry.coordinates;
  const results = [];

  if (type === "Polygon") {
    const d = coords.map((ring) => ringToPath(ring, map)).join(" ");
    results.push({ svgD: d, fill, stroke, strokeWidth, fillOpacity, dashArray });
  } else if (type === "MultiPolygon") {
    coords.forEach((poly) => {
      const d = poly.map((ring) => ringToPath(ring, map)).join(" ");
      results.push({ svgD: d, fill, stroke, strokeWidth, fillOpacity, dashArray });
    });
  } else if (type === "LineString") {
    const d = coords
      .map((coord, i) => {
        const [x, y] = project(coord, map);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    results.push({ svgD: d, fill: "none", stroke, strokeWidth, fillOpacity: 0, dashArray });
  } else if (type === "MultiLineString") {
    coords.forEach((line) => {
      const d = line
        .map((coord, i) => {
          const [x, y] = project(coord, map);
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
      results.push({ svgD: d, fill: "none", stroke, strokeWidth, fillOpacity: 0, dashArray });
    });
  }

  return results;
}

// Project a point geometry to {cx, cy, r, color}
function projectPoint(geometry, map, style) {
  const color = style.markerColor || "#111111";
  const r = (style.markerSize ?? 10) / 2;
  const results = [];

  if (geometry.type === "Point") {
    const [x, y] = project(geometry.coordinates, map);
    results.push({ cx: x.toFixed(1), cy: y.toFixed(1), r, color });
  } else if (geometry.type === "MultiPoint") {
    geometry.coordinates.forEach((coord) => {
      const [x, y] = project(coord, map);
      results.push({ cx: x.toFixed(1), cy: y.toFixed(1), r, color });
    });
  }

  return results;
}

// Compute a nice scale bar label + width (pixels) from current map state
function computeScaleInfo(map, containerWidth) {
  try {
    const size = map.getSize();
    const y = size.y / 2;
    const x1 = 20;
    const x2 = 140;
    const latlng1 = map.containerPointToLatLng([x1, y]);
    const latlng2 = map.containerPointToLatLng([x2, y]);
    const meters = latlng1.distanceTo(latlng2);
    if (!Number.isFinite(meters) || meters <= 0) return { label: "1 km", barWidth: 100 };

    const candidates = [
      50, 100, 200, 250, 500,
      1000, 2000, 2500, 5000,
      10000, 20000, 25000, 50000, 100000,
    ];
    const nice = candidates.reduce((best, n) =>
      Math.abs(n - meters) < Math.abs(best - meters) ? n : best
    , candidates[0]);

    const ratio = nice / meters;
    const barWidth = Math.max(50, Math.min(180, Math.round((x2 - x1) * ratio)));
    const label = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
    return { label, barWidth };
  } catch {
    return { label: "1 km", barWidth: 100 };
  }
}

export function buildScene(mapContainer, project, map) {
  const { width, height } = getContainerSize(mapContainer);

  const projectedLayers = [];

  if (map) {
    (project?.layers || []).forEach((layer) => {
      if (layer.visible === false || !layer.geojson) return;

      const style = layer.style || {};
      const isPoints = layer.type === "points";
      const features =
        layer.geojson.type === "FeatureCollection"
          ? layer.geojson.features || []
          : layer.geojson.type === "Feature"
            ? [layer.geojson]
            : [];

      const paths = [];
      const points = [];

      features.forEach((feature) => {
        if (!feature?.geometry) return;
        const geom = feature.geometry;

        if (isPoints || geom.type === "Point" || geom.type === "MultiPoint") {
          points.push(...projectPoint(geom, map, style));
        } else {
          paths.push(...projectGeometry(geom, map, style));
        }
      });

      projectedLayers.push({
        id: layer.id,
        name: layer.name,
        type: layer.type,
        style,
        legend: layer.legend,
        paths,
        points,
      });
    });
  }

  const scaleInfo = map ? computeScaleInfo(map, width) : { label: "1 km", barWidth: 100 };

  return createScene({
    width,
    height,
    layers: project?.layers || [],
    projectedLayers,
    // Merge top-level callouts into layout so renderers can read scene.layout.callouts
    layout: { ...(project?.layout || {}), callouts: project?.callouts || [] },
    scaleInfo,
    map,
  });
}
