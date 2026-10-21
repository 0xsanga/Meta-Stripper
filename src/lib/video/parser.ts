import { VideoError } from './types'

export interface BmffBox {
  type: string
  start: number
  size: number
  headerSize: number
  large: boolean
  uuid?: Uint8Array
  children: BmffBox[]
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts', 'udta'])
const MAX_BOXES = 10_000
const MAX_DEPTH = 16

export const boxType = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0)

export const readU32 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)

export const readU64 = (bytes: Uint8Array, offset: number): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const high = view.getUint32(offset)
  const low = view.getUint32(offset + 4)
  return high * 0x100000000 + low
}

const writeView = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

export const writeU32 = (bytes: Uint8Array, offset: number, value: number) => {
  writeView(bytes).setUint32(offset, value)
}

export const writeU64 = (bytes: Uint8Array, offset: number, value: number) => {
  const view = writeView(bytes)
  view.setUint32(offset, Math.floor(value / 0x100000000))
  view.setUint32(offset + 4, value >>> 0)
}

export const looksLikeBmff = (bytes: Uint8Array): boolean => {
  if (bytes.length < 12) return false
  const type = boxType(bytes, 4)
  return type === 'ftyp' || type === 'moov' || type === 'mdat' || type === 'wide' || type === 'free'
}

const readBoxes = (bytes: Uint8Array, start: number, end: number, depth: number, counter: { count: number }): BmffBox[] => {
  if (depth > MAX_DEPTH) throw new VideoError('This video structure is too deeply nested to clean safely.')
  const boxes: BmffBox[] = []
  let offset = start
  while (offset + 8 <= end) {
    counter.count += 1
    if (counter.count > MAX_BOXES) throw new VideoError('This video has too many boxes to clean safely.')
    const sizeField = readU32(bytes, offset)
    const type = boxType(bytes, offset + 4)
    let size = sizeField
    let headerSize = 8
    let large = false
    if (sizeField === 1) {
      if (offset + 16 > end) throw new VideoError('This video file is truncated.')
      size = readU64(bytes, offset + 8)
      headerSize = 16
      large = true
    } else if (sizeField === 0) {
      size = end - offset
    }
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) {
      throw new VideoError('This video file is truncated.')
    }
    let uuid: Uint8Array | undefined
    if (type === 'uuid') {
      if (size < headerSize + 16) throw new VideoError('This video file is truncated.')
      uuid = bytes.slice(offset + headerSize, offset + headerSize + 16)
      headerSize += 16
    }
    const box: BmffBox = { type, start: offset, size, headerSize, large, uuid, children: [] }
    const payload = offset + headerSize
    const boxEnd = offset + size
    if (CONTAINERS.has(type)) box.children = readBoxes(bytes, payload, boxEnd, depth + 1, counter)
    else if (type === 'meta') box.children = readBoxes(bytes, metaChildStart(bytes, payload, boxEnd), boxEnd, depth + 1, counter)
    else if (type === 'stsd') box.children = readBoxes(bytes, Math.min(payload + 8, boxEnd), boxEnd, depth + 1, counter)
    boxes.push(box)
    offset = boxEnd
  }
  if (offset !== end) throw new VideoError('This video file is truncated.')
  return boxes
}

const metaChildStart = (bytes: Uint8Array, payload: number, end: number): number => {
  if (end - payload >= 8) {
    const size = readU32(bytes, payload)
    const type = boxType(bytes, payload + 4)
    if (type === 'hdlr' && size >= 8 && payload + size <= end) return payload
  }
  return Math.min(payload + 4, end)
}

export const parseBmff = (bytes: Uint8Array): BmffBox[] => readBoxes(bytes, 0, bytes.length, 0, { count: 0 })

export const walkBoxes = (boxes: readonly BmffBox[], visit: (box: BmffBox) => void) => {
  for (const box of boxes) {
    visit(box)
    walkBoxes(box.children, visit)
  }
}
