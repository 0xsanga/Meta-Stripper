import { classifyMetadataSegment, inspectJpeg, walkJpegSegments } from './parser'
import { JpegError } from './types'

const SOS = 0xda

const concatenate = (chunks: Uint8Array[]): Uint8Array => {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

export const stripJpegMetadata = (input: ArrayBuffer | Uint8Array): Uint8Array => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const segments = walkJpegSegments(bytes)
  const chunks: Uint8Array[] = [bytes.subarray(0, 2)]

  for (const segment of segments) {
    if (segment.marker === SOS) {
      chunks.push(bytes.subarray(segment.markerOffset))
      break
    }
    if (!classifyMetadataSegment(segment.marker, segment.payload)) {
      chunks.push(bytes.subarray(segment.markerOffset, segment.endOffset))
    }
  }

  return concatenate(chunks)
}

export const verifyCleanedJpeg = (input: ArrayBuffer | Uint8Array): void => {
  const report = inspectJpeg(input)
  if (report.metadataBlocks.length > 0) {
    throw new JpegError(
      `Verification found ${report.metadataBlocks.length} removable metadata block(s).`,
      'VERIFICATION_FAILED',
    )
  }
}
