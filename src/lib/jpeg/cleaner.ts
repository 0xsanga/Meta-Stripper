import { LIMITS } from '../../config/product'
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

export const cleanJpeg = async (blob: Blob): Promise<CleanedJpeg> => {
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
    const outputBuffer = new ArrayBuffer(stripped.byteLength)
    new Uint8Array(outputBuffer).set(stripped)
    const outputBlob = new Blob([outputBuffer], { type: 'image/jpeg' })

    return {
      blob: outputBlob,
      bytes: stripped,
      width: decoded.width,
      height: decoded.height,
      remainingMetadataBlocks: 0,
    }
  } finally {
    decoded.close()
  }
}
