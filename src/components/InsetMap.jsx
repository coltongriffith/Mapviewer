import React, { useEffect, useRef } from "react";
import L from "leaflet";

const BASEMAPS = {
  light: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenTopoMap contributors",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri",
  },
};

export default function InsetMap({ mainMap, basemap, templateStyle, width = 180, height = 140 }) {
  const containerRef = useRef(null);
  const insetRef = useRef(null);
  const tileRef = useRef(null);
  const rectRef = useRef(null);

  useEffect(() => {
    if (insetRef.current || !containerRef.current) return;

    const map = L.map(containerRef.current, {
      center: [56, -123],
      zoom: 3,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      tap: false,
      touchZoom: false,
    });

    const cfg = BASEMAPS[basemap] || BASEMAPS.topo;
    tileRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 20,
    }).addTo(map);

    rectRef.current = L.rectangle([[0, 0], [0, 0]], {
      color: "#e55",
      weight: 2,
      fill: false,
      opacity: 0.9,
    }).addTo(map);

    insetRef.current = map;
  }, []);

  // Update tile layer when basemap changes
  useEffect(() => {
    const map = insetRef.current;
    if (!map) return;

    if (tileRef.current) {
      map.removeLayer(tileRef.current);
    }

    const cfg = BASEMAPS[basemap] || BASEMAPS.topo;
    tileRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 20,
    }).addTo(map);
  }, [basemap]);

  // Sync inset view to main map with offset zoom
  useEffect(() => {
    const inset = insetRef.current;
    if (!mainMap || !inset) return;

    const syncInset = () => {
      try {
        const center = mainMap.getCenter();
        const zoom = Math.max(0, mainMap.getZoom() - 4);
        inset.setView(center, zoom, { animate: false });

        const bounds = mainMap.getBounds();
        if (bounds && rectRef.current) {
          rectRef.current.setBounds(bounds);
        }
      } catch {
        // ignore
      }
    };

    syncInset();
    mainMap.on("moveend zoomend", syncInset);

    return () => {
      mainMap.off("moveend zoomend", syncInset);
    };
  }, [mainMap]);

  const s = templateStyle || {};

  return (
    <div
      style={{
        width,
        height,
        border: s.border || "2px solid #4a6fa5",
        borderRadius: s.borderRadius ?? 4,
        boxShadow: s.boxShadow || "0 2px 12px rgba(0,0,0,0.18)",
        overflow: "hidden",
        background: s.background || "#eef2f7",
        position: "relative",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div
        style={{
          position: "absolute",
          bottom: 2,
          left: 4,
          fontSize: 9,
          color: "#666",
          fontFamily: "Arial, sans-serif",
          pointerEvents: "none",
          background: "rgba(255,255,255,0.7)",
          padding: "1px 3px",
          borderRadius: 2,
        }}
      >
        Overview
      </div>
    </div>
  );
}
