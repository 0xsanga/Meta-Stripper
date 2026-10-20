import { useEffect, useRef, useState, type DragEvent } from 'react'
import { BATCH_LIMITS, PRODUCT } from './config/product'
import { assertDecodedBudget, reservedDecodedBytes } from './lib/batch/memory'
import { assertBatchAdditionAllowed, createQueueItems, summarizeQueue } from './lib/batch/queue'
import type { QueueItem } from './lib/batch/types'
import { createVerifiedZip } from './lib/batch/zip'
import { validateImageFile, type SupportedImageFormat } from './lib/fileValidation'
import { formatBytes } from './lib/format'
import { cleanJpeg, readJpegDimensions, requireSafeJpegFrame } from './lib/jpeg/cleaner'
import { inspectJpeg } from './lib/jpeg/parser'
import { selectJpegCleaningStrategy } from './lib/jpeg/strategy'
import { verifyCleanedJpeg } from './lib/jpeg/stripper'
import type { JpegInspectionReport, MetadataBlock } from './lib/jpeg/types'
import { cleanPng } from './lib/png/cleaner'
import { inspectPng } from './lib/png/parser'
import { selectPngCleaningStrategy } from './lib/png/strategy'
import { verifyCleanedPng } from './lib/png/stripper'
import type { PngCleaningStrategy, PngInspectionReport, PngMetadataBlock } from './lib/png/types'
import { createSequenceCounter } from './lib/sequenceCounter'

const PAGE_TITLE = `${PRODUCT.name}: Private image metadata cleaner`
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
  inspecting: 'Inspecting', ready: 'Ready', 'already-clean': 'Already clean', cleaning: 'Cleaning', verified: 'Verified clean', unsupported: 'Unsupported', failed: 'Failed',
}

const resultExplanation = (item: QueueItem): string => {
  if (item.result?.strategy === 'already-clean') return 'No removable metadata was found, so the original image bytes were kept.'
  if (item.result?.strategy === 'direct-strip') return 'Metadata removed without recompressing the image pixels.'
  if (item.format === 'png') return 'The pixels were rebuilt to safely normalise orientation or colour interpretation. Browser rendering may normalise colour values.'
  return 'Rebuilt at high JPEG quality with orientation normalised.'
}
const kindLabel: Record<MetadataBlock['kind'], string> = { privacy: 'Privacy', provenance: 'Provenance', technical: 'Technical' }

const icon = {
  download: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 20h14"/></svg>,
  trash: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 7l1 13h6l1-13"/></svg>,
}

function Header() {
  return <header className="site-header"><a href="#main" className="brand" aria-label={`${PRODUCT.name} home`}><span className="brand-mark">MS</span><span>{PRODUCT.name}</span></a><span className="local-pill">On this device</span></header>
}

