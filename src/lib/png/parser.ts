import { LIMITS } from '../../config/product'
import type { MetadataKind } from '../jpeg/types'
import { PngError, type PngInspectionReport, type PngMetadataBlock, type PngMetadataCategory } from './types'

export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_CHUNK_LENGTH = 0x7fffffff
const MAX_CHUNKS = 100_000
const KNOWN_CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND'])
const RENDERING_ANCILLARY = new Set(['tRNS', 'cHRM', 'gAMA', 'sRGB', 'sBIT'])

export interface PngChunk {
  type: string
  length: number
  offset: number
  dataOffset: number
  endOffset: number
  data: Uint8Array
}

const readUint32 = (bytes: Uint8Array, offset: number): number => {
  const a = bytes[offset]
  const b = bytes[offset + 1]
  const c = bytes[offset + 2]
  const d = bytes[offset + 3]
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new PngError('The PNG ends in a truncated chunk.', 'TRUNCATED_CHUNK')
  }
  return ((a * 0x1000000) + (b << 16) + (c << 8) + d) >>> 0
}

const typeFromBytes = (bytes: Uint8Array, offset: number): string => {
  let type = ''
  for (let index = 0; index < 4; index += 1) {
    const value = bytes[offset + index]
    if (value === undefined || !((value >= 65 && value <= 90) || (value >= 97 && value <= 122))) {
      throw new PngError('The PNG contains an invalid chunk type.', 'INVALID_CHUNK_TYPE')
    }
    type += String.fromCharCode(value)
  }
  return type
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

export const calculatePngCrc = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const startsWithPngSignature = (bytes: Uint8Array): boolean =>
  bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value)

const includesAsciiCaseInsensitive = (bytes: Uint8Array, target: string): boolean => {
  const lowered = target.toLowerCase()
  if (bytes.length < lowered.length) return false
  outer: for (let index = 0; index <= bytes.length - lowered.length; index += 1) {
    for (let offset = 0; offset < lowered.length; offset += 1) {
      const value = bytes[index + offset]
      if (value === undefined || String.fromCharCode(value).toLowerCase() !== lowered[offset]) continue outer
    }
    return true
  }
  return false
}

const metadataBlock = (
  chunkType: string,
  category: PngMetadataCategory,
  name: string,
  approximateBytes: number,
  explanation: string,
  kind: MetadataKind,
  removable = true,
): PngMetadataBlock => ({ chunkType, category, name, approximateBytes, explanation, kind, removable })

export const classifyPngChunk = (chunk: PngChunk): PngMetadataBlock | null => {
  const size = chunk.length + 12
  const isText = chunk.type === 'tEXt' || chunk.type === 'zTXt' || chunk.type === 'iTXt'
  if (chunk.type === 'eXIf') {
    return metadataBlock('eXIf', 'exif', 'EXIF data', size, 'Capture, camera, location, orientation or editing fields.', 'privacy')
  }
  if (isText && (
    includesAsciiCaseInsensitive(chunk.data, 'XML:com.adobe.xmp') ||
    includesAsciiCaseInsensitive(chunk.data, '<x:xmpmeta') ||
    includesAsciiCaseInsensitive(chunk.data, 'adobe.com/xap')
  )) {
    return metadataBlock(chunk.type, 'xmp', 'XMP data', size, 'Extensible creator, editing or descriptive metadata stored in a text chunk.', 'privacy')
  }
  if (chunk.type === 'tEXt') {
    return metadataBlock('tEXt', 'text', 'PNG text', size, 'Uncompressed keyword and text information embedded in the file.', 'privacy')
  }
  if (chunk.type === 'zTXt') {
    return metadataBlock('zTXt', 'text', 'Compressed PNG text', size, 'Compressed keyword and text information embedded in the file.', 'privacy')
  }
  if (chunk.type === 'iTXt') {
    return metadataBlock('iTXt', 'text', 'International PNG text', size, 'Language-aware keyword and text information embedded in the file.', 'privacy')
  }
  if (chunk.type === 'iCCP') {
    return metadataBlock('iCCP', 'icc', 'ICC colour profile', size, 'An embedded colour profile used to describe colour rendering.', 'technical')
  }
  if (chunk.type === 'tIME') {
    return metadataBlock('tIME', 'timestamp', 'Modification timestamp', size, 'The date and time when the image was last modified.', 'privacy')
  }
  if (chunk.type === 'pHYs') {
    return metadataBlock('pHYs', 'resolution', 'Pixel density', size, 'Pixel resolution or physical-density information.', 'technical')
  }
  if (chunk.type === 'caBX') {
    return metadataBlock('caBX', 'provenance', 'C2PA / Content Credentials', size, 'Content provenance or authenticity assertions embedded in the file.', 'provenance')
  }
  if (chunk.type === 'dSIG') {
    return metadataBlock('dSIG', 'signature', 'Digital signature', size, 'A digital signature associated with the PNG file.', 'provenance')
  }
  if (chunk.type === 'acTL') {
    return metadataBlock('acTL', 'animation', 'Animated PNG control', size, 'This file contains multiple animation frames.', 'technical', false)
  }
  const ancillary = (chunk.type.charCodeAt(0) & 0x20) !== 0
  if (ancillary && !RENDERING_ANCILLARY.has(chunk.type)) {
    return metadataBlock(chunk.type, 'other-ancillary', 'Other ancillary data', size, 'A nonessential application-specific PNG chunk.', 'technical')
  }
  return null
}

