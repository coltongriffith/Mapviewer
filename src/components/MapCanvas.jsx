import React, { useEffect, useRef } from "react";
import { createBasicMap } from "../utils/leafletHelpers";
import { DEFAULT_MAP_CENTER, DEFAULT_ZOOM } from "../constants";

function isPointFeature(feature) {
  const type = feature?.geometry?.type;
  return type === "Point" || type === "MultiPoint";
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
    if (!map || !window.L) return;

    renderedLayersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch {
        // no-op
      }
    });
    renderedLayersRef.current = [];

    (project?.layers || [])
      .filter((layer) => layer.visible !== false && layer.geojson)
      .forEach((layer) => {
        const leafletLayer = window.L.geoJSON(layer.geojson, {
          style: () => ({
            color: layer.style?.stroke || "#3b82f6",
            weight: layer.style?.strokeWidth || 2,
            fillColor: layer.style?.fill || "#3b82f6",
            fillOpacity: layer.style?.fillOpacity ?? 0.2,
            dashArray: layer.style?.dashArray || undefined,
          }),
          pointToLayer: (feature, latlng) => {
            const size = Number(layer.style?.markerSize || 10);
            const radius = Math.max(4, size / 2);
            return window.L.circleMarker(latlng, {
              radius,
              color: layer.style?.markerColor || "#111111",
              fillColor: layer.style?.markerColor || "#111111",
              fillOpacity: 1,
              weight: 1,
            });
          },
          filter: (feature) => {
            if (layer.type === "points") return isPointFeature(feature);
            return true;
          },
        });

        leafletLayer.addTo(map);
        renderedLayersRef.current.push(leafletLayer);
      });
  }, [project]);

  return <div id="map" style={{ width: "100%", height: "100%" }} />;
}
