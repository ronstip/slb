import html2canvas from 'html2canvas-pro';
import jsPDF from 'jspdf';
import type { DashboardOrientation } from './types-social-dashboard.ts';

// ── Scolto brand tokens (mirrors frontend/src/auth/LandingPage.tsx) ──────────
const BRAND_ORANGE = '#D97757'
const BRAND_INK = '#1B1815'
const BRAND_MUTED = '#6E665A'
const BRAND_HAIRLINE = '#E8E3D8'
const BRAND_PAPER = '#FBFAF6'

const PAGE_MARGIN = 56            // left / right gutter
const TOP_BAND_H = 52             // cream + orange chrome band at top of every page
const TOP_GUTTER = 16             // breathing room between band and content
const FOOTER_HEIGHT = 32          // vertical room reserved for footer chrome
const PIXEL_RATIO = 2
const JPEG_QUALITY = 0.82

const SCOLTO_URL = 'https://scolto.com'

// Hebrew (U+0590-05FF) + Arabic + presentation forms — RTL detection.
const RTL_PATTERN = /[֐-׿؀-ۿݐ-ݿיִ-ﻼ]/

const SERIF_STACK = `'Fraunces', 'David Libre', 'Frank Ruhl Libre', 'Iowan Old Style', 'Apple Garamond', 'Times New Roman', Georgia, serif`
const MONO_STACK = `'JetBrains Mono', 'SF Mono', 'Menlo', Consolas, monospace`

