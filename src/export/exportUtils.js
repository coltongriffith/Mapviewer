export function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

export function waitForTiles() {
  const tiles = document.querySelectorAll(".leaflet-tile");
  if (!tiles.length) return Promise.resolve();
  return Promise.all(
    Array.from(tiles).map(
      (tile) =>
        new Promise((resolve) => {
          if (tile.complete) return resolve();
          tile.onload  = resolve;
          tile.onerror = resolve;
        })
    )
  );
}
