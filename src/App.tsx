import { Printer, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { countBucket, durationBucket, trackEvent } from './analytics'
import './App.css'

type Paper = 'A3' | 'A4' | 'A5' | 'A6' | 'Letter' | 'custom'
type Orientation = 'portrait' | 'landscape'
type Alignment = 'left' | 'center' | 'right'
type FooterMode = 'all' | 'page' | 'none'
const PAPER: Record<Exclude<Paper, 'custom'>, [number, number]> = {
  A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148], Letter: [216, 279],
}
const FONTS = [
  { label: '无衬线', value: 'sans', family: "'Noto Sans SC', 'Microsoft YaHei UI', Arial, sans-serif" },
  { label: '衬线', value: 'serif', family: "'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif" },
  { label: '等宽', value: 'mono', family: "'Cascadia Mono', 'SFMono-Regular', 'Noto Sans Mono CJK SC', Consolas, monospace" },
] as const
const pxPerMm = 96 / 25.4
const pxPerPt = 96 / 72
const EMPTY_SPANS: SyntaxSpan[] = []
type WrappedLine = { value: string; start: number; end: number }
type SyntaxSpan = { type: 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'type' | 'function' | 'constant' | 'operator'; start: number; end: number }
const SYNTAX_COLORS: Record<SyntaxSpan['type'], string | undefined> = {
  plain: undefined, comment: '#637581', string: '#9a542e', number: '#8155ad',
  keyword: '#a13163', type: '#336b84', function: '#276d77',
  constant: '#8057a2', operator: '#3d668c',
}

function linesForText(text: string, maxWidthPx: number, font: string): WrappedLine[] {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return [{ value: text, start: 0, end: text.length }]
  context.font = font
  const lines: WrappedLine[] = []
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  let paragraphStart = 0
  for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    const chars = segmenter ? Array.from(segmenter.segment(paragraph), (part) => part.segment) : Array.from(paragraph)
    const offsets = [0]
    for (const char of chars) offsets.push(offsets[offsets.length - 1] + char.length)
    if (!chars.length) {
      lines.push({ value: '', start: paragraphStart, end: paragraphStart })
      paragraphStart += 1
      continue
    }
    let start = 0
    while (start < chars.length) {
      let end = start + 1
      let lastSpace = -1
      while (end <= chars.length && context.measureText(chars.slice(start, end).join('')).width <= maxWidthPx) {
        if (/\s/u.test(chars[end - 1])) lastSpace = end
        end++
      }
      const fitted = Math.max(start + 1, end - 1)
      const split = fitted < chars.length && lastSpace > start ? lastSpace : fitted
      lines.push({ value: chars.slice(start, split).join(''), start: paragraphStart + offsets[start], end: paragraphStart + offsets[split] })
      start = split
    }
    paragraphStart += paragraph.length + 1
  }
  return lines
}

function Line({ line, spans }: { line: WrappedLine; spans: SyntaxSpan[] }) {
  if (!spans.length || !line.value) return <>{line.value}</>
  const fragments: ReactNode[] = []
  let position = line.start
  for (const span of spans) {
    if (span.end <= position) continue
    if (span.start >= line.end) break
    if (span.start > position) fragments.push(line.value.slice(position - line.start, span.start - line.start))
    const from = Math.max(position, span.start)
    const to = Math.min(line.end, span.end)
    if (to > from) fragments.push(<span key={from} style={{ color: SYNTAX_COLORS[span.type] }}>{line.value.slice(from - line.start, to - line.start)}</span>)
    position = Math.max(position, to)
  }
  if (position < line.end) fragments.push(line.value.slice(position - line.start))
  return <>{fragments}</>
}

