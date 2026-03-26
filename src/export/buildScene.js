export function buildScene({ width, height, project }) {
  return {
    width,
    height,
    basemap: project?.basemap || null,
    vectorLayers: project?.layers?.filter((l) => !l?.isPoint) || [],
    pointLayers: project?.layers?.filter((l) => l?.isPoint) || [],
    labels: [],
    curvedLabels: project?.curvedLabels || [],
    callouts: project?.callouts || [],
    textItems: project?.textEls || [],
    legend: project?.showLegend ? { items: project?.legendItems || [], position: project?.legendPos } : null,
    titleBlock: { title: project?.title || '', subtitle: project?.subtitle || '', position: project?.titlePos },
    logo: project?.logo ? { src: project.logo, position: project?.logoPos } : null,
    inset: project?.showInset && project?.insetImage ? { src: project.insetImage, position: project?.insetPos } : null,
    northArrow: project?.northArrow ? { enabled: true } : null,
    images: project?.canvasImages || [],
  };
}
