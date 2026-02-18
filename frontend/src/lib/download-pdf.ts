import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';

/**
 * Force light-mode styles on the element for PDF capture, then restore.
 * This ensures dark-mode text is visible on the white background.
 */
function applyLightStyles(el: HTMLElement): () => void {
  const origClass = el.className;
  // Add a temporary class that forces light colors
  el.style.setProperty('color', '#1a1a1a', 'important');
  el.style.setProperty('background-color', '#ffffff', 'important');

  // Force all text nodes to dark color for pdf readability
  const styled: Array<{ el: HTMLElement; prev: string }> = [];
  el.querySelectorAll<HTMLElement>('*').forEach((child) => {
    const computed = getComputedStyle(child);
    const color = computed.color;
    // If text is light (likely dark-mode), override to dark
    const rgb = color.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
    const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    if (brightness > 160) {
      styled.push({ el: child, prev: child.style.color });
      child.style.setProperty('color', '#1a1a1a', 'important');
    }
  });

  return () => {
    el.className = origClass;
    el.style.removeProperty('color');
    el.style.removeProperty('background-color');
    styled.forEach(({ el: child, prev }) => {
      if (prev) child.style.color = prev;
      else child.style.removeProperty('color');
    });
  };
}

export async function downloadReportPdf(element: HTMLElement, filename = 'insight-report') {
  const restore = applyLightStyles(element);

  try {
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      // Inline SVGs (used by Recharts) need foreign object rendering off
      foreignObjectRendering: false,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const usableHeight = pageHeight - margin * 2;

    if (imgHeight <= usableHeight) {
      pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
    } else {
      // Multi-page: slice the canvas into page-sized chunks for clean breaks
      const scaleFactor = imgWidth / canvas.width;
      const sliceHeightPx = usableHeight / scaleFactor;
      let srcY = 0;
      let page = 0;

      while (srcY < canvas.height) {
        if (page > 0) pdf.addPage();
        const h = Math.min(sliceHeightPx, canvas.height - srcY);

        // Create a slice canvas for this page
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = h;
        const ctx = sliceCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(canvas, 0, srcY, canvas.width, h, 0, 0, canvas.width, h);
          const sliceImg = sliceCanvas.toDataURL('image/png');
          const sliceH = h * scaleFactor;
          pdf.addImage(sliceImg, 'PNG', margin, margin, imgWidth, sliceH);
        }

        srcY += h;
        page++;
      }
    }

    pdf.save(`${filename}.pdf`);
  } finally {
    restore();
  }
}
