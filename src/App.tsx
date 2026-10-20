import { useEffect, useRef, useState, type DragEvent } from 'react'
import { BATCH_LIMITS, PRODUCT } from './config/product'
import { assertBatchAdditionAllowed, createQueueItems, summarizeQueue } from './lib/batch/queue'
import type { QueueItem } from './lib/batch/types'
import { createVerifiedZip } from './lib/batch/zip'
import { validateImageFile, type SupportedImageFormat } from './lib/fileValidation'
import { formatBytes } from './lib/format'
import { cleanJpeg, readJpegDimensions } from './lib/jpeg/cleaner'
import { inspectJpeg } from './lib/jpeg/parser'
import type { JpegInspectionReport, MetadataBlock } from './lib/jpeg/types'
import { cleanPng } from './lib/png/cleaner'
import { inspectPng } from './lib/png/parser'
import { selectPngCleaningStrategy } from './lib/png/strategy'
import type { PngCleaningStrategy, PngInspectionReport, PngMetadataBlock } from './lib/png/types'
import { createSequenceCounter } from './lib/sequenceCounter'

const PAGE_TITLE = `${PRODUCT.name} — Private image metadata cleaner`
if (typeof document !== 'undefined') document.title = PAGE_TITLE

const jpegCategoryLabel: Record<MetadataBlock['category'], string> = {
  exif: 'EXIF', xmp: 'XMP', icc: 'ICC profile', provenance: 'JUMBF / C2PA',
  photoshop: 'Photoshop / IPTC', comment: 'Comment', 'other-app': 'Other APP data',
}

const pngCategoryLabel: Record<PngMetadataBlock['category'], string> = {
  exif: 'EXIF', text: 'Text', xmp: 'XMP', icc: 'ICC profile', timestamp: 'Timestamp',
  resolution: 'Pixel density', provenance: 'C2PA', signature: 'Digital signature',
  'other-ancillary': 'Other ancillary data', animation: 'Animation',
}

interface DisplayBlock {
  category: string
  name: string
  locator: string
  approximateBytes: number
  explanation: string
  kind: MetadataBlock['kind']
  removable: boolean
}

const displayBlocksFor = (item: QueueItem): DisplayBlock[] => {
  if (item.format === 'jpeg' && item.report) {
    return (item.report as JpegInspectionReport).metadataBlocks.map((block) => ({
      category: jpegCategoryLabel[block.category], name: block.name, locator: `JPEG marker ${block.marker}`,
      approximateBytes: block.approximateBytes, explanation: block.explanation, kind: block.kind, removable: true,
    }))
  }
  if (item.format === 'png' && item.report) {
    return (item.report as PngInspectionReport).metadataBlocks.map((block) => ({
      category: pngCategoryLabel[block.category], name: block.name, locator: `PNG chunk ${block.chunkType}`,
      approximateBytes: block.approximateBytes, explanation: block.explanation, kind: block.kind, removable: block.removable,
    }))
  }
  return []
}

const removableCountFor = (item: QueueItem): number => displayBlocksFor(item).filter((block) => block.removable).length
const formatName = (format?: SupportedImageFormat): string => format === 'png' ? 'PNG' : format === 'jpeg' ? 'JPEG' : 'Unknown'
const statusLabel: Record<QueueItem['status'], string> = {
  inspecting: 'Inspecting', ready: 'Ready', cleaning: 'Cleaning', verified: 'Verified clean', unsupported: 'Unsupported', failed: 'Failed',
}
const kindLabel: Record<MetadataBlock['kind'], string> = { privacy: 'Privacy', provenance: 'Provenance', technical: 'Technical' }

const icon = {
  shield: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.1 7.9 7.5 9.5 4.4-1.6 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/></svg>,
  upload: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 15v4h14v-4"/></svg>,
  sparkle: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.6 5.8 4.2 9.4 10 10-5.8.6-9.4 4.2-10 10-.6-5.8-4.2-9.4-10-10 5.8-.6 9.4-4.2 10-10Z"/></svg>,
  download: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 20h14"/></svg>,
  trash: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 3h6l1 4H8l1-4Zm-2 4 1 14h8l1-14M10 11v6m4-6v6"/></svg>,
}

