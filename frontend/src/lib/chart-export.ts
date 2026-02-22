import html2canvas from 'html2canvas-pro';

export async function chartToCanvas(el: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(el, {
    backgroundColor: null,
    scale: 2,
  });
}

export async function downloadChartPng(el: HTMLElement, filename: string) {
  const canvas = await chartToCanvas(el);
  const link = document.createElement('a');
  link.download = `${filename}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export async function copyChartToClipboard(el: HTMLElement) {
  const canvas = await chartToCanvas(el);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png'),
  );
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ]);
}