/** Scolto cornermark — mirrors LP_ScoltoMark from the landing page. */
async function loadLogoDataUrl(strokeColor: string = BRAND_INK): Promise<string> {
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="${strokeColor}" stroke-width="3.4" stroke-linecap="round">
    <path d="M4 18 V4 H18"/>
    <path d="M46 4 H60 V18"/>
    <path d="M60 46 V60 H46"/>
    <path d="M18 60 H4 V46"/>
    <circle cx="32" cy="32" r="8" fill="${BRAND_ORANGE}" stroke="none"/>
  </svg>`

  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  return new Promise<string>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      const scale = 4
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

/** Render Unicode text to a PNG via canvas. Built-in PDF fonts can't render
 *  Hebrew/Arabic/CJK, and canvas lets us pick richer typography (tracked mono,
 *  italic serif) than the bundled helvetica. */
function renderTextToImage(
  text: string,
  opts: {
    fontSize: number
    fontFamily?: string
    fontWeight?: string
    fontStyle?: string
    color: string
    align?: 'left' | 'right' | 'center'
    letterSpacing?: number
    maxWidthPt?: number
  },
): { dataUrl: string; widthPt: number; heightPt: number } {
  const {
    fontSize,
    fontWeight = 'normal',
    fontStyle = 'normal',
    color,
    align = 'left',
    letterSpacing = 0,
    fontFamily = `system-ui, -apple-system, 'Segoe UI', 'Noto Sans', 'Noto Sans Hebrew', 'Noto Sans Arabic', 'Noto Sans CJK SC', Arial, sans-serif`,
    maxWidthPt,
  } = opts
  const baseScale = 3

  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')!
  measureCtx.font = `${fontStyle} ${fontWeight} ${fontSize * baseScale}px ${fontFamily}`

  let rawWidthPx = 0
  if (letterSpacing > 0) {
    for (const ch of text) {
      rawWidthPx += measureCtx.measureText(ch).width + letterSpacing * baseScale
    }
    rawWidthPx = Math.max(0, rawWidthPx - letterSpacing * baseScale)
  } else {
    rawWidthPx = measureCtx.measureText(text).width
  }

  const naturalWidthPt = rawWidthPx / baseScale
  const shrink = maxWidthPt !== undefined && naturalWidthPt > maxWidthPt
    ? maxWidthPt / naturalWidthPt
    : 1
  const effScale = baseScale * shrink
  const effFontSize = fontSize * effScale
  const effLetterSpacing = letterSpacing * effScale

  const fontSpec = `${fontStyle} ${fontWeight} ${effFontSize}px ${fontFamily}`
  measureCtx.font = fontSpec

  let widthPxFinal = 0
  if (letterSpacing > 0) {
    for (const ch of text) {
      widthPxFinal += measureCtx.measureText(ch).width + effLetterSpacing
    }
    widthPxFinal = Math.max(0, widthPxFinal - effLetterSpacing)
  } else {
    widthPxFinal = measureCtx.measureText(text).width
  }

  const metrics = measureCtx.measureText(text)
  const ascent = metrics.actualBoundingBoxAscent || effFontSize * 0.82
  const descent = metrics.actualBoundingBoxDescent || effFontSize * 0.25
  const heightPx = Math.ceil(ascent + descent + 6)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(Math.ceil(widthPxFinal) + 8, 4)
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')!
  ctx.font = fontSpec
  ctx.fillStyle = color
  ctx.textBaseline = 'alphabetic'

  if (letterSpacing > 0) {
    let cursorX: number
    if (align === 'left') cursorX = 4
    else if (align === 'right') cursorX = canvas.width - widthPxFinal - 4
    else cursorX = (canvas.width - widthPxFinal) / 2
    ctx.textAlign = 'left'
    for (const ch of text) {
      ctx.fillText(ch, cursorX, ascent + 2)
      cursorX += ctx.measureText(ch).width + effLetterSpacing
    }
  } else {
    ctx.textAlign = align as CanvasTextAlign
    const x = align === 'right' ? canvas.width - 4 : align === 'center' ? canvas.width / 2 : 4
    ctx.fillText(text, x, ascent + 2)
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    widthPt: canvas.width / effScale,
    heightPt: canvas.height / effScale,
  }
}

/** Wait until webfonts and images have loaded so html2canvas captures real glyphs. */
async function waitForRenderReady(root: HTMLElement): Promise<void> {
  if (document.fonts && typeof document.fonts.ready !== 'undefined') {
    try {
      await document.fonts.ready
    } catch {
      /* proceed */
    }
  }
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          }),
    ),
  )
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
}

/** The markdown widget puts per-paragraph dir="rtl" on Hebrew blocks but leaves
 *  the parent <ul>/<ol> LTR — so list bullets land on the far-left edge.
 *  Flip dir on the prose wrapper for capture only. */
function applyRtlListFixup(root: HTMLElement): () => void {
  const proseEls = Array.from(root.querySelectorAll<HTMLElement>('.agent-prose'))
  const restores: Array<() => void> = []
  for (const el of proseEls) {
    const text = el.textContent ?? ''
    if (!RTL_PATTERN.test(text)) continue
    const prevDir = el.getAttribute('dir')
    el.setAttribute('dir', 'rtl')
    restores.push(() => {
      if (prevDir === null) el.removeAttribute('dir')
      else el.setAttribute('dir', prevDir)
    })
  }
  return () => restores.forEach((r) => r())
}

// `reportTitle` kept in the signature for forward compatibility (filename uses it).
// The visible header chrome no longer prints it.
export async function exportDashboardPdf(
  gridElement: HTMLElement,
  reportTitle: string,
  orientation: DashboardOrientation = 'horizontal',
) {
  const pdfOrientation = orientation === 'vertical' ? 'portrait' : 'landscape'
  const pdf = new jsPDF({
    orientation: pdfOrientation,
    unit: 'pt',
    format: 'a4',
    compress: true,
  })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const contentW = pageW - PAGE_MARGIN * 2
  const contentStartY = TOP_BAND_H + TOP_GUTTER
  const contentEndY = pageH - FOOTER_HEIGHT - 8
  const availableH = contentEndY - contentStartY

  // ── Pre-rendered chrome assets ───────────────────────────────────────────
  const logoDataUrl = await loadLogoDataUrl(BRAND_INK)
  const wordmarkImg = renderTextToImage('Scolto', {
    fontSize: 13,
    fontFamily: SERIF_STACK,
    fontStyle: 'italic',
    fontWeight: '400',
    color: BRAND_INK,
  })

  const eyebrowImg = renderTextToImage('INTELLIGENCE  REPORT', {
    fontSize: 7.5,
    fontFamily: MONO_STACK,
    fontWeight: '600',
    color: BRAND_ORANGE,
    letterSpacing: 1.8,
  })

  const dateStr = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const dateImg = renderTextToImage(dateStr.toUpperCase(), {
    fontSize: 7.5,
    fontFamily: MONO_STACK,
    fontWeight: '500',
    color: BRAND_MUTED,
    letterSpacing: 1.4,
    align: 'right',
  })

  const copyrightYear = new Date().getFullYear()

  // ── Top band (every page, same):  [▢] Scolto    INTELLIGENCE REPORT    DATE
  const drawTopBand = () => {
    // Cream paper-tone band
    pdf.setFillColor(BRAND_PAPER)
    pdf.rect(0, 0, pageW, TOP_BAND_H, 'F')

    // Orange accent line, full bleed
    pdf.setFillColor(BRAND_ORANGE)
    pdf.rect(0, 0, pageW, 2, 'F')

    // Logo (cornermark) + wordmark — left side
    const logoSize = 14
    const logoY = TOP_BAND_H / 2 - logoSize / 2 + 1
    pdf.addImage(logoDataUrl, 'PNG', PAGE_MARGIN, logoY, logoSize, logoSize)

    const wmH = 13
    const wmW = wordmarkImg.widthPt * (wmH / wordmarkImg.heightPt)
    const wmY = TOP_BAND_H / 2 - wmH / 2 + 1
    pdf.addImage(
      wordmarkImg.dataUrl,
      'PNG',
      PAGE_MARGIN + logoSize + 5,
      wmY,
      wmW,
      wmH,
    )

    // Right column: eyebrow stacked above date, both right-aligned
    const gap = 8
    const stackH = eyebrowImg.heightPt + gap + dateImg.heightPt
    const eyebrowY = TOP_BAND_H / 2 - stackH / 2 + 1
    pdf.addImage(
      eyebrowImg.dataUrl,
      'PNG',
      pageW - PAGE_MARGIN - eyebrowImg.widthPt,
      eyebrowY,
      eyebrowImg.widthPt,
      eyebrowImg.heightPt,
    )
    pdf.addImage(
      dateImg.dataUrl,
      'PNG',
      pageW - PAGE_MARGIN - dateImg.widthPt,
      eyebrowY + eyebrowImg.heightPt + gap,
      dateImg.widthPt,
      dateImg.heightPt,
    )

    // Hairline at bottom of band
    pdf.setDrawColor(BRAND_HAIRLINE)
    pdf.setLineWidth(0.5)
    pdf.line(PAGE_MARGIN, TOP_BAND_H, pageW - PAGE_MARGIN, TOP_BAND_H)
  }

  // ── Footer (every page): orange dot · Scolto (link) · copyright | page #
  const drawFooter = (pageNum: number, totalPages: number) => {
    // Top hairline of the footer
    pdf.setDrawColor(BRAND_HAIRLINE)
    pdf.setLineWidth(0.5)
    pdf.line(PAGE_MARGIN, pageH - FOOTER_HEIGHT, pageW - PAGE_MARGIN, pageH - FOOTER_HEIGHT)

    const baselineY = pageH - 14
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)

    // Small orange dot on the LEFT
    pdf.setFillColor(BRAND_ORANGE)
    pdf.circle(PAGE_MARGIN + 2, baselineY - 2, 1.4, 'F')

    // "Scolto" — clickable hyperlink, ink color (subtle), still discoverable
    const scoltoX = PAGE_MARGIN + 9
    const scoltoLabel = 'Scolto'
    const scoltoW = pdf.getTextWidth(scoltoLabel)
    pdf.setTextColor(BRAND_INK)
    pdf.textWithLink(scoltoLabel, scoltoX, baselineY, { url: SCOLTO_URL })

    // Rest of the line — muted
    const restLabel = `  ·  © ${copyrightYear} Scolto. All rights reserved.`
    pdf.setTextColor(BRAND_MUTED)
    pdf.text(restLabel, scoltoX + scoltoW, baselineY)

    // Right: page indicator
    pdf.text(
      `Page ${pageNum} of ${totalPages}`,
      pageW - PAGE_MARGIN,
      baselineY,
      { align: 'right' },
    )
  }

  // ── Capture ──────────────────────────────────────────────────────────────
  const restoreRtl = applyRtlListFixup(gridElement)

  try {
    await waitForRenderReady(gridElement)

    const canvas = await html2canvas(gridElement, {
      scale: PIXEL_RATIO,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      // @ts-expect-error — letterRendering is an html2canvas option
      letterRendering: true,
    })

    const gridRect = gridElement.getBoundingClientRect()
    const cssToPdf = contentW / gridRect.width
    const pxToPdf = cssToPdf / PIXEL_RATIO
    const scaledH = canvas.height * pxToPdf

    // Widget bottoms → clean page breaks
    const widgets = gridElement.querySelectorAll<HTMLElement>('.react-grid-item')
    const widgetBottoms: number[] = []
    for (const w of widgets) {
      const r = w.getBoundingClientRect()
      widgetBottoms.push((r.bottom - gridRect.top) * cssToPdf + 4)
    }
    widgetBottoms.sort((a, b) => a - b)

    const slices: Array<{ srcY: number; srcH: number; destH: number }> = []
    let currentY = 0
    const MIN_SLICE_H = 40

    while (currentY < scaledH - 1) {
      const maxBottom = currentY + availableH
      let breakY = Math.min(maxBottom, scaledH)
      const candidates = widgetBottoms.filter(
        (b) => b > currentY + MIN_SLICE_H && b <= maxBottom,
      )
      if (candidates.length > 0) {
        breakY = candidates[candidates.length - 1]
      } else if (maxBottom < scaledH) {
        breakY = maxBottom
      }
      breakY = Math.min(breakY, scaledH)
      const sliceH = breakY - currentY
      if (sliceH < 1) break

      slices.push({
        srcY: currentY / pxToPdf,
        srcH: sliceH / pxToPdf,
        destH: sliceH,
      })
      currentY = breakY
    }

    // ── Render pages ─────────────────────────────────────────────────────
    const totalPages = slices.length
    const sliceCanvas = document.createElement('canvas')
    const sliceCtx = sliceCanvas.getContext('2d')!

    slices.forEach((slice, page) => {
      if (page > 0) pdf.addPage()
      drawTopBand()
      drawFooter(page + 1, totalPages)

      const srcH = Math.ceil(slice.srcH)
      sliceCanvas.width = canvas.width
      sliceCanvas.height = srcH
      sliceCtx.fillStyle = '#ffffff'
      sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height)
      sliceCtx.drawImage(canvas, 0, -Math.round(slice.srcY))

      const imgData = sliceCanvas.toDataURL('image/jpeg', JPEG_QUALITY)
      pdf.addImage(
        imgData,
        'JPEG',
        PAGE_MARGIN,
        contentStartY,
        contentW,
        slice.destH,
        undefined,
        'FAST',
      )
    })

    // User-friendly filename: "Scolto - {Report Title} - 14 May 2026.pdf"
    // Strip only filesystem-illegal characters; preserve Unicode (Hebrew, etc.)
    const cleanTitle =
      reportTitle
        .replace(/[/\\:*?"<>|\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'Dashboard'
    pdf.save(`Scolto - ${cleanTitle} - ${dateStr}.pdf`)
  } finally {
    restoreRtl()
  }
}
