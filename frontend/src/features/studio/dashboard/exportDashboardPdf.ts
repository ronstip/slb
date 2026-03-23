import html2canvas from 'html2canvas-pro';
import jsPDF from 'jspdf';

const BRAND_COLOR = '#06B6D4';
const PAGE_MARGIN = 24;
const HEADER_HEIGHT = 50;

/** Convert the inline SVG logo to a PNG data URL via an offscreen canvas. */
async function loadLogoDataUrl(): Promise<string> {
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="18" fill="none" stroke="#e5e5e5" stroke-width="1.5"/>
    <circle cx="20" cy="20" r="14" fill="none" stroke="#d4d4d4" stroke-width="1.5"/>
    <circle cx="20" cy="20" r="10" fill="none" stroke="#a3a3a3" stroke-width="1.5"/>
    <circle cx="28" cy="12" r="2" fill="#f97316"/>
    <circle cx="32" cy="24" r="2" fill="#3b82f6"/>
    <circle cx="12" cy="28" r="2" fill="#a855f7"/>
    <line x1="20" y1="20" x2="28" y2="12" stroke="#d4d4d4" stroke-width="1"/>
    <line x1="20" y1="20" x2="32" y2="24" stroke="#d4d4d4" stroke-width="1"/>
    <line x1="20" y1="20" x2="12" y2="28" stroke="#d4d4d4" stroke-width="1"/>
    <circle cx="20" cy="20" r="6" fill="#06B6D4"/>
  </svg>`

  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  return new Promise<string>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      const scale = 3
      c.width = img.width * scale
      c.height = img.height * scale
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.src = url
  })
}

/**
 * Captures the dashboard grid and exports it as a professional PDF.
 * The entire grid is captured as one image, then sliced across pages.
 */
export async function exportDashboardPdf(
  gridElement: HTMLElement,
  projectName: string,
) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const contentW = pageW - PAGE_MARGIN * 2
  const contentStartY = PAGE_MARGIN + HEADER_HEIGHT + 8
  const availableH = pageH - contentStartY - PAGE_MARGIN - 16

  // Load logo for header
  const logoDataUrl = await loadLogoDataUrl()

  // ── Draw header on a page ──
  const drawHeader = (pageNum: number, totalPages: number) => {
    // Brand accent line
    pdf.setFillColor(BRAND_COLOR)
    pdf.rect(0, 0, pageW, 4, 'F')

    // Logo icon (square, matches text height)
    const logoH = 18
    const logoW = 18 // square viewBox
    const logoX = PAGE_MARGIN
    const logoY = PAGE_MARGIN + 5
    pdf.addImage(logoDataUrl, 'PNG', logoX, logoY, logoW, logoH)

    // Logo text: "Veille"
    const textX = logoX + logoW + 6
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(18)
    pdf.setTextColor('#171717')
    pdf.text('Veille', textX, PAGE_MARGIN + 18)

    // Project name + date (right-aligned)
    const dateStr = new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    pdf.setFontSize(10)
    pdf.setTextColor('#666666')
    pdf.text(projectName, pageW - PAGE_MARGIN, PAGE_MARGIN + 10, { align: 'right' })
    pdf.setFontSize(9)
    pdf.setTextColor('#999999')
    pdf.text(dateStr, pageW - PAGE_MARGIN, PAGE_MARGIN + 22, { align: 'right' })

    // Separator line
    pdf.setDrawColor('#E5E5E5')
    pdf.setLineWidth(0.5)
    pdf.line(PAGE_MARGIN, PAGE_MARGIN + HEADER_HEIGHT - 6, pageW - PAGE_MARGIN, PAGE_MARGIN + HEADER_HEIGHT - 6)

    // Page number
    pdf.setFontSize(8)
    pdf.setTextColor('#AAAAAA')
    pdf.text(
      `Page ${pageNum} of ${totalPages}`,
      pageW - PAGE_MARGIN,
      pageH - 12,
      { align: 'right' },
    )
  }

  // ── Capture the entire grid as one image ──
  const pixelRatio = 3
  const canvas = await html2canvas(gridElement, {
    scale: pixelRatio,
    useCORS: true,
    backgroundColor: '#ffffff',
  })

  // Scale: canvas pixels → PDF points (canvas is pixelRatio× larger than CSS pixels)
  const gridRect = gridElement.getBoundingClientRect()
  const cssToPdf = contentW / gridRect.width
  const pxToPdf = cssToPdf / pixelRatio // canvas pixels → PDF points

  const scaledH = canvas.height * pxToPdf

  // ── Find safe page-break Y positions using widget boundaries ──
  // Collect bottom edges of all widgets (in PDF points, relative to grid top)
  const widgets = gridElement.querySelectorAll<HTMLElement>('.react-grid-item')
  const widgetBottoms: number[] = []
  for (const w of widgets) {
    const r = w.getBoundingClientRect()
    widgetBottoms.push((r.bottom - gridRect.top) * cssToPdf)
  }
  widgetBottoms.sort((a, b) => a - b)

  // Build page slices: find the lowest widget bottom that fits each page
  const slices: Array<{ srcY: number; srcH: number; destH: number }> = []
  let currentY = 0 // in PDF points from top of grid

  while (currentY < scaledH - 1) {
    const maxBottom = currentY + availableH
    // Find the last widget bottom edge that fits within this page
    let breakY = maxBottom
    const candidates = widgetBottoms.filter((b) => b > currentY + 1 && b <= maxBottom)
    if (candidates.length > 0) {
      breakY = candidates[candidates.length - 1]
    } else if (maxBottom < scaledH) {
      // No widget boundary fits — use first bottom edge after currentY as fallback
      const next = widgetBottoms.find((b) => b > currentY + 1)
      breakY = next ?? maxBottom
    }
    breakY = Math.min(breakY, scaledH)
    const sliceH = breakY - currentY

    slices.push({
      srcY: currentY / pxToPdf, // convert to canvas pixels
      srcH: sliceH / pxToPdf,
      destH: sliceH,
    })
    currentY = breakY
  }

  // ── Render pages ──
  const totalPages = slices.length

  slices.forEach((slice, page) => {
    if (page > 0) pdf.addPage()
    drawHeader(page + 1, totalPages)

    // Extract the slice from the full canvas
    const sliceCanvas = document.createElement('canvas')
    sliceCanvas.width = canvas.width
    sliceCanvas.height = Math.ceil(slice.srcH)
    const ctx = sliceCanvas.getContext('2d')!
    ctx.drawImage(canvas, 0, -Math.round(slice.srcY))

    const imgData = sliceCanvas.toDataURL('image/png')
    pdf.addImage(
      imgData,
      'PNG',
      PAGE_MARGIN,
      contentStartY,
      contentW,
      slice.destH,
    )
  })

  // ── Save ──
  const safeName = projectName.replace(/[^a-zA-Z0-9]/g, '_')
  const dateStamp = new Date().toISOString().slice(0, 10)
  pdf.save(`${safeName}_Dashboard_${dateStamp}.pdf`)
}
