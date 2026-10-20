import { LIMITS } from '../../config/product'
import { inspectJpeg, readJpegFrameSize } from './parser'
import { selectJpegCleaningStrategy } from './strategy'
import { stripJpegMetadata, verifyCleanedJpeg } from './stripper'
import { JpegError, type CleanedJpeg } from './types'

interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

const decodeWithImageElement = (blob: Blob): Promise<DecodedImage> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new JpegError('The browser could not decode this JPEG.', 'DECODE_FAILED'))
    }
    image.src = url
  })

export const decodeJpeg = async (blob: Blob): Promise<DecodedImage> => {
  try {
    if ('createImageBitmap' in globalThis) {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    }
    return await decodeWithImageElement(blob)
  } catch (error) {
    if (error instanceof JpegError) throw error
    throw new JpegError('The browser could not decode this JPEG.', 'DECODE_FAILED')
  }
}

export const assertSafeDimensions = (width: number, height: number): void => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > LIMITS.maxDimension ||
    height > LIMITS.maxDimension ||
    width * height > LIMITS.maxPixels
  ) {
    throw new Error(
      `This image is too large to process safely. Maximum: ${LIMITS.maxDimension.toLocaleString()} px per side and ${(
        LIMITS.maxPixels / 1_000_000
      ).toFixed(0)} megapixels.`,
    )
  }
}

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new JpegError('The browser could not encode the cleaned JPEG.', 'ENCODE_FAILED'))),
      'image/jpeg',
      LIMITS.jpegQuality,
    )
  })

export const readJpegDimensions = async (blob: Blob): Promise<{ width: number; height: number }> => {
  const decoded = await decodeJpeg(blob)
  try {
    assertSafeDimensions(decoded.width, decoded.height)
    return { width: decoded.width, height: decoded.height }
  } finally {
    decoded.close()
  }
}

const cleanedJpeg = (bytes: Uint8Array, width: number, height: number, strategy: CleanedJpeg['strategy']): CleanedJpeg => {
  const outputBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(outputBuffer).set(bytes)
  return {
    blob: new Blob([outputBuffer], { type: 'image/jpeg' }),
    bytes,
    width,
    height,
    remainingMetadataBlocks: 0,
    strategy,
  }
}

const rebuildJpeg = async (blob: Blob): Promise<CleanedJpeg> => {
  const decoded = await decodeJpeg(blob)
  try {
    assertSafeDimensions(decoded.width, decoded.height)
    const canvas = document.createElement('canvas')
    canvas.width = decoded.width
    canvas.height = decoded.height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new JpegError('A local canvas could not be created.', 'ENCODE_FAILED')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height)

    const encoded = await canvasToBlob(canvas)
    const stripped = stripJpegMetadata(await encoded.arrayBuffer())
    verifyCleanedJpeg(stripped)
    return cleanedJpeg(stripped, decoded.width, decoded.height, 'canvas-rebuild')
  } finally {
    decoded.close()
  }
}

export const cleanJpeg = async (blob: Blob): Promise<CleanedJpeg> => {
  const sourceBytes = new Uint8Array(await blob.arrayBuffer())
  const strategy = selectJpegCleaningStrategy(inspectJpeg(sourceBytes))
  if (strategy === 'canvas-rebuild') return rebuildJpeg(blob)

  const stripped = strategy === 'already-clean' ? sourceBytes : stripJpegMetadata(sourceBytes)
  verifyCleanedJpeg(stripped)
  if (stripped.byteLength > sourceBytes.byteLength) {
    throw new JpegError('Direct JPEG cleaning unexpectedly increased the file size.', 'VERIFICATION_FAILED')
  }
  const frame = readJpegFrameSize(sourceBytes)
  return cleanedJpeg(stripped, frame?.width ?? 0, frame?.height ?? 0, strategy)
}
