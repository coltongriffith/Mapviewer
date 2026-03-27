// MAP_TEMPLATES defines named overlay position layouts.
// x/y values are px offsets from the top-left of the map container.
// Special string values are resolved at apply-time in App.jsx:
//   "center"   → (containerWidth / 2) - (elementWidth / 2)
//   "right-N"  → containerWidth - N

export const MAP_TEMPLATES = {
  default: {
    label: "Standard",
    overlaysPatch: {
      title:      { x: 24,        y: 20 },
      legend:     { x: 24,        y: 96 },
      northArrow: { x: 24,        y: 340 },
      scaleBar:   { x: 24,        y: 410 },
      logo:       { x: 24,        y: 470, width: 140 },
    },
  },
  "regional-overview": {
    label: "Regional Overview",
    // Title centered at top; legend/compass/scale on the right side
    overlaysPatch: {
      title:      { x: "center",  y: 18  },
      legend:     { x: "right-244", y: 20  },
      northArrow: { x: "right-70",  y: 300 },
      scaleBar:   { x: "right-160", y: 370 },
      logo:       { x: 24,          y: 20,  width: 120 },
    },
  },
};
