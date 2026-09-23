type Line = { value: string; start: number; end: number }
type Span = { type: string; start: number; end: number }
type Footer = 'none' | 'page' | 'all'

export type PdfLayout = {
  pages: Line[][][]
  spans: Span[]
  paper: string
  width: number
  height: number
  margin: number
  columns: number
  columnGap: number
  columnWidth: number
  fontSize: number
  family: string
  color: string
  alignment: 'left' | 'center' | 'right'
  footerMode: Footer
  footerDate: string
  footerHost: string
  syntaxColors: Record<string, string | undefined>
}

function carrierSize(layout: PdfLayout): [number, number] {
  const landscape = layout.width > layout.height
  const orient = ([w, h]: [number, number]): [number, number] => landscape ? [h, w] : [w, h]
  const preferred = orient(layout.paper === 'Letter' ? [216, 279] : [210, 297])
  if (layout.width <= preferred[0] && layout.height <= preferred[1]) return preferred
  const larger = orient([297, 420])
  if (layout.width <= larger[0] && layout.height <= larger[1]) return larger
  return [Math.max(layout.width, larger[0]), Math.max(layout.height, larger[1])]
}

export async function createPrintPdf(layout: PdfLayout): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib')
  const [carrierWidth, carrierHeight] = carrierSize(layout)
  const dpi = 220
  const pixelsPerMm = dpi / 25.4
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(carrierWidth * pixelsPerMm)
  canvas.height = Math.round(carrierHeight * pixelsPerMm)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  const pdf = await PDFDocument.create()
  const offsetX = (carrierWidth - layout.width) / 2
  const offsetY = (carrierHeight - layout.height) / 2
  const fontPx = layout.fontSize * dpi / 72
  const lineHeightPx = fontPx * 1.5

  for (const [pageIndex, page] of layout.pages.entries()) {
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.font = `${fontPx}px ${layout.family}`
    context.textBaseline = 'top'
    const startX = (offsetX + layout.margin) * pixelsPerMm
    const startY = (offsetY + layout.margin) * pixelsPerMm
    const columnWidthPx = layout.columnWidth * pixelsPerMm

    page.forEach((lines, columnIndex) => {
      const columnX = startX + columnIndex * (layout.columnWidth + layout.columnGap) * pixelsPerMm
      lines.forEach((line, lineIndex) => {
        const lineWidth = context.measureText(line.value).width
        let x = columnX + (layout.alignment === 'center' ? (columnWidthPx - lineWidth) / 2 : layout.alignment === 'right' ? columnWidthPx - lineWidth : 0)
        const y = startY + lineIndex * lineHeightPx
        let position = line.start
        for (const span of layout.spans) {
          if (span.end <= position) continue
          if (span.start >= line.end) break
          if (span.start > position) {
            const fragment = line.value.slice(position - line.start, span.start - line.start)
            context.fillStyle = layout.color
            context.fillText(fragment, x, y)
            x += context.measureText(fragment).width
          }
          const from = Math.max(position, span.start)
          const to = Math.min(line.end, span.end)
          if (to > from) {
            const fragment = line.value.slice(from - line.start, to - line.start)
            context.fillStyle = layout.syntaxColors[span.type] ?? layout.color
            context.fillText(fragment, x, y)
            x += context.measureText(fragment).width
          }
          position = Math.max(position, to)
        }
        if (position < line.end) {
          context.fillStyle = layout.color
          context.fillText(line.value.slice(position - line.start), x, y)
        }
      })
    })

    if (layout.footerMode !== 'none') {
      context.font = `${8 * dpi / 72}px 'Cascadia Mono', Consolas, monospace`
      context.fillStyle = '#637477'
      const y = (offsetY + layout.height - layout.margin - 4) * pixelsPerMm
      const left = (offsetX + layout.margin) * pixelsPerMm
      const right = (offsetX + layout.width - layout.margin) * pixelsPerMm
      const pageLabel = `${pageIndex + 1} / ${layout.pages.length}`
      if (layout.footerMode === 'all') {
        context.textAlign = 'left'
        context.fillText('TextPrint', left, y)
        context.textAlign = 'center'
        context.fillText(layout.footerHost, (left + right) / 2, y, Math.max(0, (right - left) / 3))
        context.textAlign = 'right'
        context.fillText(`${layout.footerDate} · ${pageLabel}`, right, y)
      } else {
        context.textAlign = 'center'
        context.fillText(pageLabel, (left + right) / 2, y)
      }
      context.textAlign = 'left'
    }
    // Canvas keeps the selected system fonts and CJK text without bundling a large font file.
    // PDF pages have a physical carrier size (A5 content on A4 by default).
    const pdfPage = pdf.addPage([carrierWidth * 72 / 25.4, carrierHeight * 72 / 25.4])
    const image = await pdf.embedJpg(canvas.toDataURL('image/jpeg', 0.96))
    pdfPage.drawImage(image, { x: 0, y: 0, width: pdfPage.getWidth(), height: pdfPage.getHeight() })
  }
  const bytes = await pdf.save()
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
}
