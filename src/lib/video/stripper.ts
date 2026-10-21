import { compressorNames, chunkOffsetBoxes, hasVisualCompressorField, isRemovableBox, mdatPayloadRanges, removableBoxes } from './metadata'
import { parseBmff, readU32, readU64, walkBoxes, writeU32, writeU64, type BmffBox } from './parser'
import { VideoError } from './types'

interface Range { start: number; end: number }

const removedInside = (box: BmffBox, ranges: readonly Range[]): number =>
  ranges.reduce((sum, range) => range.start >= box.start && range.end <= box.start + box.size ? sum + range.end - range.start : sum, 0)

const shiftOf = (offset: number, ranges: readonly Range[]): number => {
  let delta = 0
  for (const range of ranges) {
    if (range.end <= offset) delta += range.end - range.start
    else if (range.start < offset) throw new VideoError('A media offset points into removed metadata.')
    else break
  }
  return offset - delta
}

const patchSizes = (output: Uint8Array, boxes: readonly BmffBox[], ranges: readonly Range[]) => {
  walkBoxes(boxes, (box) => {
    if (ranges.some((range) => box.start >= range.start && box.start < range.end)) return
    const removed = removedInside(box, ranges)
    if (!removed) return
    const at = shiftOf(box.start, ranges)
    if (box.large) writeU64(output, at + 8, box.size - removed)
    else writeU32(output, at, box.size - removed)
  })
}

const patchChunkOffsets = (bytes: Uint8Array, output: Uint8Array, boxes: readonly BmffBox[], ranges: readonly Range[]) => {
  for (const box of chunkOffsetBoxes(boxes)) {
    if (ranges.some((range) => box.start >= range.start && box.start < range.end)) continue
    const countAt = box.start + box.headerSize + 4
    const count = readU32(bytes, countAt)
    const entries = countAt + 4
    const width = box.type === 'co64' ? 8 : 4
    if (entries + count * width > box.start + box.size) throw new VideoError('This video file is truncated.')
    for (let index = 0; index < count; index += 1) {
      const source = entries + index * width
      const oldOffset = box.type === 'co64' ? readU64(bytes, source) : readU32(bytes, source)
      const next = shiftOf(oldOffset, ranges)
      if (box.type === 'co64') writeU64(output, shiftOf(source, ranges), next)
      else writeU32(output, shiftOf(source, ranges), next)
    }
  }
}

const zeroCompressorNames = (output: Uint8Array, boxes: readonly BmffBox[], ranges: readonly Range[]) => {
  walkBoxes(boxes, (box) => {
    if (box.type !== 'stsd') return
    for (const entry of box.children) {
      if (!hasVisualCompressorField(entry) || ranges.some((range) => entry.start >= range.start && entry.start < range.end)) continue
      const at = shiftOf(entry.start + 50, ranges)
      output.fill(0, at, at + 32)
    }
  })
}

export const stripVideoMetadata = (bytes: Uint8Array): Uint8Array => {
  const boxes = parseBmff(bytes)
  const removed = removableBoxes(bytes, boxes).map((box) => ({ start: box.start, end: box.start + box.size }))
  removed.sort((left, right) => left.start - right.start)
  const removedTotal = removed.reduce((sum, range) => sum + range.end - range.start, 0)
  const output = new Uint8Array(bytes.length - removedTotal)
  let cursor = 0
  let position = 0
  for (const range of removed) {
    if (range.start > position) {
      output.set(bytes.subarray(position, range.start), cursor)
      cursor += range.start - position
    }
    position = range.end
  }
  if (position < bytes.length) output.set(bytes.subarray(position), cursor)
  patchSizes(output, boxes, removed)
  patchChunkOffsets(bytes, output, boxes, removed)
  zeroCompressorNames(output, boxes, removed)
  return output
}

export const verifyCleanedVideo = (bytes: Uint8Array) => {
  const boxes = parseBmff(bytes)
  if (removableBoxes(bytes, boxes).some((box) => isRemovableBox(bytes, box))) {
    throw new VideoError('Video metadata was still present after cleaning.')
  }
  if (compressorNames(bytes, boxes).length) throw new VideoError('An encoder name was still present after cleaning.')
  const media = mdatPayloadRanges(boxes)
  for (const box of chunkOffsetBoxes(boxes)) {
    const count = readU32(bytes, box.start + box.headerSize + 4)
    const entries = box.start + box.headerSize + 8
    const width = box.type === 'co64' ? 8 : 4
    for (let index = 0; index < count; index += 1) {
      const offset = box.type === 'co64' ? readU64(bytes, entries + index * width) : readU32(bytes, entries + index * width)
      if (!media.some((range) => offset >= range.start && offset < range.end)) {
        throw new VideoError('Cleaning moved a media offset outside the video data.')
      }
    }
  }
}