function Header() {
  return <header className="site-header"><a href="#main" className="brand" aria-label={`${PRODUCT.name} home`}><span className="brand-mark">{icon.shield}</span><span>{PRODUCT.name}</span></a><span className="local-pill"><span aria-hidden="true" /> Local processing only</span></header>
}

function UploadPanel({ onFiles, compact = false, disabled = false }: { onFiles: (files: File[]) => void; compact?: boolean; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const receiveFiles = (files: FileList) => onFiles(Array.from(files))
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDragging(false)
    if (event.dataTransfer.files.length) receiveFiles(event.dataTransfer.files)
  }
  return <div className={`${compact ? 'add-panel' : 'drop-zone'} ${dragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={drop}>
    <input ref={inputRef} id="file-picker" className="sr-only" type="file" multiple accept=".jpg,.jpeg,.png,image/jpeg,image/png" aria-label="Choose a JPEG or PNG image" disabled={disabled} onChange={(event) => { if (event.target.files?.length) receiveFiles(event.target.files); event.target.value = '' }} />
    {compact ? <><div><strong>Add images</strong><span>Drop more here or choose files</span></div><button className="button button-light" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>Add images</button></> : <><div className="upload-icon">{icon.upload}</div><h2>Drop an image here</h2><p>Choose one image or select several to form a local queue.</p><button className="button button-dark" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>Choose images</button><p className="file-note">JPG, JPEG, or static PNG · Up to {BATCH_LIMITS.maxQueuedFiles} files / {BATCH_LIMITS.maxCombinedSourceBytes / 1024 / 1024} MB total · Nothing is uploaded</p></>}
  </div>
}

function QueueItemCard({ item, actionsDisabled, onClean, onRetry, onRemove, onCleanAnother }: {
  item: QueueItem; actionsDisabled: boolean; onClean: () => void; onRetry: () => void; onRemove: () => void; onCleanAnother?: () => void
}) {
  const blocks = displayBlocksFor(item)
  const removable = blocks.filter((block) => block.removable)
  const categories = [...new Set(blocks.map((block) => block.category))]
  const pngReport = item.format === 'png' ? item.report as PngInspectionReport | undefined : undefined
  const imageUrl = item.result?.downloadUrl ?? item.previewUrl
  return <article className={`queue-card status-${item.status}`} aria-labelledby={`item-title-${item.id}`}>
    <div className="queue-thumb">{imageUrl ? <img src={imageUrl} alt={`Preview of ${item.file.name}`} /> : <span>{item.status === 'inspecting' ? <span className="spinner small" /> : icon.shield}</span>}</div>
    <div className="queue-content">
      <div className="queue-heading"><div><p id={`item-title-${item.id}`} className="queue-filename" title={item.file.name}>{item.file.name}</p><span>{formatName(item.format)}{item.width && item.height ? ` · ${item.width.toLocaleString()} × ${item.height.toLocaleString()} px` : ''} · {formatBytes(item.file.size)}</span></div><span className={`status-pill status-pill-${item.status}`}>{statusLabel[item.status]}</span></div>
      {(item.status === 'ready' || item.status === 'verified') && <div className="queue-report">
        <h3>{item.status === 'verified' ? 'Verified clean' : removable.length === 0 ? 'No removable blocks found' : `${removable.length} removable block${removable.length === 1 ? '' : 's'} found`}</h3>
        {categories.length > 0 && <div className="category-row" aria-label={`Metadata categories found in ${item.file.name}`}>{categories.map((category) => <span key={category}>{category}</span>)}</div>}
        {blocks.length > 0 && item.status !== 'verified' && <details className="item-details"><summary>Review detected metadata</summary><div className="metadata-list">{blocks.map((block, index) => <section key={`${block.locator}-${index}`}><div><strong>{block.name}</strong><span className={`kind kind-${block.kind}`}>{kindLabel[block.kind]}</span></div><p>{block.explanation}</p><small>{block.locator} · approximately {formatBytes(block.approximateBytes)}</small></section>)}</div></details>}
        {item.knownStrategy && item.status === 'ready' && <p className="strategy-preview">Planned method: <strong>{item.knownStrategy === 'direct-strip' ? 'direct metadata strip' : 'canvas rebuild'}</strong></p>}
        {pngReport && <p className="transparency-inline">PNG transparency is preserved.</p>}
        {item.result && <div className="verified-result"><span className="assigned-name">{item.result.filename}</span><p>{item.result.strategy === 'direct-strip' ? 'Metadata removed without recompressing the image pixels.' : item.format === 'png' ? 'The pixels were rebuilt to safely normalise orientation or colour interpretation. Browser rendering may normalise colour values.' : 'Rebuilt at high JPEG quality with orientation normalised.'}</p></div>}
      </div>}
      {item.status === 'unsupported' && <p className="item-alert" role="status"><strong>This PNG is animated.</strong> Cleaning is unavailable because rebuilding would flatten or damage the animation. No file number was used.</p>}
      {item.status === 'failed' && <p className="item-alert error" role="alert">{item.error} <small>No file number was used.</small></p>}
      {item.status === 'inspecting' && <div className="item-working"><h3>Inspecting your image…</h3><p>Inspecting safely on this device.</p></div>}
      {item.status === 'cleaning' && <div className="item-working"><h3>Rebuilding your image…</h3><p>Cleaning and verifying locally.</p></div>}
      <div className="queue-actions">
        {item.status === 'ready' && <button className="button button-accent" type="button" disabled={actionsDisabled} onClick={onClean} aria-label={`Deep Clean ${item.file.name}`}>{icon.sparkle} Deep Clean</button>}
        {item.status === 'failed' && <button className="button button-light" type="button" disabled={actionsDisabled} onClick={onRetry} aria-label={`Retry ${item.failureStage === 'inspection' ? 'inspection' : 'cleaning'} for ${item.file.name}`}>Retry</button>}
        {item.status === 'unsupported' && <button className="button button-accent" type="button" disabled aria-label={`Deep Clean ${item.file.name}`}>{icon.sparkle} Deep Clean</button>}
        {item.status === 'verified' && item.result && <a className="button button-accent" href={item.result.downloadUrl} download={item.result.filename} aria-label={`Download cleaned image ${item.result.filename}`}>{icon.download} Download {formatName(item.format)}</a>}
        {item.status === 'verified' && onCleanAnother && <button className="button button-light" type="button" disabled={actionsDisabled} onClick={onCleanAnother}>Clean another image</button>}
        <button className="icon-button" type="button" data-remove-id={item.id} disabled={actionsDisabled || item.status === 'inspecting' || item.status === 'cleaning'} onClick={onRemove} aria-label={`Remove ${item.file.name} from queue`} title="Remove from queue">{icon.trash}</button>
      </div>
    </div>
  </article>
}

function PrivacyNote() {
  return <section className="privacy-note" aria-labelledby="privacy-title"><span>{icon.shield}</span><div><h2 id="privacy-title">Your images stay on this device</h2><p>No upload, account, analytics, or remote processing. Sources, results, previews, and ZIPs exist only in this browser tab.</p></div></section>
}

export function App() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [queueError, setQueueError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState({ active: false, current: 0, completed: 0, total: 0, stopping: false })
  const [zipGenerating, setZipGenerating] = useState(false)
  const [counter] = useState(() => createSequenceCounter())
  const [nextNumber, setNextNumber] = useState(() => counter.peek())
  const itemsRef = useRef<QueueItem[]>([])
  const processingRef = useRef(false)
  const inspectionIdsRef = useRef(new Set<string>())
  const stopRequestedRef = useRef(false)
  const liveIdsRef = useRef(new Set<string>())

  const replaceItems = (next: QueueItem[]) => { itemsRef.current = next; setItems(next) }
  const updateItem = (id: string, patch: Partial<QueueItem>) => replaceItems(itemsRef.current.map((item) => item.id === id ? { ...item, ...patch } : item))
  const revokeItemUrls = (item: QueueItem) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); if (item.result?.downloadUrl) URL.revokeObjectURL(item.result.downloadUrl) }

  useEffect(() => {
    const liveIds = liveIdsRef.current
    return () => { for (const item of itemsRef.current) revokeItemUrls(item); liveIds.clear() }
  }, [])

  const inspectItem = async (item: QueueItem) => {
    if (inspectionIdsRef.current.has(item.id)) return
    inspectionIdsRef.current.add(item.id)
    updateItem(item.id, { status: 'inspecting', error: undefined, failureStage: undefined })
    setAnnouncement('Inspecting the image locally.')
    try {
      const { buffer, format } = await validateImageFile(item.file)
      if (format === 'png') {
        const report = inspectPng(buffer)
        if (report.isAnimated) {
          if (liveIdsRef.current.has(item.id)) updateItem(item.id, { format, report, width: report.width, height: report.height, status: 'unsupported', knownStrategy: undefined })
          setAnnouncement(`${item.file.name} is an animated PNG and is unsupported.`)
          return
        }
        const dimensions = await readJpegDimensions(item.file)
        if (!liveIdsRef.current.has(item.id)) return
        const previewUrl = URL.createObjectURL(item.file)
        updateItem(item.id, { format, report, ...dimensions, previewUrl, knownStrategy: selectPngCleaningStrategy(report), status: 'ready' })
        setAnnouncement(`${item.file.name} is ready. PNG with ${report.metadataBlocks.filter((block) => block.removable).length} removable metadata blocks.`)
      } else {
        const report = inspectJpeg(buffer)
        const dimensions = await readJpegDimensions(item.file)
        if (!liveIdsRef.current.has(item.id)) return
        const previewUrl = URL.createObjectURL(item.file)
        updateItem(item.id, { format, report, ...dimensions, previewUrl, knownStrategy: 'canvas-rebuild', status: 'ready' })
        setAnnouncement(`${item.file.name} is ready. JPEG with ${report.metadataBlocks.length} removable metadata blocks.`)
      }
    } catch (caught) {
      if (!liveIdsRef.current.has(item.id)) return
      const error = caught instanceof Error ? caught.message : 'This image could not be inspected safely.'
      updateItem(item.id, { status: 'failed', error, failureStage: 'inspection' })
      setAnnouncement(`${item.file.name} inspection failed. ${error}`)
    } finally {
      inspectionIdsRef.current.delete(item.id)
    }
  }

  const addFiles = async (files: File[]) => {
    if (!files.length || processingRef.current || zipGenerating) return
    try { assertBatchAdditionAllowed(itemsRef.current, files) } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Those files could not be added.'
      setQueueError(message); setAnnouncement(message); return
    }
    setQueueError('')
    const created = createQueueItems(files)
    for (const item of created) liveIdsRef.current.add(item.id)
    replaceItems([...itemsRef.current, ...created])
    setAnnouncement(`${created.length} ${created.length === 1 ? 'file' : 'files'} added for local inspection.`)
    for (const item of created) await inspectItem(item)
  }

  const processItem = async (item: QueueItem): Promise<boolean> => {
    if (!item.format || !item.report || !liveIdsRef.current.has(item.id)) return false
    updateItem(item.id, { status: 'cleaning', error: undefined, failureStage: undefined }); setProcessingId(item.id); setAnnouncement('Deep cleaning and verifying the image locally.')
    try {
      const cleaned = item.format === 'png' ? await cleanPng(item.file) : await cleanJpeg(item.file)
      const strategy: PngCleaningStrategy = item.format === 'png' && 'strategy' in cleaned ? cleaned.strategy as PngCleaningStrategy : 'canvas-rebuild'
      const resultUrl = URL.createObjectURL(cleaned.blob)
      const filename = counter.assignVerified(item.format === 'png' ? 'png' : 'jpg')
      const removedBlocks = removableCountFor(item)
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      updateItem(item.id, { status: 'verified', previewUrl: undefined, result: { blob: cleaned.blob, bytes: cleaned.bytes, filename, downloadUrl: resultUrl, strategy, removedBlocks } })
      setNextNumber(counter.peek()); setAnnouncement(`${item.file.name} is verified clean and ready as ${filename}.`); return true
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : 'Cleaning failed safely and no file number was used.'
      updateItem(item.id, { status: 'failed', error, failureStage: 'cleaning' }); setAnnouncement(`${item.file.name} cleaning failed. No file number was used.`); return false
    } finally { setProcessingId(null) }
  }

  const cleanOne = async (id: string) => {
    if (processingRef.current || itemsRef.current.some((item) => item.status === 'inspecting')) return
    const item = itemsRef.current.find((candidate) => candidate.id === id)
    if (!item || (item.status !== 'ready' && !(item.status === 'failed' && item.failureStage === 'cleaning'))) return
    processingRef.current = true; await processItem(item); processingRef.current = false
  }

  const retryItem = async (id: string) => {
    const item = itemsRef.current.find((candidate) => candidate.id === id)
    if (!item || item.status !== 'failed' || processingRef.current) return
    if (item.failureStage === 'inspection') await inspectItem(item); else await cleanOne(id)
  }

  const cleanAll = async () => {
    if (processingRef.current || itemsRef.current.some((item) => item.status === 'inspecting')) return
    const ready = itemsRef.current.filter((item) => item.status === 'ready')
    if (!ready.length) return
    processingRef.current = true; stopRequestedRef.current = false
    setBatchProgress({ active: true, current: 1, completed: 0, total: ready.length, stopping: false })
    for (let index = 0; index < ready.length; index += 1) {
      setBatchProgress((progress) => ({ ...progress, current: index + 1 })); await processItem(ready[index]!); setBatchProgress((progress) => ({ ...progress, completed: index + 1 }))
      if (stopRequestedRef.current) { setAnnouncement(`Batch stopped after ${index + 1} of ${ready.length}. Remaining files are still ready.`); break }
    }
    processingRef.current = false; setBatchProgress((progress) => ({ ...progress, active: false, stopping: false }))
  }

  const stopBatch = () => { stopRequestedRef.current = true; setBatchProgress((progress) => ({ ...progress, stopping: true })); setAnnouncement('Stop requested. The current image will finish safely; remaining images will stay ready.') }

  const removeItem = (id: string) => {
    if (processingRef.current) return
    const index = itemsRef.current.findIndex((item) => item.id === id); const item = itemsRef.current[index]
    if (!item || item.status === 'inspecting' || item.status === 'cleaning') return
    const focusId = itemsRef.current[index + 1]?.id ?? itemsRef.current[index - 1]?.id
    revokeItemUrls(item); liveIdsRef.current.delete(id); replaceItems(itemsRef.current.filter((candidate) => candidate.id !== id)); setAnnouncement(`${item.file.name} removed from the queue.`)
    requestAnimationFrame(() => { const target = focusId ? document.querySelector<HTMLButtonElement>(`[data-remove-id="${focusId}"]`) : document.getElementById('file-picker'); target?.focus() })
  }

  const clearAll = () => {
    if (processingRef.current || itemsRef.current.some((item) => item.status === 'inspecting')) return
    for (const item of itemsRef.current) revokeItemUrls(item)
    liveIdsRef.current.clear(); replaceItems([]); setQueueError(''); setAnnouncement('Queue cleared. Previously assigned file numbers remain used.')
    requestAnimationFrame(() => document.getElementById('file-picker')?.focus())
  }

  const downloadZip = async () => {
    if (zipGenerating || processingRef.current) return
    const verified = itemsRef.current.filter((item) => item.status === 'verified' && item.result)
    if (verified.length < 2) return
    setZipGenerating(true)
    try {
      const generated = await createVerifiedZip(verified.map((item) => ({ filename: item.result!.filename, blob: item.result!.blob })))
      const buffer = new ArrayBuffer(generated.bytes.byteLength); new Uint8Array(buffer).set(generated.bytes)
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/zip' })); const anchor = document.createElement('a')
      anchor.href = url; anchor.download = generated.filename; anchor.style.display = 'none'; document.body.append(anchor); anchor.click(); anchor.remove()
      setAnnouncement(`${generated.filename} is ready and contains ${verified.length} verified files.`); window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The local ZIP could not be generated.'; setQueueError(message); setAnnouncement(message)
    } finally { setZipGenerating(false) }
  }

  const resetCounter = () => {
    if (processingRef.current) return
    if (window.confirm('Reset the file counter? The next successfully cleaned file will use MS1 with its image format extension. Previously downloaded files will not be changed.')) { counter.reset(); setNextNumber(1); setAnnouncement('File counter reset successfully.') }
  }

  const summary = summarizeQueue(items)
  const inspectionActive = items.some((item) => item.status === 'inspecting')
  const actionsDisabled = processingId !== null || batchProgress.active || inspectionActive || zipGenerating
  const verifiedItems = items.filter((item) => item.status === 'verified')

  return <div className="app-shell">
    <Header />
    <main id="main">
      <section className="hero" aria-labelledby="page-heading"><p className="eyebrow">PRIVATE BY DESIGN · JPEG + PNG</p><h1 id="page-heading">Leave the image.<br /><em>Lose the metadata.</em></h1><p>Clean one image or a small batch. Everything stays in this browser, including inspection, verification, and ZIP creation.</p></section>
      {items.length === 0 ? <>{queueError && <p className="error-message" role="alert">{queueError}</p>}<UploadPanel onFiles={addFiles} /></> : <section className="queue-shell" aria-labelledby="queue-heading">
        <UploadPanel onFiles={addFiles} compact disabled={actionsDisabled} />
        {queueError && <div className="queue-error" role="alert">{queueError}</div>}
        <div className="queue-toolbar"><div><p className="eyebrow">LOCAL QUEUE</p><h2 id="queue-heading">{summary.total} {summary.total === 1 ? 'image' : 'images'}</h2></div><div className="toolbar-actions">{batchProgress.active ? <button className="button button-light" type="button" disabled={batchProgress.stopping} onClick={stopBatch}>{batchProgress.stopping ? 'Stopping after current…' : 'Stop after current'}</button> : <button className="button button-dark" type="button" disabled={actionsDisabled || summary.ready === 0} onClick={cleanAll}>Clean all ready ({summary.ready})</button>}<button className="text-button" type="button" disabled={actionsDisabled} onClick={clearAll}>Clear all</button></div></div>
        {batchProgress.active && <div className="batch-progress"><div><strong>Cleaning {batchProgress.current} of {batchProgress.total}</strong><span>One image at a time</span></div><progress aria-label="Batch cleaning progress" value={batchProgress.completed} max={batchProgress.total}>{batchProgress.completed} of {batchProgress.total}</progress></div>}
        <div className="summary-grid" aria-label="Queue summary"><div><span>Total</span><strong>{summary.total}</strong></div><div><span>Ready</span><strong>{summary.ready}</strong></div><div><span>Verified</span><strong>{summary.verified}</strong></div><div><span>Failed</span><strong>{summary.failed}</strong></div><div><span>Blocks removed</span><strong>{summary.removedBlocks}</strong></div><div><span>Original</span><strong>{formatBytes(summary.originalBytes)}</strong></div><div><span>Cleaned</span><strong>{formatBytes(summary.cleanedBytes)}</strong></div></div>
        <div className="queue-list">{items.map((item) => <QueueItemCard key={item.id} item={item} actionsDisabled={actionsDisabled} onClean={() => cleanOne(item.id)} onRetry={() => retryItem(item.id)} onRemove={() => removeItem(item.id)} onCleanAnother={items.length === 1 && item.status === 'verified' ? clearAll : undefined} />)}</div>
        {verifiedItems.length >= 2 && <div className="zip-panel"><div><strong>Download verified files together</strong><span>Stored without recompression in a private, locally generated ZIP.</span></div><button className="button button-accent" type="button" disabled={actionsDisabled} onClick={downloadZip}>{icon.download} {zipGenerating ? 'Preparing ZIP…' : `Download all as ZIP (${verifiedItems.length})`}</button></div>}
      </section>}
      <div className="live-region" aria-live="polite" aria-atomic="true">{announcement}</div>
      <PrivacyNote />
      <section className="limitations" aria-labelledby="limits-title"><p className="eyebrow">WHAT VERIFIED CLEAN MEANS</p><h2 id="limits-title">File metadata, clearly separated from pixels.</h2><p>“Verified clean” covers removable file-level metadata detected by {PRODUCT.name}. It does not remove visible watermarks, cannot guarantee removal of pixel-level or imperceptible watermarks, and does not guarantee how external platforms classify an image.</p></section>
      <details className="settings"><summary>Numbering settings</summary><div><p>Next successful file: <strong>MS{nextNumber}</strong> plus its format extension</p><button className="text-button" type="button" disabled={actionsDisabled} onClick={resetCounter}>Reset file counter</button>{counter.warning && <p className="storage-warning" role="status">{counter.warning}</p>}</div></details>
    </main>
    <footer><span>{PRODUCT.name}</span><span>Browser-only · JPEG and static PNG</span></footer>
  </div>
}