function App() {
  const [text, setText] = useState('')
  const [paper, setPaper] = useState<Paper>('A4')
  const [orientation, setOrientation] = useState<Orientation>('portrait')
  const [customWidth, setCustomWidth] = useState(210)
  const [customHeight, setCustomHeight] = useState(297)
  const [margin, setMargin] = useState(15)
  const [columns, setColumns] = useState(1)
  const [columnGap, setColumnGap] = useState(8)
  const [footerMode, setFooterMode] = useState<FooterMode>('none')
  const [font, setFont] = useState<(typeof FONTS)[number]['value']>('sans')
  const [fontSize, setFontSize] = useState(12)
  const [color, setColor] = useState('#1a1d20')
  const [alignment, setAlignment] = useState<Alignment>('left')
  const [syntaxHighlight, setSyntaxHighlight] = useState(false)
  const [highlightResult, setHighlightResult] = useState<{ source: string; spans: SyntaxSpan[] } | null>(null)
  const [highlightStatus, setHighlightStatus] = useState<'idle' | 'working' | 'ready' | 'unsupported' | 'error'>('idle')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSummaryPending, setPreviewSummaryPending] = useState(false)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'working' | 'ready' | 'error'>('idle')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewOpenedAtRef = useRef<number | null>(null)
  const highlightDurationBucketRef = useRef<string | null>(null)
  const pdfGenerationResultTrackedRef = useRef(false)
  const highlightSummaryTrackedRef = useRef(false)
  const normalizedText = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
  const spans = syntaxHighlight && highlightStatus === 'ready' && highlightResult?.source === normalizedText ? highlightResult.spans : EMPTY_SPANS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  useEffect(() => {
    if (!syntaxHighlight || !normalizedText.trim()) {
      setHighlightStatus('idle')
      highlightDurationBucketRef.current = null
      return
    }
    if (!('gpu' in navigator)) {
      setHighlightStatus('unsupported')
      highlightDurationBucketRef.current = null
      return
    }
    let cancelled = false
    const startedAt = performance.now()
    setHighlightStatus('working')
    highlightDurationBucketRef.current = null
    const timer = setTimeout(async () => {
      try {
        const { parse } = await import('gpu-lexer')
        const result = await parse(normalizedText)
        if (!cancelled) {
          setHighlightResult({ source: normalizedText, spans: result })
          setHighlightStatus('ready')
          highlightDurationBucketRef.current = durationBucket(performance.now() - startedAt)
        }
      } catch {
        if (!cancelled) {
          setHighlightStatus('error')
          highlightDurationBucketRef.current = durationBucket(performance.now() - startedAt)
        }
      }
    }, 180)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [syntaxHighlight, normalizedText])

  useEffect(() => {
    if (!previewSummaryPending || highlightSummaryTrackedRef.current) return
    if (syntaxHighlight && (highlightStatus === 'idle' || highlightStatus === 'working')) return
    const status = !syntaxHighlight
      ? 'disabled'
      : highlightStatus === 'ready'
        ? 'succeeded'
        : highlightStatus === 'error'
          ? 'failed'
          : highlightStatus === 'unsupported'
            ? 'unsupported'
            : 'not_run'
    trackEvent('syntax_highlight_result', {
      enabled: syntaxHighlight,
      status,
      ...(highlightDurationBucketRef.current === null ? {} : { duration_bucket: highlightDurationBucketRef.current }),
    })
    highlightSummaryTrackedRef.current = true
  }, [highlightStatus, previewSummaryPending, syntaxHighlight])

  const rawSize = paper === 'custom' ? [customWidth, customHeight] : PAPER[paper]
  const [width, height] = orientation === 'portrait' ? rawSize : [rawSize[1], rawSize[0]]
  const family = FONTS.find((item) => item.value === font)?.family ?? FONTS[0].family
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const safeMargin = Math.min(Math.max(0, margin), Math.max(0, Math.min(safeWidth, safeHeight) / 2 - 1))
  const contentWidth = safeWidth - 2 * safeMargin
  const footerReserve = footerMode === 'none' ? 0 : 10
  const contentHeight = safeHeight - 2 * safeMargin - footerReserve
  const columnWidth = (contentWidth - (columns - 1) * columnGap) / columns
  const validDimensions = width >= 50 && width <= 420 && height >= 50 && height <= 420
    && margin >= 0 && margin * 2 < Math.min(width, height)
    && (columns === 1 || (columnGap >= 0 && columnGap <= 30)) && columnWidth >= 12 && contentHeight >= 12

  const pages = useMemo(() => {
    if (!normalizedText) return [[[]]] as WrappedLine[][][]
    const lineHeightPx = fontSize * pxPerPt * 1.5
    const linesPerColumn = Math.max(1, Math.floor((contentHeight * pxPerMm - 2) / lineHeightPx))
    const lines = linesForText(normalizedText, Math.max(1, columnWidth * pxPerMm - 3), `${fontSize * pxPerPt}px ${family}`)
    const result: WrappedLine[][][] = []
    for (let i = 0; i < lines.length; i += linesPerColumn * columns) {
      result.push(Array.from({ length: columns }, (_, column) =>
        lines.slice(i + column * linesPerColumn, i + (column + 1) * linesPerColumn)))
    }
    return result
  }, [normalizedText, columnWidth, contentHeight, fontSize, family, columns])
  const footerDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const footerHost = window.location.hostname
  const analyticsLayout = () => ({
    paper,
    orientation,
    width_mm: safeWidth,
    height_mm: safeHeight,
    margin_mm: safeMargin,
    columns,
    column_gap_mm: columns > 1 ? columnGap : 0,
    font,
    font_size_pt: fontSize,
    text_color: color,
    alignment,
    footer_mode: footerMode,
    syntax_highlight: syntaxHighlight,
    text_length_bucket: countBucket(normalizedText.length),
    line_count_bucket: countBucket(normalizedText.trim() ? normalizedText.split('\n').length : 0),
    page_count: pages.length,
  })
  const closeDialog = useCallback((source: 'button' | 'backdrop' | 'escape' = 'button') => {
    const dialog = dialogRef.current
    if (!dialog?.open || dialog.classList.contains('is-closing')) return
    const openedAt = previewOpenedAtRef.current
    if (isIOS && pdfStatus === 'working' && !pdfGenerationResultTrackedRef.current) {
      pdfGenerationResultTrackedRef.current = true
      trackEvent('pdf_generation_result', { status: 'cancelled', reason: 'preview_closed', page_count: pages.length, resolution_dpi: 220 })
    }
    trackEvent('preview_closed', {
      source,
      duration_bucket: openedAt === null ? 'unknown' : durationBucket(performance.now() - openedAt),
    })
    setPreviewSummaryPending(true)
    previewOpenedAtRef.current = null
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { dialog.close(); setPreviewOpen(false); return }
    dialog.classList.add('is-closing')
    closeTimerRef.current = setTimeout(() => {
      dialog.close()
      setPreviewOpen(false)
      dialog.classList.remove('is-closing')
      closeTimerRef.current = null
    }, 200)
  }, [isIOS, pages.length, pdfStatus])
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current) }, [])
  useEffect(() => {
    if (!isIOS || !previewOpen || (syntaxHighlight && highlightStatus === 'working')) return
    let cancelled = false
    const startedAt = performance.now()
    setPdfStatus('working')
    setPdfBlob(null)
    pdfGenerationResultTrackedRef.current = false
    import('./printPdf').then(({ createPrintPdf }) => createPrintPdf({
      pages, spans, paper, width: safeWidth, height: safeHeight, margin: safeMargin,
      columns, columnGap, columnWidth, fontSize, family, color, alignment,
      footerMode, footerDate, footerHost, syntaxColors: SYNTAX_COLORS,
    })).then((blob) => {
      if (!cancelled && !pdfGenerationResultTrackedRef.current) {
        setPdfBlob(blob)
        setPdfStatus('ready')
        trackEvent('pdf_generation_result', { status: 'succeeded', page_count: pages.length, resolution_dpi: 220, duration_bucket: durationBucket(performance.now() - startedAt) })
        pdfGenerationResultTrackedRef.current = true
      }
    }).catch(() => {
      if (!cancelled && !pdfGenerationResultTrackedRef.current) {
        setPdfStatus('error')
        trackEvent('pdf_generation_result', { status: 'failed', page_count: pages.length, resolution_dpi: 220, duration_bucket: durationBucket(performance.now() - startedAt) })
        pdfGenerationResultTrackedRef.current = true
      }
    })
    return () => { cancelled = true }
  }, [isIOS, previewOpen, syntaxHighlight, highlightStatus, pages, spans, paper, safeWidth, safeHeight, safeMargin, columns, columnGap, columnWidth, fontSize, family, color, alignment, footerMode, footerDate, footerHost])

  const print = async () => {
    if (!isIOS) {
      const startedAt = performance.now()
      try {
        window.print()
        trackEvent('system_print_result', { ...analyticsLayout(), status: 'request_returned', duration_bucket: durationBucket(performance.now() - startedAt) })
      } catch {
        trackEvent('system_print_result', { ...analyticsLayout(), status: 'failed', reason: 'print_error' })
      }
      return
    }
    if (!pdfBlob) return
    const file = new File([pdfBlob], 'TextPrint.pdf', { type: 'application/pdf' })
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({ files: [file] })
        trackEvent('pdf_share_result', { status: 'completed', page_count: pages.length })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          trackEvent('pdf_share_result', { status: 'cancelled', page_count: pages.length })
        } else {
          setPdfStatus('error')
          trackEvent('pdf_share_result', { status: 'failed', page_count: pages.length, reason: 'share_error' })
        }
      }
    } else {
      const url = URL.createObjectURL(pdfBlob)
      window.open(url, '_blank', 'noopener')
      trackEvent('pdf_share_result', { status: 'fallback_requested', page_count: pages.length })
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
  }
  const openPreview = () => {
    previewOpenedAtRef.current = performance.now()
    highlightSummaryTrackedRef.current = false
    pdfGenerationResultTrackedRef.current = false
    setPreviewSummaryPending(false)
    trackEvent('preview_opened', analyticsLayout())
    setPdfBlob(null)
    setPdfStatus('working')
    dialogRef.current?.showModal()
    setPreviewOpen(true)
  }
  const footer = (index: number, preview: boolean) => footerMode === 'none' ? null : (
    <div className={`paper-footer ${preview ? 'preview-footer' : 'printed-footer'} ${footerMode === 'page' ? 'only-page' : ''}`}
      style={preview ? { left: `${(safeMargin / safeWidth) * 100}%`, right: `${(safeMargin / safeWidth) * 100}%`, bottom: `${(safeMargin / safeHeight) * 100}%`, fontSize: `calc(100cqw * ${8 * pxPerPt / (safeWidth * pxPerMm)})` }
        : { left: `${safeMargin}mm`, right: `${safeMargin}mm`, bottom: `${safeMargin}mm` }}>
      {footerMode === 'all' && <><span>TextPrint</span><span>{footerHost}</span><span>{footerDate}</span></>}
      <span>{index + 1} / {pages.length}</span>
    </div>
  )

  return (
    <div className="page-shell">
      <a className="github-link" href="https://github.com/RavelloH/TextPrint" target="_blank" rel="noreferrer" aria-label="查看 GitHub 源代码">
        <svg className="github-mark" viewBox="0 0 19 19" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M9.356 1.85C5.05 1.85 1.57 5.356 1.57 9.694a7.84 7.84 0 0 0 5.324 7.44c.387.079.528-.168.528-.376 0-.182-.013-.805-.013-1.454-2.165.467-2.616-.935-2.616-.935-.349-.91-.864-1.143-.864-1.143-.71-.48.051-.48.051-.48.787.051 1.2.805 1.2.805.695 1.194 1.817.857 2.268.649.064-.507.27-.857.49-1.052-1.728-.182-3.545-.857-3.545-3.87 0-.857.31-1.558.8-2.104-.078-.195-.349-1 .077-2.078 0 0 .657-.208 2.14.805a7.5 7.5 0 0 1 1.946-.26c.657 0 1.328.092 1.946.26 1.483-1.013 2.14-.805 2.14-.805.426 1.078.155 1.883.078 2.078.502.546.799 1.247.799 2.104 0 3.013-1.818 3.675-3.558 3.87.284.247.528.714.528 1.454 0 1.052-.012 1.896-.012 2.156 0 .208.142.455.528.377a7.84 7.84 0 0 0 5.324-7.441c.013-4.338-3.48-7.844-7.773-7.844" /></svg>
      </a>
      <main className="workbench">
        <p className="eyebrow">TEXT / PRINT</p>
        <h1>TextPrint</h1>
        <p className="intro">让文字，以你想要的尺寸落在纸上。</p>
        <section className="text-field">
          <div className="field-heading"><span>01 / 打印内容</span><span className="field-hint">纯文本 · 保留换行</span></div>
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="在这里输入要打印的文字…" aria-label="要打印的文字" rows={6} />
          <span className="field-rule" />
        </section>
        <section className="settings-section" aria-label="排版设置">
          <div className="section-heading">02 / 排版设置</div>
          <div className="settings-grid">
            <label className="control"><span>内容纸张</span><select value={paper} onChange={(e) => { const value = e.target.value as Paper; setPaper(value); trackEvent('setting_changed', { setting: 'paper', value }) }}><option>A3</option><option>A4</option><option>A5</option><option>A6</option><option>Letter</option><option value="custom">自定义</option></select></label>
            <label className="control"><span>方向</span><select value={orientation} onChange={(e) => { const value = e.target.value as Orientation; setOrientation(value); trackEvent('setting_changed', { setting: 'orientation', value }) }}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
            <label className="control"><span>分列</span><select value={columns} onChange={(e) => { const value = Number(e.target.value); setColumns(value); trackEvent('setting_changed', { setting: 'columns', value }) }}><option value={1}>单列</option><option value={2}>两列</option><option value={3}>三列</option></select></label>
            {columns > 1 && <label className="control"><span>列间距 / mm</span><input type="number" min="0" max="30" value={columnGap} onChange={(e) => setColumnGap(Number(e.target.value))} onBlur={(e) => trackEvent('setting_changed', { setting: 'column_gap_mm', value: Number(e.currentTarget.value) })} /></label>}
            {paper === 'custom' && <div className="control custom-size"><span>内容尺寸 / mm</span><div className="paired-input"><input type="number" min="50" max="420" value={customWidth} onChange={(e) => setCustomWidth(Number(e.target.value))} onBlur={(e) => trackEvent('setting_changed', { setting: 'custom_width_mm', value: Number(e.currentTarget.value) })} aria-label="内容宽度，毫米" /><span>×</span><input type="number" min="50" max="420" value={customHeight} onChange={(e) => setCustomHeight(Number(e.target.value))} onBlur={(e) => trackEvent('setting_changed', { setting: 'custom_height_mm', value: Number(e.currentTarget.value) })} aria-label="内容高度，毫米" /></div></div>}
            <label className="control"><span>字体</span><select value={font} onChange={(e) => { const value = e.target.value as typeof font; setFont(value); trackEvent('setting_changed', { setting: 'font', value }) }}>{FONTS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
            <label className="control"><span>字号 / pt</span><input type="number" min="6" max="72" value={fontSize} onChange={(e) => setFontSize(Math.min(72, Math.max(6, Number(e.target.value) || 6)))} onBlur={() => trackEvent('setting_changed', { setting: 'font_size_pt', value: fontSize })} /></label>
            <label className="control"><span>页边距 / mm</span><input type="number" min="0" max="100" value={margin} onChange={(e) => setMargin(Number(e.target.value))} onBlur={() => trackEvent('setting_changed', { setting: 'margin_mm', value: margin })} /></label>
            <label className="control color-control"><span>文字颜色</span><span className="color-input"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} onBlur={(e) => trackEvent('setting_changed', { setting: 'text_color', value: e.currentTarget.value })} aria-label="文字颜色" /><span>{color.toUpperCase()}</span></span></label>
            <label className="control"><span>页尾</span><select value={footerMode} onChange={(e) => { const value = e.target.value as FooterMode; setFooterMode(value); trackEvent('setting_changed', { setting: 'footer_mode', value }) }}><option value="none">关闭</option><option value="page">仅页数</option><option value="all">全部（站点、日期、页数）</option></select></label>
          </div>
          <div className="align-row"><span>对齐</span><div className="segmented" role="group" aria-label="文字对齐">{([['left','左对齐'],['center','居中'],['right','右对齐']] as const).map(([value,label]) => <button type="button" key={value} className={alignment === value ? 'active' : ''} onClick={() => { setAlignment(value); trackEvent('setting_changed', { setting: 'alignment', value }) }} aria-pressed={alignment === value}>{label}</button>)}</div></div>
          <div className="highlight-row">
            <label className="highlight-option"><input type="checkbox" checked={syntaxHighlight} onChange={(event) => setSyntaxHighlight(event.target.checked)} /><span className="setting-check" aria-hidden="true">{syntaxHighlight ? '✓' : ''}</span><span>语法高亮</span></label>
            {syntaxHighlight && highlightStatus === 'working' && <p className="highlight-status" role="status">正在分析文字…</p>}
            {syntaxHighlight && highlightStatus === 'unsupported' && <p className="highlight-status" role="status">当前浏览器不支持 WebGPU</p>}
            {syntaxHighlight && highlightStatus === 'error' && <p className="highlight-status" role="status">高亮未能运行</p>}
          </div>
          {!isIOS && <p className="print-setting-note">浏览器自带的页眉页脚需在系统打印窗口中另行关闭。</p>}
          {!validDimensions && <p className="error" role="alert">请检查纸张尺寸、页边距与列间距，确保每列至少有 12 mm 宽度。</p>}
        </section>
        <button className="print-button" type="button" onClick={openPreview} disabled={!text.trim() || !validDimensions}>
          <span>预览并打印</span><Printer size={19} strokeWidth={1.9} />
        </button>
        <footer className="author-credit">Made by <a href="https://github.com/RavelloH" target="_blank" rel="noreferrer">RavelloH ↗</a></footer>
      </main>
      <dialog className="preview-dialog" ref={dialogRef} aria-labelledby="preview-title" onClick={(event) => { if (event.target === dialogRef.current) closeDialog('backdrop') }} onCancel={(event) => { event.preventDefault(); closeDialog('escape') }}>
        <div className="preview-dialog-inner">
          <header className="dialog-header">
            <div><p className="eyebrow">TEXT / PRINT</p><h2 id="preview-title">打印预览</h2><p>{safeWidth} × {safeHeight} mm · {pages.length} 页</p></div>
            <button className="dialog-close" type="button" aria-label="关闭预览" onClick={() => closeDialog('button')}><X size={20} /></button>
          </header>
          <div className="preview-list">
            {pages.map((pageColumns, index) => <div className="preview-entry" key={index}>
              <div className="preview-paper" style={{ aspectRatio: `${safeWidth} / ${safeHeight}` }}>
                <div className="preview-content" style={{ top: `${(safeMargin / safeHeight) * 100}%`, right: `${(safeMargin / safeWidth) * 100}%`, bottom: `${((safeMargin + footerReserve) / safeHeight) * 100}%`, left: `${(safeMargin / safeWidth) * 100}%`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: `calc(100cqw * ${columnGap / safeWidth})`, fontFamily: family, color, textAlign: alignment, fontSize: `calc(100cqw * ${fontSize * pxPerPt / (safeWidth * pxPerMm)})` }}>
                  {pageColumns.map((lines, col) => <div className="paper-column" key={col}>{lines.map((line, i) => <div key={i}><Line line={line} spans={spans} /></div>)}</div>)}
                </div>
                {footer(index, true)}
              </div><span className="page-number">{String(index + 1).padStart(2, '0')} / {String(pages.length).padStart(2, '0')}</span>
            </div>)}
          </div>
          <footer className="dialog-footer">
            {isIOS && <p className="ios-print-hint">iPhone 将打开 PDF 共享菜单，请选择「打印」。</p>}
            {isIOS && pdfStatus === 'error' && <p className="error" role="alert">打印文件生成失败，请重试。</p>}
            <button className="print-button" type="button" disabled={(syntaxHighlight && highlightStatus === 'working') || (isIOS && pdfStatus !== 'ready')} onClick={print}><span>{isIOS && pdfStatus === 'working' ? '正在准备打印文件…' : syntaxHighlight && highlightStatus === 'working' ? '正在准备高亮…' : '系统打印'}</span><Printer size={19} strokeWidth={1.9} /></button>
          </footer>
        </div>
      </dialog>
      <div className="print-only" aria-hidden="true">
        {text.trim() && validDimensions && pages.map((pageColumns, index) => <div className="print-page" key={index} style={{ width: `${safeWidth}mm`, height: `${safeHeight}mm`, padding: `${safeMargin}mm`, fontFamily: family, fontSize: `${fontSize}pt`, color, textAlign: alignment }}>
          <div className="print-columns" style={{ height: `${contentHeight}mm`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: `${columnGap}mm` }}>
            {pageColumns.map((lines, col) => <div className="paper-column" key={col}>{lines.map((line, i) => <div className="print-line" key={i}><Line line={line} spans={spans} /></div>)}</div>)}
          </div>
          {footer(index, false)}
        </div>)}
      </div>
    </div>
  )
}

export default App
