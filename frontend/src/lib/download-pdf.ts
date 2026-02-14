import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';

export async function downloadReportPdf(element: HTMLElement, filename = 'insight-report') {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
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
    // Single page
    pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
  } else {
    // Multi-page: slice the canvas image across pages
    let position = 0;
    while (position < imgHeight) {
      if (position > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, margin - position, imgWidth, imgHeight);
      position += usableHeight;
    }
  }

  pdf.save(`${filename}.pdf`);
}
