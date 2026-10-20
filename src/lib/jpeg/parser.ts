import type {
  JpegInspectionReport,
  MetadataBlock,
  MetadataCategory,
  MetadataKind,
} from './types'
import { JpegError } from './types'

const SOI = 0xd8
const EOI = 0xd9
const SOS = 0xda
const COM = 0xfe

interface Segment {
  marker: number
  markerOffset: number
  endOffset: number
  payload: Uint8Array
}

const markerName = (marker: number) => `0xFF${marker.toString(16).padStart(2, '0').toUpperCase()}`

const startsWithAscii = (bytes: Uint8Array, value: string): boolean => {
  if (bytes.length < value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[index] !== value.charCodeAt(index)) return false
  }
  return true
}

const includesAscii = (bytes: Uint8Array, value: string): boolean => {
  if (bytes.length < value.length) return false
  outer: for (let index = 0; index <= bytes.length - value.length; index += 1) {
    for (let offset = 0; offset < value.length; offset += 1) {
      if (bytes[index + offset] !== value.charCodeAt(offset)) continue outer
    }
    return true
  }
  return false
}

const block = (
  category: MetadataCategory,
  name: string,
  marker: number,
  bytes: number,
  explanation: string,
  kind: MetadataKind,
): MetadataBlock => ({
  category,
  name,
  marker: markerName(marker),
  approximateBytes: bytes,
  explanation,
  kind,
})

const isStructuralApp = (marker: number, payload: Uint8Array): boolean =>
  (marker === 0xe0 && (startsWithAscii(payload, 'JFIF\0') || startsWithAscii(payload, 'JFXX\0'))) ||
  (marker === 0xee && startsWithAscii(payload, 'Adobe'))

export const classifyMetadataSegment = (marker: number, payload: Uint8Array): MetadataBlock | null => {
  const byteSize = payload.length + 4

  if (marker === 0xe1 && startsWithAscii(payload, 'Exif\0\0')) {
    return block('exif', 'EXIF data', marker, byteSize, 'Camera, capture, location or editing fields stored by the image.', 'privacy')
  }

  if (
    marker === 0xe1 &&
    (startsWithAscii(payload, 'http://ns.adobe.com/xap/1.0/\0') || includesAscii(payload, '<x:xmpmeta'))
  ) {
    return block('xmp', 'XMP data', marker, byteSize, 'Extensible editing and descriptive metadata, which can include creator details.', 'privacy')
  }

  if (marker === 0xe2 && startsWithAscii(payload, 'ICC_PROFILE\0')) {
    return block('icc', 'ICC colour profile', marker, byteSize, 'An embedded colour profile used to describe colour rendering.', 'technical')
  }

  if (
    marker === 0xeb &&
    (includesAscii(payload, 'JUMBF') || includesAscii(payload, 'jumb') || includesAscii(payload, 'c2pa'))
  ) {
    return block('provenance', 'JUMBF / C2PA provenance data', marker, byteSize, 'Content provenance or authenticity assertions embedded in the file.', 'provenance')
  }

  if (
    marker === 0xed &&
    (startsWithAscii(payload, 'Photoshop 3.0\0') || includesAscii(payload, '8BIM') || includesAscii(payload, 'IPTC'))
  ) {
    return block('photoshop', 'Photoshop / IPTC data', marker, byteSize, 'Editing, authorship, caption or publishing information.', 'privacy')
  }

  if (marker === COM) {
    return block('comment', 'JPEG comment', marker, byteSize, 'A free-text comment embedded in the JPEG file.', 'privacy')
  }

  if (marker >= 0xe0 && marker <= 0xef && !isStructuralApp(marker, payload)) {
    return block('other-app', 'Other application metadata', marker, byteSize, 'An unrecognised application-specific block that is not required image structure.', 'technical')
  }

  return null
}

const readUint16 = (bytes: Uint8Array, offset: number, littleEndian: boolean): number => {
  const first = bytes[offset]
  const second = bytes[offset + 1]
  if (first === undefined || second === undefined) throw new RangeError('Out-of-bounds 16-bit read')
  return littleEndian ? first | (second << 8) : (first << 8) | second
}

const readUint32 = (bytes: Uint8Array, offset: number, littleEndian: boolean): number => {
  const a = bytes[offset]
  const b = bytes[offset + 1]
  const c = bytes[offset + 2]
  const d = bytes[offset + 3]
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new RangeError('Out-of-bounds 32-bit read')
  }
  return littleEndian
    ? (a | (b << 8) | (c << 16) | (d << 24)) >>> 0
    : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

