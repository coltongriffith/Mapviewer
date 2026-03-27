import React, { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";

function useAnchorPixels(map, callouts) {
  const [pixels, setPixels] = useState({});

  const recompute = useCallback(() => {
    if (!map) return;
    const next = {};
    for (const c of callouts) {
      try {
        const pt = map.latLngToContainerPoint(L.latLng(c.latlng[0], c.latlng[1]));
        next[c.id] = { x: pt.x, y: pt.y };
      } catch {
        // skip
      }
    }
    setPixels(next);
  }, [map, callouts]);

  useEffect(() => {
    recompute();
    if (!map) return;
    map.on("moveend zoomend resize move", recompute);
    return () => map.off("moveend zoomend resize move", recompute);
  }, [map, recompute]);

  return pixels;
}

function Callout({ callout, anchor, templateStyle, onUpdate, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });
  const s = templateStyle || {};

  const offsetX = callout.offset?.x ?? 60;
  const offsetY = callout.offset?.y ?? -60;

  const boxLeft = (anchor?.x ?? 0) + offsetX;
  const boxTop = (anchor?.y ?? 0) + offsetY;

  const leaderStartX = anchor?.x ?? 0;
  const leaderStartY = anchor?.y ?? 0;

  const svgLeft = Math.min(leaderStartX, boxLeft) - 10;
  const svgTop = Math.min(leaderStartY, boxTop) - 10;
  const svgWidth = Math.abs(boxLeft - leaderStartX) + 20;
  const svgHeight = Math.abs(boxTop - leaderStartY) + 20;

  const lineX1 = leaderStartX - svgLeft;
  const lineY1 = leaderStartY - svgTop;
  const lineX2 = boxLeft + 60 - svgLeft;
  const lineY2 = boxTop + 20 - svgTop;

  const onPointerDown = (e) => {
    if (editing) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: offsetX,
      originY: offsetY,
    };
    setDragging(true);

    const onMove = (ev) => {
      if (!dragRef.current.active) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      onUpdate({ offset: { x: dragRef.current.originX + dx, y: dragRef.current.originY + dy } });
    };

    const onUp = () => {
      dragRef.current.active = false;
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!anchor) return null;

  return (
    <>
      {/* SVG leader line layer */}
      <svg
        style={{
          position: "absolute",
          left: svgLeft,
          top: svgTop,
          width: svgWidth,
          height: svgHeight,
          pointerEvents: "none",
          zIndex: 490,
          overflow: "visible",
        }}
      >
        <line
          x1={lineX1}
          y1={lineY1}
          x2={lineX2}
          y2={lineY2}
          stroke={s.leaderColor || "#2c3e50"}
          strokeWidth={s.leaderWidth || 1.5}
        />
        <circle
          cx={lineX1}
          cy={lineY1}
          r={s.dotRadius || 4}
          fill={s.dotFill || "#2c3e50"}
        />
      </svg>

      {/* Callout text box */}
      <div
        onPointerDown={onPointerDown}
        style={{
          position: "absolute",
          left: boxLeft,
          top: boxTop,
          zIndex: 500,
          background: s.boxBackground || "#ffffff",
          border: s.boxBorder || "1.5px solid #2c3e50",
          borderRadius: s.boxBorderRadius ?? 4,
          padding: s.boxPadding || "7px 10px",
          boxShadow: s.boxShadow || "0 2px 8px rgba(0,0,0,0.15)",
          fontFamily: s.fontFamily || "Georgia, 'Times New Roman', serif",
          color: s.textColor || "#1a1a1a",
          cursor: dragging ? "grabbing" : "grab",
          userSelect: "none",
          minWidth: 120,
          maxWidth: 220,
        }}
        onDoubleClick={() => setEditing(true)}
      >
        {editing ? (
          <textarea
            autoFocus
            defaultValue={callout.text}
            style={{
              width: "100%",
              minWidth: 160,
              minHeight: 60,
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: s.fontFamily || "Georgia, 'Times New Roman', serif",
              fontSize: s.detailFontSize || 11,
              color: s.textColor || "#1a1a1a",
              resize: "none",
            }}
            onBlur={(e) => {
              onUpdate({ text: e.target.value });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onUpdate({ text: e.target.value });
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div>
            {(callout.text || "").split("\n").map((line, i) => (
              <div
                key={i}
                style={{
                  fontSize: i === 0 ? (s.titleFontSize || 12) : (s.detailFontSize || 11),
                  fontWeight: i === 0 ? (s.titleFontWeight || 700) : 400,
                  lineHeight: 1.4,
                  whiteSpace: "nowrap",
                }}
              >
                {line || "\u00a0"}
              </div>
            ))}
          </div>
        )}

        {/* Remove button */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#dc2626",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontSize: 11,
            lineHeight: "18px",
            textAlign: "center",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Remove callout"
        >
          ×
        </button>
      </div>
    </>
  );
}

export default function CalloutLayer({ callouts, map, templateStyle, onUpdateCallout, onRemoveCallout }) {
  const anchorPixels = useAnchorPixels(map, callouts || []);

  if (!callouts?.length) return null;

  return (
    <>
      {callouts.map((callout) => (
        <Callout
          key={callout.id}
          callout={callout}
          anchor={anchorPixels[callout.id]}
          templateStyle={templateStyle}
          onUpdate={(patch) => onUpdateCallout(callout.id, patch)}
          onRemove={() => onRemoveCallout(callout.id)}
        />
      ))}
    </>
  );
}
