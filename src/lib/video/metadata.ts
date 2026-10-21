import { readU32, walkBoxes, type BmffBox } from './parser'
import { VideoError, type VideoMetadataBlock } from './types'

const C2PA_UUID = [0x63, 0x32, 0x70, 0x61, 0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71]
const XMP_UUID = [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac]
const VISUAL_SAMPLES = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'vp08', 'vp09', 'av01', 'mp4v', 'encv', 's263', 'jpeg'])

const sameUuid = (uuid: Uint8Array | undefined, expected: number[]): boolean =>
  !!uuid && uuid.length === expected.length && expected.every((value, index) => uuid[index] === value)

const payloadText = (bytes: Uint8Array, box: BmffBox): string => {
  let text = ''
  const end = Math.min(box.start + box.size, box.start + box.headerSize + 4096)
  for (let index = box.start + box.headerSize; index < end; index += 1) text += String.fromCharCode(bytes[index] ?? 0)
  return text
}

export const isC2paBox = (bytes: Uint8Array, box: BmffBox): boolean => {
  if (box.type === 'c2pa') return true
  if (box.type !== 'uuid') return false
  if (sameUuid(box.uuid, C2PA_UUID)) return true
  const text = payloadText(bytes, box)
  return text.includes('jumb') || text.includes('c2pa')
}

export const isXmpBox = (bytes: Uint8Array, box: BmffBox): boolean => {
  if (box.type === 'XMP_' || box.type === 'xml ') {
    const text = payloadText(bytes, box)
    return box.type === 'XMP_' || text.includes('x:xmpmeta') || text.includes('http://ns.adobe.com/xap/')
  }
  return box.type === 'uuid' && (sameUuid(box.uuid, XMP_UUID) || payloadText(bytes, box).includes('x:xmpmeta'))
}

const isUserTag = (type: string): boolean => type.charCodeAt(0) === 0xa9

export const isRemovableBox = (bytes: Uint8Array, box: BmffBox): boolean =>
  box.type === 'udta' || box.type === 'meta' || isC2paBox(bytes, box) || isXmpBox(bytes, box)

export const removableBoxes = (bytes: Uint8Array, boxes: readonly BmffBox[]): BmffBox[] => {
  const found: BmffBox[] = []
  const visit = (box: BmffBox) => {
    if (isRemovableBox(bytes, box)) {
      found.push(box)
      return
    }
    box.children.forEach(visit)
  }
  boxes.forEach(visit)
  return found
}

export const hasVisualCompressorField = (box: BmffBox): boolean => VISUAL_SAMPLES.has(box.type) && box.size >= 86

export const visualCompressorName = (bytes: Uint8Array, box: BmffBox): string => {
  if (!hasVisualCompressorField(box)) return ''
  const start = box.start + 50
  const length = Math.min(bytes[start] ?? 0, 31)
  let name = ''
  for (let index = 0; index < length; index += 1) name += String.fromCharCode(bytes[start + 1 + index] ?? 0)
  return name.replace(/\0/g, '').trim()
}

export const compressorNames = (bytes: Uint8Array, boxes: readonly BmffBox[]): string[] => {
  const names: string[] = []
  walkBoxes(boxes, (box) => {
    if (box.type !== 'stsd') return
    for (const entry of box.children) {
      const name = visualCompressorName(bytes, entry)
      if (name) names.push(name)
    }
  })
  return names
}

const mentionsSynthId = (text: string): boolean => /synthid/i.test(text)

export const describeMetadata = (bytes: Uint8Array, boxes: readonly BmffBox[]): VideoMetadataBlock[] => {
  const blocks: VideoMetadataBlock[] = []
  const removed = removableBoxes(bytes, boxes)
  for (const box of removed) {
    const text = payloadText(bytes, box)
    if (mentionsSynthId(text)) {
      blocks.push({
        name: 'SynthID metadata',
        box: box.type,
        approximateBytes: box.size,
        kind: 'provenance',
        explanation: 'A metadata tag names SynthID. The tag is removed with the other file metadata. A SynthID watermark woven into the frames is not a tag and is not removed.',
      })
      continue
    }
    if (isC2paBox(bytes, box)) {
      blocks.push({ name: 'C2PA provenance', box: box.type, approximateBytes: box.size, kind: 'provenance', explanation: 'A C2PA manifest is stored beside the video and can be removed without rewriting the frames.' })
      continue
    }
    if (isXmpBox(bytes, box)) {
      blocks.push({ name: 'XMP', box: box.type, approximateBytes: box.size, kind: 'privacy', explanation: 'XMP can carry creator, history, and provenance text outside the video frames.' })
      continue
    }
    const encoder = /\u00a9too|encoder|Lavf|Lavc|software/i.test(text) || walkHas(box, (child) => isUserTag(child.type) && child.type.slice(1) === 'too')
    blocks.push(encoder
      ? { name: 'Encoder tag', box: box.type, approximateBytes: box.size, kind: 'technical', explanation: 'The encoder or tool name is stored in the movie metadata, not in the frames.' }
      : { name: box.type === 'udta' ? 'User data' : 'QuickTime metadata', box: box.type, approximateBytes: box.size, kind: 'privacy', explanation: 'Movie metadata can include location, author, tool, and other tags.' })
  }
  for (const name of compressorNames(bytes, boxes)) {
    blocks.push({
      name: mentionsSynthId(name) ? 'SynthID metadata' : 'Encoder name',
      box: 'stsd',
      approximateBytes: name.length,
      kind: mentionsSynthId(name) ? 'provenance' : 'technical',
      explanation: mentionsSynthId(name)
        ? 'The sample description names SynthID. Clearing that name does not remove a watermark woven into the frames.'
        : `The sample description names the encoder (${name}). The name can be cleared without recompressing the video.`,
    })
  }
  return blocks
}

const walkHas = (box: BmffBox, test: (box: BmffBox) => boolean): boolean =>
  test(box) || box.children.some((child) => walkHas(child, test))

export const videoDimensions = (boxes: readonly BmffBox[], bytes: Uint8Array): { width?: number; height?: number } => {
  let width: number | undefined
  let height: number | undefined
  walkBoxes(boxes, (box) => {
    if (box.type !== 'tkhd' || width) return
    const version = bytes[box.start + box.headerSize] ?? 0
    const widthOffset = box.start + box.headerSize + (version === 1 ? 88 : 76)
    if (widthOffset + 8 > box.start + box.size) return
    width = readU32(bytes, widthOffset) >> 16
    height = readU32(bytes, widthOffset + 4) >> 16
  })
  return { width, height }
}

export const assertPlayableStructure = (boxes: readonly BmffBox[]) => {
  const types = new Set<string>()
  walkBoxes(boxes, (box) => { types.add(box.type) })
  if (types.has('moof')) throw new VideoError('This video is fragmented, so its metadata cannot be removed without rewriting the media.')
  if (!types.has('moov') || !types.has('mdat')) throw new VideoError('This video is missing the structure needed to remove metadata safely.')
}

export const chunkOffsetBoxes = (boxes: readonly BmffBox[]): BmffBox[] => {
  const found: BmffBox[] = []
  walkBoxes(boxes, (box) => { if (box.type === 'stco' || box.type === 'co64') found.push(box) })
  return found
}

export const mdatPayloadRanges = (boxes: readonly BmffBox[]): { start: number; end: number }[] => {
  const ranges: { start: number; end: number }[] = []
  walkBoxes(boxes, (box) => {
    if (box.type === 'mdat') ranges.push({ start: box.start + box.headerSize, end: box.start + box.size })
  })
  return ranges
}
