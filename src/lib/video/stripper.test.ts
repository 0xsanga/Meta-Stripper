import { describe, expect, it } from 'vitest'
import { makeVideo } from '../../test/videoFixtures'
import { cleanVideo, inspectVideo } from './cleaner'
import { parseBmff, readU32 } from './parser'
import { stripVideoMetadata, verifyCleanedVideo } from './stripper'
import { VideoError } from './types'

const findType = (bytes: Uint8Array, type: string): number => {
  for (let offset = 0; offset + 8 <= bytes.length; offset += 1) {
    if (String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!) === type) return offset
  }
  throw new Error(`Missing ${type}`)
}

const fileFrom = (bytes: Uint8Array, name: string, type: string) => {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return new File([copy], name, { type })
}

const mdatPayload = (bytes: Uint8Array): string => {
  const start = findType(bytes, 'mdat')
  const size = readU32(bytes, start)
  return String.fromCharCode(...bytes.subarray(start + 8, start + size))
}

describe('MP4 and MOV metadata cleaning', () => {
  it('removes C2PA, XMP, and encoder tags without moving the frames', () => {
    const source = makeVideo({ c2pa: true, xmp: true, encoder: true, compressor: 'Lavf58' })
    const cleaned = stripVideoMetadata(source)
    verifyCleanedVideo(cleaned)
    expect(cleaned.byteLength).toBeLessThan(source.byteLength)
    expect(mdatPayload(cleaned)).toBe(mdatPayload(source))
    expect(readU32(cleaned, findType(cleaned, 'stco') + 16)).toBe(findType(cleaned, 'mdat') + 8)
    expect(readU32(cleaned, findType(cleaned, 'stco') + 16)).toBeLessThan(readU32(source, findType(source, 'stco') + 16))
    expect(String.fromCharCode(...cleaned)).not.toContain('Lavf')
    expect(String.fromCharCode(...cleaned)).not.toContain('xmpmeta')
  })

  it('leaves chunk offsets alone when metadata sits after the media', () => {
    const source = makeVideo({ encoder: true, moovFirst: false })
    const cleaned = stripVideoMetadata(source)
    verifyCleanedVideo(cleaned)
    expect(readU32(cleaned, findType(cleaned, 'stco') + 16)).toBe(readU32(source, findType(source, 'stco') + 16))
    expect(mdatPayload(cleaned)).toBe('FRAME-BYTES')
  })

  it('keeps an already-clean video byte for byte', async () => {
    const source = makeVideo()
    const cleaned = await cleanVideo(fileFrom(source, 'plain.mov', 'video/quicktime'))
    expect(cleaned.strategy).toBe('already-clean')
    expect(cleaned.blob.type).toBe('video/quicktime')
    expect(Array.from(cleaned.bytes)).toEqual(Array.from(source))
  })

  it('names SynthID metadata and still does not rewrite the frames', async () => {
    const source = makeVideo({ c2pa: true, synthId: true })
    const report = inspectVideo(source, 'marked.mp4')
    expect(report.synthIdMetadata).toBe(true)
    expect(report.metadataBlocks.map((block) => block.name)).toContain('SynthID metadata')
    const cleaned = await cleanVideo(fileFrom(source, 'marked.mp4', 'video/mp4'))
    expect(cleaned.strategy).toBe('direct-strip')
    expect(String.fromCharCode(...cleaned.bytes)).not.toContain('SynthID')
    expect(mdatPayload(cleaned.bytes)).toBe('FRAME-BYTES')
  })

  it('rejects a fragmented file and a truncated box', () => {
    expect(() => parseBmff(makeVideo({ fragmented: true }))).not.toThrow()
    expect(() => inspectVideo(makeVideo({ fragmented: true }))).toThrow(VideoError)
    expect(() => inspectVideo(makeVideo({ fragmented: true }))).toThrow(/fragmented/)
    expect(() => parseBmff(makeVideo().subarray(0, 30))).toThrow(/truncated/)
  })
})
