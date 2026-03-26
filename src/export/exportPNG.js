export async function exportPNG({ exportFn, options }) {
  if (typeof exportFn !== 'function') {
    throw new Error('exportPNG requires the existing runtime PNG export function for now.');
  }
  return exportFn(options);
}