export const parseExifOrientation = (payload: Uint8Array): number | undefined => {
  if (!startsWithAscii(payload, 'Exif\0\0') || payload.length < 14) return undefined
  const tiff = payload.subarray(6)

  try {
    const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49
    const bigEndian = tiff[0] === 0x4d && tiff[1] === 0x4d
    if (!littleEndian && !bigEndian) return undefined
    if (readUint16(tiff, 2, littleEndian) !== 42) return undefined

    const ifdOffset = readUint32(tiff, 4, littleEndian)
    if (ifdOffset > tiff.length - 2) return undefined
    const count = readUint16(tiff, ifdOffset, littleEndian)
    const entriesStart = ifdOffset + 2
    if (count > Math.floor((tiff.length - entriesStart) / 12)) return undefined

    for (let index = 0; index < count; index += 1) {
      const offset = entriesStart + index * 12
      const tag = readUint16(tiff, offset, littleEndian)
      if (tag !== 0x0112) continue
      const type = readUint16(tiff, offset + 2, littleEndian)
      const valueCount = readUint32(tiff, offset + 4, littleEndian)
      if (type !== 3 || valueCount !== 1) return undefined
      const orientation = readUint16(tiff, offset + 8, littleEndian)
      return orientation >= 1 && orientation <= 8 ? orientation : undefined
    }
  } catch {
    return undefined
  }

  return undefined
}

const isStandaloneMarker = (marker: number): boolean => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)

export const walkJpegSegments = (input: ArrayBuffer | Uint8Array): Segment[] => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new JpegError('This file does not have a valid JPEG signature.', 'INVALID_SIGNATURE')
  }

  const segments: Segment[] = []
  let offset = 2
  let reachedScan = false

  while (offset < bytes.length) {
    const markerOffset = offset
    if (bytes[offset] !== 0xff) {
      throw new JpegError(`Expected a JPEG marker at byte ${offset}.`, 'TRUNCATED_MARKER')
    }

    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) throw new JpegError('The JPEG ends in an incomplete marker.', 'TRUNCATED_MARKER')

    const marker = bytes[offset]
    if (marker === undefined || marker === 0x00) {
      throw new JpegError(`Invalid JPEG marker at byte ${markerOffset}.`, 'TRUNCATED_MARKER')
    }
    offset += 1

    if (marker === EOI) {
      segments.push({ marker, markerOffset, endOffset: offset, payload: new Uint8Array() })
      break
    }

    if (isStandaloneMarker(marker)) {
      segments.push({ marker, markerOffset, endOffset: offset, payload: new Uint8Array() })
      continue
    }

    if (offset + 2 > bytes.length) throw new JpegError('A JPEG segment length is truncated.', 'TRUNCATED_MARKER')
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!
    if (length < 2) throw new JpegError('A JPEG segment declares an invalid length.', 'INVALID_SEGMENT_LENGTH')
    const endOffset = offset + length
    if (endOffset > bytes.length) {
      throw new JpegError('A JPEG segment extends beyond the end of the file.', 'SEGMENT_OUT_OF_BOUNDS')
    }

    const payload = bytes.subarray(offset + 2, endOffset)
    segments.push({ marker, markerOffset, endOffset, payload })
    offset = endOffset

    if (marker === SOS) {
      reachedScan = true
      break
    }
  }

  if (!reachedScan && !segments.some((segment) => segment.marker === EOI)) {
    throw new JpegError('The JPEG is incomplete and has no scan data or end marker.', 'MISSING_SCAN_DATA')
  }

  return segments
}

const FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

export const readJpegFrameSize = (input: ArrayBuffer | Uint8Array): { width: number; height: number } | undefined => {
  for (const segment of walkJpegSegments(input)) {
    if (!FRAME_MARKERS.has(segment.marker) || segment.payload.length < 5) continue
    const height = (segment.payload[1]! << 8) | segment.payload[2]!
    const width = (segment.payload[3]! << 8) | segment.payload[4]!
    if (width > 0 && height > 0) return { width, height }
  }
  return undefined
}

export const inspectJpeg = (input: ArrayBuffer | Uint8Array): JpegInspectionReport => {
  const segments = walkJpegSegments(input)
  const metadataBlocks: MetadataBlock[] = []
  let exifOrientation: number | undefined

  for (const segment of segments) {
    const detected = classifyMetadataSegment(segment.marker, segment.payload)
    if (detected) metadataBlocks.push(detected)
    if (detected?.category === 'exif' && exifOrientation === undefined) {
      exifOrientation = parseExifOrientation(segment.payload)
    }
  }

  return {
    isJpeg: true,
    metadataBlocks,
    ...(exifOrientation === undefined ? {} : { exifOrientation }),
    provenanceDetected: metadataBlocks.some((item) => item.kind === 'provenance'),
    warnings: [],
  }
}
