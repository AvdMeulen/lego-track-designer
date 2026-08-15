export async function exportSvgElementToPng(svg: SVGSVGElement, filename = 'lego-track-design.png'): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const box = svg.viewBox.baseVal;
  const width = Math.max(box.width || svg.clientWidth || 1200, 800);
  const height = Math.max(box.height || svg.clientHeight || 800, 600);
  clone.setAttribute('width', `${width}`);
  clone.setAttribute('height', `${height}`);

  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not create canvas context');
    }
    context.fillStyle = '#fffdf8';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    await downloadCanvas(canvas, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not rasterize SVG'));
    image.src = url;
  });
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG export failed'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
}