function UploadPanel({ onFiles, compact = false, disabled = false }: { onFiles: (files: File[]) => void; compact?: boolean; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const receiveFiles = (files: FileList) => onFiles(Array.from(files))
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDragging(false)
    if (disabled || !event.dataTransfer.files.length) return
    receiveFiles(event.dataTransfer.files)
  }
  return <div className={`${compact ? 'add-panel' : 'drop-zone'} ${dragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={drop}>
    <input ref={inputRef} id="file-picker" className="sr-only" type="file" multiple accept=".jpg,.jpeg,.png,image/jpeg,image/png" aria-label="Choose a JPEG or PNG image" disabled={disabled} onChange={(event) => { if (event.target.files?.length) receiveFiles(event.target.files); event.target.value = '' }} />
    {compact ? <><div><strong>Add images</strong><span>Drop more here, or choose files</span></div><button className="button button-light" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>Add images</button></> : <><div className="drop-copy"><h2>Drop an image here</h2><p>One file, or several. They stay in this tab until you clear them.</p><p className="file-note">JPG, JPEG, or static PNG · Up to {BATCH_LIMITS.maxQueuedFiles} files / {BATCH_LIMITS.maxCombinedSourceBytes / 1024 / 1024} MB · Nothing is uploaded</p></div><button className="button button-dark" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>Choose images</button></>}
  </div>
}

function QueueItemCard({ item, actionsDisabled, onClean, onDownloadClean, onRetry, onRemove, onCleanAnother }: {
  item: QueueItem; actionsDisabled: boolean; onClean: () => void; onDownloadClean: () => void; onRetry: () => void; onRemove: () => void; onCleanAnother?: () => void
}) {
  const blocks = displayBlocksFor(item)
  const removable = blocks.filter((block) => block.removable)
  const categories = [...new Set(blocks.map((block) => block.category))]
  const pngReport = item.format === 'png' ? item.report as PngInspectionReport | undefined : undefined
  const imageUrl = item.result?.downloadUrl ?? item.previewUrl
  return <article className={`queue-card status-${item.status}`} aria-labelledby={`item-title-${item.id}`}>
    <div className="queue-thumb">{imageUrl ? <img src={imageUrl} alt={`Preview of ${item.file.name}`} /> : <span>{item.status === 'inspecting' ? <span className="spinner small" /> : null}</span>}</div>
    <div className="queue-content">
      <div className="queue-heading"><div><p id={`item-title-${item.id}`} className="queue-filename" title={item.file.name}>{item.file.name}</p><span>{formatName(item.format)}{item.width && item.height ? ` · ${item.width.toLocaleString()} × ${item.height.toLocaleString()} px` : ''} · {formatBytes(item.file.size)}</span></div><span className={`status-pill status-pill-${item.status}`}>{statusLabel[item.status]}</span></div>
      {(item.status === 'ready' || item.status === 'already-clean' || item.status === 'verified') && <div className="queue-report">
        <h3>{item.status === 'verified' ? 'Verified clean' : item.status === 'already-clean' ? 'No removable metadata' : removable.length === 0 ? 'No removable blocks found' : `${removable.length} removable block${removable.length === 1 ? '' : 's'} found`}</h3>
        {categories.length > 0 && <div className="category-row" aria-label={`Metadata categories found in ${item.file.name}`}>{categories.map((category) => <span key={category}>{category}</span>)}</div>}
        {blocks.length > 0 && item.status !== 'verified' && <details className="item-details"><summary>Review detected metadata</summary><div className="metadata-list">{blocks.map((block, index) => <section key={`${block.locator}-${index}`}><div><strong>{block.name}</strong><span className={`kind kind-${block.kind}`}>{kindLabel[block.kind]}</span></div><p>{block.explanation}</p><small>{block.locator} · approximately {formatBytes(block.approximateBytes)}</small></section>)}</div></details>}
        {item.status === 'already-clean' && <p className="strategy-preview">Nothing removable was found. Downloading keeps the original bytes and assigns the next MS name.</p>}
        {item.knownStrategy && item.status === 'ready' && <p className="strategy-preview">Planned method: <strong>{item.knownStrategy === 'direct-strip' ? 'direct metadata strip' : 'canvas rebuild'}</strong></p>}
        {pngReport && <p className="transparency-inline">PNG transparency is preserved.</p>}
        {item.result && <div className="verified-result"><span className="assigned-name">{item.result.filename}</span><p>{resultExplanation(item)}</p></div>}
      </div>}
      {item.status === 'unsupported' && <p className="item-alert" role="status"><strong>This PNG is animated.</strong> Cleaning is unavailable because rebuilding would flatten or damage the animation. No file number was used.</p>}
      {item.status === 'failed' && <p className="item-alert error" role="alert">{item.error} <small>No file number was used.</small></p>}
      {item.status === 'inspecting' && <div className="item-working"><h3>Inspecting your image…</h3><p>Inspecting safely on this device.</p></div>}
      {item.status === 'cleaning' && <div className="item-working"><h3>{item.knownStrategy === 'canvas-rebuild' ? 'Rebuilding your image…' : 'Removing metadata…'}</h3><p>Cleaning and verifying locally.</p></div>}
      <div className="queue-actions">
        {item.status === 'ready' && <button className="button button-accent" type="button" disabled={actionsDisabled} onClick={onClean} aria-label={`Deep Clean ${item.file.name}`}>Deep Clean</button>}
        {item.status === 'already-clean' && <button className="button button-accent" type="button" disabled={actionsDisabled} onClick={onDownloadClean} aria-label={`Download ${item.file.name} without rebuilding`}>{icon.download} Download without rebuilding</button>}
        {item.status === 'failed' && <button className="button button-light" type="button" disabled={actionsDisabled} onClick={onRetry} aria-label={`Retry ${item.failureStage === 'inspection' ? 'inspection' : 'cleaning'} for ${item.file.name}`}>Retry</button>}
        {item.status === 'unsupported' && <button className="button button-accent" type="button" disabled aria-label={`Deep Clean ${item.file.name}`}>Deep Clean</button>}
        {item.status === 'verified' && item.result && <a className="button button-accent" href={item.result.downloadUrl} download={item.result.filename} aria-label={`Download cleaned image ${item.result.filename}`}>{icon.download} Download {formatName(item.format)}</a>}
        {item.status === 'verified' && onCleanAnother && <button className="button button-light" type="button" disabled={actionsDisabled} onClick={onCleanAnother}>Clean another image</button>}
        <button className="icon-button" type="button" data-remove-id={item.id} disabled={actionsDisabled || item.status === 'inspecting' || item.status === 'cleaning'} onClick={onRemove} aria-label={`Remove ${item.file.name} from queue`} title="Remove from queue">{icon.trash}</button>
      </div>
    </div>
  </article>
}

function PrivacyNote() {
  return <section className="privacy-note" aria-labelledby="privacy-title"><div><h2 id="privacy-title">Your images stay on this device</h2><p>No upload, account, analytics, or remote processing. Sources, results, previews, and ZIPs exist only in this browser tab.</p></div></section>
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
        assertDecodedBudget(reservedDecodedBytes(itemsRef.current, item.id), report.width, report.height)
        const dimensions = await readJpegDimensions(item.file)
        if (!liveIdsRef.current.has(item.id)) return
        const knownStrategy = selectPngCleaningStrategy(report)
        const previewUrl = URL.createObjectURL(item.file)
        const status = knownStrategy === 'already-clean' ? 'already-clean' : 'ready'
        updateItem(item.id, { format, report, ...dimensions, previewUrl, knownStrategy, status })
        setAnnouncement(status === 'already-clean'
          ? `${item.file.name} is already clean. No file number was used.`
          : `${item.file.name} is ready. PNG with ${report.metadataBlocks.filter((block) => block.removable).length} removable metadata blocks.`)
      } else {
        const report = inspectJpeg(buffer)
        const frame = requireSafeJpegFrame(buffer)
        assertDecodedBudget(reservedDecodedBytes(itemsRef.current, item.id), frame.width, frame.height)
        const dimensions = await readJpegDimensions(item.file)
        if (!liveIdsRef.current.has(item.id)) return
        const knownStrategy = selectJpegCleaningStrategy(report)
        const previewUrl = URL.createObjectURL(item.file)
        const status = knownStrategy === 'already-clean' ? 'already-clean' : 'ready'
        updateItem(item.id, { format, report, ...dimensions, previewUrl, knownStrategy, status })
        setAnnouncement(status === 'already-clean'
          ? `${item.file.name} is already clean. No file number was used.`
          : `${item.file.name} is ready. JPEG with ${report.metadataBlocks.length} removable metadata blocks.`)
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
    if (!files.length || processingRef.current || zipGenerating || itemsRef.current.some((item) => item.status === 'inspecting')) return
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
    if (!item.format || !item.report || !liveIdsRef.current.has(item.id) || item.knownStrategy === 'already-clean') return false
    updateItem(item.id, { status: 'cleaning', error: undefined, failureStage: undefined }); setProcessingId(item.id)
    setAnnouncement(item.knownStrategy === 'canvas-rebuild' ? 'Deep cleaning and verifying the image locally.' : 'Removing metadata and verifying the image locally.')
    try {
      const cleaned = item.format === 'png' ? await cleanPng(item.file) : await cleanJpeg(item.file)
      const strategy: PngCleaningStrategy = cleaned.strategy
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

  const downloadAlreadyClean = async (id: string) => {
    if (processingRef.current || zipGenerating || itemsRef.current.some((item) => item.status === 'inspecting')) return
    const item = itemsRef.current.find((candidate) => candidate.id === id)
    if (!item || item.status !== 'already-clean' || !item.format || item.result) return
    processingRef.current = true
    setProcessingId(item.id)
    try {
      const source = new Uint8Array(await item.file.arrayBuffer())
      if (item.format === 'png') verifyCleanedPng(source)
      else verifyCleanedJpeg(source)
      const output = new ArrayBuffer(source.byteLength)
      new Uint8Array(output).set(source)
      const blob = new Blob([output], { type: item.format === 'png' ? 'image/png' : 'image/jpeg' })
      const filename = counter.assignVerified(item.format === 'png' ? 'png' : 'jpg')
      const downloadUrl = URL.createObjectURL(blob)
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      updateItem(item.id, { status: 'verified', previewUrl: undefined, result: { blob, bytes: new Uint8Array(output), filename, downloadUrl, strategy: 'already-clean', removedBlocks: 0 } })
      setNextNumber(counter.peek())
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = filename
      anchor.style.display = 'none'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setAnnouncement(`${item.file.name} is verified clean and ready as ${filename}.`)
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : 'This image could not be saved safely.'
      updateItem(item.id, { status: 'failed', error, failureStage: 'cleaning' })
      setAnnouncement(`${item.file.name} could not be saved. No file number was used.`)
    } finally {
      setProcessingId(null)
      processingRef.current = false
    }
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
    const queuedNames = itemsRef.current.flatMap((item) => item.result ? [item.result.filename] : [])
    const collision = queuedNames.length ? ` This queue still has ${queuedNames.join(', ')}, so a later file can reuse one of those names.` : ''
    if (window.confirm(`Reset the file counter? The next successfully cleaned file will use MS1 with its image format extension.${collision} Previously downloaded files will not be changed.`)) { counter.reset(); setNextNumber(1); setAnnouncement('File counter reset successfully.') }
  }

  const summary = summarizeQueue(items)
  const inspectionActive = items.some((item) => item.status === 'inspecting')
  const actionsDisabled = processingId !== null || batchProgress.active || inspectionActive || zipGenerating
  const verifiedItems = items.filter((item) => item.status === 'verified')

  return <div className="app-shell">
    <Header />
    <main id="main">
      <section className="hero" aria-labelledby="page-heading"><p className="eyebrow">JPEG + PNG</p><h1 id="page-heading">Leave the image.<br />Lose the metadata.</h1><p>Clean one image or a small batch. Inspection, verification, and ZIP creation stay in this browser.</p></section>
      {items.length === 0 ? <>{queueError && <p className="error-message" role="alert">{queueError}</p>}<UploadPanel onFiles={addFiles} /></> : <section className="queue-shell" aria-labelledby="queue-heading">
        <UploadPanel onFiles={addFiles} compact disabled={actionsDisabled} />
        {queueError && <div className="queue-error" role="alert">{queueError}</div>}
        <div className="queue-toolbar"><div><h2 id="queue-heading">{summary.total} {summary.total === 1 ? 'image' : 'images'}</h2></div><div className="toolbar-actions">{batchProgress.active ? <button className="button button-light" type="button" disabled={batchProgress.stopping} onClick={stopBatch}>{batchProgress.stopping ? 'Stopping after current…' : 'Stop after current'}</button> : <button className="button button-dark" type="button" disabled={actionsDisabled || summary.ready === 0} onClick={cleanAll}>Clean all ready ({summary.ready})</button>}<button className="text-button" type="button" disabled={actionsDisabled} onClick={clearAll}>Clear all</button></div></div>
        {batchProgress.active && <div className="batch-progress"><div><strong>Cleaning {batchProgress.current} of {batchProgress.total}</strong><span>One image at a time</span></div><progress aria-label="Batch cleaning progress" value={batchProgress.completed} max={batchProgress.total}>{batchProgress.completed} of {batchProgress.total}</progress></div>}
        <div className="summary-grid" aria-label="Queue summary"><div className="summary-counts"><div><span>Total</span><strong>{summary.total}</strong></div><div><span>Ready</span><strong>{summary.ready}</strong></div><div><span>Verified</span><strong>{summary.verified}</strong></div><div><span>Failed</span><strong>{summary.failed}</strong></div></div><div className="summary-sizes"><div><span>Blocks removed</span><strong>{summary.removedBlocks}</strong></div><div><span>Original</span><strong>{formatBytes(summary.originalBytes)}</strong></div><div><span>Cleaned</span><strong>{formatBytes(summary.cleanedBytes)}</strong></div></div></div>
        <div className="queue-list">{items.map((item) => <QueueItemCard key={item.id} item={item} actionsDisabled={actionsDisabled} onClean={() => cleanOne(item.id)} onDownloadClean={() => downloadAlreadyClean(item.id)} onRetry={() => retryItem(item.id)} onRemove={() => removeItem(item.id)} onCleanAnother={items.length === 1 && item.status === 'verified' ? clearAll : undefined} />)}</div>
        {verifiedItems.length >= 2 && <div className="zip-panel"><div><strong>Download verified files together</strong><span>Stored without recompression in a private, locally generated ZIP.</span></div><button className="button button-accent" type="button" disabled={actionsDisabled} onClick={downloadZip}>{icon.download} {zipGenerating ? 'Preparing ZIP…' : `Download all as ZIP (${verifiedItems.length})`}</button></div>}
      </section>}
      <div className="live-region" aria-live="polite" aria-atomic="true">{announcement}</div>
      <PrivacyNote />
      <section className="limitations" aria-labelledby="limits-title"><p className="eyebrow">Verified clean</p><h2 id="limits-title">File metadata, clearly separated from pixels.</h2><p>“Verified clean” covers removable file-level metadata detected by {PRODUCT.name}. It does not remove visible watermarks, cannot guarantee removal of pixel-level or imperceptible watermarks, and does not guarantee how external platforms classify an image.</p></section>
      <details className="settings"><summary>Numbering settings</summary><div><p>Next successful file: <strong>MS{nextNumber}</strong> plus its format extension</p><button className="text-button" type="button" disabled={actionsDisabled} onClick={resetCounter}>Reset file counter</button>{counter.warning && <p className="storage-warning" role="status">{counter.warning}</p>}</div></details>
    </main>
    <footer><span>{PRODUCT.name}</span><span>Browser-only · JPEG and static PNG</span></footer>
  </div>
}
