import { PNG_SIGNATURE, classifyPngChunk, inspectPng, walkPngChunks } from './parser'
import { selectPngCleaningStrategy } from './strategy'
import { PngError } from './types'

const ALLOWED_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'sRGB', 'sBIT'])

const concatenate = (chunks: Uint8Array[]): Uint8Array => {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

export const stripPngMetadata = (input: ArrayBuffer | Uint8Array): Uint8Array => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const report = inspectPng(bytes)
  if (report.isAnimated) {
    throw new PngError(
      'Animated PNG cleaning is unavailable because rebuilding it would flatten or damage the animation.',
      'ANIMATED_PNG_UNSUPPORTED',
    )
  }
  const chunks = walkPngChunks(bytes)
  return concatenate([
    PNG_SIGNATURE,
    ...chunks.filter((chunk) => ALLOWED_CHUNKS.has(chunk.type)).map((chunk) => bytes.subarray(chunk.offset, chunk.endOffset)),
  ])
}

export const directStripPngMetadata = (input: ArrayBuffer | Uint8Array): Uint8Array => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const report = inspectPng(bytes)
  if (selectPngCleaningStrategy(report) !== 'direct-strip') {
    throw new PngError('This PNG requires a canvas rebuild to preserve its displayed appearance.', 'VERIFICATION_FAILED')
  }
  const chunks = walkPngChunks(bytes)
  const retained = chunks.filter((chunk) => !classifyPngChunk(chunk)?.removable)
  const output = concatenate([
    bytes.subarray(0, PNG_SIGNATURE.length),
    ...retained.map((chunk) => bytes.subarray(chunk.offset, chunk.endOffset)),
  ])
  verifyCleanedPng(output)
  if (output.byteLength > bytes.byteLength) {
    throw new PngError('Direct PNG cleaning unexpectedly increased the file size.', 'VERIFICATION_FAILED')
  }
  return output
}

export const verifyCleanedPng = (input: ArrayBuffer | Uint8Array): void => {
  const report = inspectPng(input)
  const remaining = report.metadataBlocks.filter((block) => block.removable)
  if (remaining.length > 0) {
    throw new PngError(
      `Verification found ${remaining.length} removable PNG metadata block(s).`,
      'VERIFICATION_FAILED',
    )
  }
}
