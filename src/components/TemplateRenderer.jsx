import React from "react";
import Legend from "./Legend";
import NorthArrow from "./NorthArrow";
import ScaleBar from "./ScaleBar";
import InsetMap from "./InsetMap";

function anchorStyle(anchor, margin) {
  const m = margin || {};
  const style = { position: "absolute", zIndex: 500 };

  if (anchor === "bottom-left") {
    style.bottom = m.bottom ?? 16;
    style.left = m.left ?? 16;
  } else if (anchor === "bottom-right") {
    style.bottom = m.bottom ?? 16;
    style.right = m.right ?? 16;
  } else if (anchor === "top-right") {
    style.top = m.top ?? 16;
    style.right = m.right ?? 16;
  } else if (anchor === "top-left") {
    style.top = m.top ?? 16;
    style.left = m.left ?? 16;
  } else if (anchor === "bottom-center") {
    style.bottom = m.bottom ?? 16;
    style.left = "50%";
    style.transform = "translateX(-50%)";
  } else if (anchor === "top-center") {
    style.top = m.top ?? 16;
    style.left = "50%";
    style.transform = "translateX(-50%)";
  }

  return style;
}

export default function TemplateRenderer({ template, project, map }) {
  if (!template) return null;

  const { layout, titleBlockStyle, legendStyle, northArrowStyle, scaleBarStyle, insetMapStyle, logoStyle } = template;
  const { title, subtitle, logo, insetEnabled } = project.layout || {};
  const layers = project.layers || [];
  const basemap = project.layout?.basemap || "topo";

  return (
    <>
      {/* Title block */}
      <div style={anchorStyle(layout.titleBlock.anchor, layout.titleBlock.margin)}>
        <div
          style={{
            background: titleBlockStyle.background,
            color: titleBlockStyle.color,
            borderRadius: titleBlockStyle.borderRadius,
            padding: titleBlockStyle.padding,
            fontFamily: titleBlockStyle.fontFamily,
            maxWidth: titleBlockStyle.maxWidth,
            boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
          }}
        >
          {title && (
            <div
              style={{
                fontSize: titleBlockStyle.titleFontSize,
                fontWeight: titleBlockStyle.titleFontWeight,
                lineHeight: 1.2,
                letterSpacing: 0.3,
              }}
            >
              {title}
            </div>
          )}
          {subtitle && (
            <div
              style={{
                fontSize: titleBlockStyle.subtitleFontSize,
                opacity: titleBlockStyle.subtitleOpacity,
                marginTop: 4,
                lineHeight: 1.3,
              }}
            >
              {subtitle}
            </div>
          )}
          {!title && !subtitle && (
            <div style={{ fontSize: 12, opacity: 0.5, fontStyle: "italic" }}>
              Add title in Layout tab
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={anchorStyle(layout.legend.anchor, layout.legend.margin)}>
        <Legend layers={layers} templateStyle={legendStyle} />
      </div>

      {/* North Arrow */}
      <div style={anchorStyle(layout.northArrow.anchor, layout.northArrow.margin)}>
        <NorthArrow templateStyle={northArrowStyle} />
      </div>

      {/* Scale Bar */}
      <div style={anchorStyle(layout.scaleBar.anchor, layout.scaleBar.margin)}>
        <ScaleBar map={map} templateStyle={scaleBarStyle} />
      </div>

      {/* Inset Map */}
      {insetEnabled && map && (
        <div style={anchorStyle(layout.insetMap.anchor, layout.insetMap.margin)}>
          <InsetMap
            mainMap={map}
            basemap={basemap}
            templateStyle={insetMapStyle}
            width={layout.insetMap.width}
            height={layout.insetMap.height}
          />
        </div>
      )}

      {/* Logo */}
      {logo && (
        <div style={anchorStyle(layout.logo.anchor, layout.logo.margin)}>
          <div
            style={{
              background: logoStyle.background,
              border: logoStyle.border,
              borderRadius: logoStyle.borderRadius,
              padding: logoStyle.padding,
              boxShadow: logoStyle.boxShadow,
            }}
          >
            <img
              src={logo}
              alt="Company logo"
              style={{
                display: "block",
                maxWidth: layout.logo.maxWidth,
                height: "auto",
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
