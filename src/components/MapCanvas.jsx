import React, { useEffect, useRef } from "react";
import L from "leaflet";
import { createBasicMap } from "../utils/leafletHelpers";
import { DEFAULT_MAP_CENTER, DEFAULT_ZOOM } from "../constants";

function geometryTypeOfGeoJSON(geojson) {
  if (!geojson) return null;

  if (geojson.type === "Feature") {
    return geojson.geometry?.type || null;
  }

  if (geojson.type === "FeatureCollection") {
    const first = geojson.features?.find((f) => f?.geometry?.type);
    return first?.geometry?.type || null;
  }

  return geojson.type || null;
}

function isPointType(type) {
  return type === "Point" || type === "MultiPoint";
}

function layerStyle(layer) {
  return {
    color: layer.style?.stroke || "#54a6ff",
    weight: layer.style?.strokeWidth ?? 2,
    fillColor: layer.style?.fill || "#54a6ff",
    fillOpacity: layer.style?.fillOpacity ?? 0.22,
    opacity: 1,
    dashArray: layer.style?.dashArray || undefined,
  };
}

function pointMarkerStyle(layer) {
  const radius = Math.max(3, Number(layer.style?.markerSize || 10) / 2);
  const color = layer.style?.markerColor || layer.style?.stroke || "#111111";

  return {
    radius,
    color,
    fillColor: color,
    fillOpacity: 1,
    weight: 1,
  };
}

export default function MapCanvas({ onReady, project }) {
  const mapRef = useRef(null);
  const renderedLayersRef = useRef([]);

  useEffect(() => {
    if (mapRef.current) return;

    const map = createBasicMap("map", DEFAULT_MAP_CENTER, DEFAULT_ZOOM);
    mapRef.current = map;
    onReady?.(map);
  }, [onReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    renderedLayersRef.current.forEach((entry) => {
      try {
        map.removeLayer(entry.leafletLayer);
      } catch {
        // no-op
      }
    });
    renderedLayersRef.current = [];

    (project?.layers || [])
      .filter((layer) => layer.visible !== false && layer.geojson)
      .forEach((layer) => {
        const geomType = geometryTypeOfGeoJSON(layer.geojson);

        const leafletLayer = L.geoJSON(layer.geojson, {
          style: () => layerStyle(layer),
          pointToLayer: (_feature, latlng) =>
            L.circleMarker(latlng, pointMarkerStyle(layer)),
          onEachFeature: (feature, featureLayer) => {
            if (feature?.properties && Object.keys(feature.properties).length) {
              featureLayer.bindPopup(
                `<pre style="margin:0;font-size:11px;max-width:260px;overflow:auto;">${escapeHtml(
                  JSON.stringify(feature.properties, null, 2)
                )}</pre>`
              );
            }
          },
        });

        leafletLayer.addTo(map);

        renderedLayersRef.current.push({
          id: layer.id,
          type: isPointType(geomType) ? "points" : "vector",
          leafletLayer,
        });
      });

    return () => {};
  }, [project]);

  return <div id="map" style={{ width: "100%", height: "100%" }} />;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
