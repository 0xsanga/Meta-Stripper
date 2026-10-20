import { decodeJpeg, assertSafeDimensions } from '../jpeg/cleaner'
import { inspectPng } from './parser'
import { directStripPngMetadata, stripPngMetadata, verifyCleanedPng } from './stripper'
import { selectPngCleaningStrategy } from './strategy'
import { PngError, type CleanedPng } from './types'

const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new PngError('The browser could not encode the cleaned PNG.', 'ENCODE_FAILED'))),
      'image/png',
    )
  })

export const cleanPng = async (blob: Blob): Promise<CleanedPng> => {
  const sourceBytes = await blob.arrayBuffer()
  const sourceReport = inspectPng(sourceBytes)
  const strategy = selectPngCleaningStrategy(sourceReport)

  if (strategy === 'direct-strip') {
    const stripped = directStripPngMetadata(sourceBytes)
    verifyCleanedPng(stripped)
    const outputBuffer = new ArrayBuffer(stripped.byteLength)
    new Uint8Array(outputBuffer).set(stripped)
    return {
      blob: new Blob([outputBuffer], { type: 'image/png' }),
      bytes: stripped,
      width: sourceReport.width,
      height: sourceReport.height,
      remainingMetadataBlocks: 0,
      strategy,
    }
  }

  let decoded
  try {
    decoded = await decodeJpeg(blob)
  } catch {
    throw new PngError('The browser could not decode this PNG.', 'DECODE_FAILED')
  }

  try {
    assertSafeDimensions(decoded.width, decoded.height)
    const canvas = document.createElement('canvas')
    canvas.width = decoded.width
    canvas.height = decoded.height
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new PngError('A transparent local canvas could not be created.', 'ENCODE_FAILED')
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height)

    const encoded = await canvasToPngBlob(canvas)
    const stripped = stripPngMetadata(await encoded.arrayBuffer())
    verifyCleanedPng(stripped)
    const outputBuffer = new ArrayBuffer(stripped.byteLength)
    new Uint8Array(outputBuffer).set(stripped)
    const outputBlob = new Blob([outputBuffer], { type: 'image/png' })

    return {
      blob: outputBlob,
      bytes: stripped,
      width: decoded.width,
      height: decoded.height,
      remainingMetadataBlocks: 0,
      strategy,
    }
  } finally {
    decoded.close()
  }
}