export const walkPngChunks = (input: ArrayBuffer | Uint8Array): PngChunk[] => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (!startsWithPngSignature(bytes)) {
    throw new PngError('This file does not have the complete PNG signature.', 'INVALID_SIGNATURE')
  }
  if (bytes.byteLength > LIMITS.maxFileBytes) {
    throw new PngError(`This PNG is larger than the ${LIMITS.maxFileBytes / 1024 / 1024} MB safety limit.`, 'FILE_TOO_LARGE')
  }

  const chunks: PngChunk[] = []
  let offset = PNG_SIGNATURE.length
  let foundIend = false

  while (offset < bytes.length) {
    if (chunks.length >= MAX_CHUNKS) {
      throw new PngError('The PNG contains too many chunks to inspect safely.', 'IMPOSSIBLE_CHUNK_LENGTH')
    }
    if (bytes.length - offset < 12) throw new PngError('The PNG ends in a truncated chunk.', 'TRUNCATED_CHUNK')

    const length = readUint32(bytes, offset)
    if (length > MAX_CHUNK_LENGTH) {
      throw new PngError('The PNG declares an impossible chunk length.', 'IMPOSSIBLE_CHUNK_LENGTH')
    }
    const type = typeFromBytes(bytes, offset + 4)
    const availableDataBytes = bytes.length - offset - 12
    if (length > availableDataBytes) {
      throw new PngError(`The ${type} chunk extends beyond the end of the file.`, 'TRUNCATED_CHUNK')
    }
    const dataOffset = offset + 8
    const crcOffset = dataOffset + length
    const endOffset = crcOffset + 4
    const expectedCrc = readUint32(bytes, crcOffset)
    const actualCrc = calculatePngCrc(bytes.subarray(offset + 4, crcOffset))
    if (expectedCrc !== actualCrc) {
      throw new PngError(`The ${type} chunk has an invalid CRC checksum.`, 'INVALID_CRC')
    }

    if (chunks.length === 0 && type !== 'IHDR') {
      throw new PngError('The PNG header chunk must be first.', 'IHDR_NOT_FIRST')
    }
    if (type === 'IHDR' && chunks.length !== 0) {
      throw new PngError('The PNG header chunk is not correctly positioned.', 'IHDR_NOT_FIRST')
    }
    if (!KNOWN_CRITICAL.has(type) && (type.charCodeAt(0) & 0x20) === 0) {
      throw new PngError(`The PNG uses an unsupported critical chunk (${type}).`, 'UNKNOWN_CRITICAL_CHUNK')
    }

    const chunk: PngChunk = { type, length, offset, dataOffset, endOffset, data: bytes.subarray(dataOffset, crcOffset) }
    chunks.push(chunk)
    offset = endOffset

    if (type === 'IEND') {
      if (length !== 0) throw new PngError('The PNG end chunk must be empty.', 'INVALID_IEND')
      foundIend = true
      if (offset !== bytes.length) throw new PngError('The PNG contains unexpected bytes after its end chunk.', 'INVALID_IEND')
      break
    }
  }

  if (chunks.length === 0 || chunks[0]?.type !== 'IHDR') {
    throw new PngError('The PNG does not contain a header chunk.', 'MISSING_IHDR')
  }
  if (!chunks.some((chunk) => chunk.type === 'IDAT')) {
    throw new PngError('The PNG does not contain image data.', 'MISSING_IDAT')
  }
  if (!foundIend) throw new PngError('The PNG does not contain a complete end chunk.', 'MISSING_IEND')
  return chunks
}

const VALID_BIT_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

export const inspectPng = (input: ArrayBuffer | Uint8Array): PngInspectionReport => {
  const chunks = walkPngChunks(input)
  const ihdr = chunks[0]
  if (!ihdr || ihdr.type !== 'IHDR') throw new PngError('The PNG does not contain a header chunk.', 'MISSING_IHDR')
  if (ihdr.length !== 13) throw new PngError('The PNG header has an invalid length.', 'INVALID_IHDR')

  const width = readUint32(ihdr.data, 0)
  const height = readUint32(ihdr.data, 4)
  const bitDepth = ihdr.data[8]
  const colorType = ihdr.data[9]
  const compression = ihdr.data[10]
  const filter = ihdr.data[11]
  const interlace = ihdr.data[12]
  const validDepths = colorType === undefined ? undefined : VALID_BIT_DEPTHS[colorType]
  if (
    width === 0 || height === 0 ||
    width > LIMITS.maxDimension || height > LIMITS.maxDimension ||
    width * height > LIMITS.maxPixels ||
    bitDepth === undefined || colorType === undefined || !validDepths?.includes(bitDepth) ||
    compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)
  ) {
    throw new PngError(
      `The PNG header is invalid or exceeds the ${LIMITS.maxDimension.toLocaleString()} px / ${(LIMITS.maxPixels / 1_000_000).toFixed(0)} MP safety limits.`,
      'INVALID_IHDR',
    )
  }

  const metadataBlocks = chunks.map(classifyPngChunk).filter((item): item is PngMetadataBlock => item !== null)
  const hasTrns = chunks.some((chunk) => chunk.type === 'tRNS')
  return {
    isPng: true,
    width,
    height,
    bitDepth,
    colorType,
    hasTransparency: colorType === 4 || colorType === 6 || hasTrns,
    isAnimated: chunks.some((chunk) => chunk.type === 'acTL'),
    metadataBlocks,
    warnings: [],
  }
}
