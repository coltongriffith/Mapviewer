export async function loadGeoJSON(file) {
  if (!file) {
    throw new Error("No file provided.");
  }

  const text = await file.text();
  const data = JSON.parse(text);

  if (!data || typeof data !== "object") {
    throw new Error("Invalid GeoJSON file.");
  }

  return data;
}
