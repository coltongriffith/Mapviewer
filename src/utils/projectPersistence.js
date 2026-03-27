import { downloadBlob } from "./svg";

export function saveProject(project, filename = "project") {
  const blob = new Blob(
    [JSON.stringify(project, null, 2)],
    { type: "application/json" }
  );
  downloadBlob(`${filename}.mapviewer.json`, blob);
}

export async function loadProject(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }

  if (!Array.isArray(parsed.layers) || typeof parsed.layout !== "object") {
    throw new Error("Invalid project file: missing layers or layout.");
  }

  return parsed;
}
