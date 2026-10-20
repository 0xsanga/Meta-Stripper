import { describe, expect, it } from 'vitest'
import { inspectJpeg, parseExifOrientation, walkJpegSegments } from './parser'
import { asciiBytes, exifPayload, makeJpeg, segment } from '../../test/jpegFixtures'

describe('JPEG inspection', () => {
  it('detects a valid JPEG signature and stops safely at scan data', () => {
    const report = inspectJpeg(makeJpeg())
    expect(report.isJpeg).toBe(true)
    expect(report.metadataBlocks).toHaveLength(0)
  })

  it('rejects an invalid signature', () => {
    expect(() => inspectJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(/valid JPEG signature/i)
  })

  it('rejects a truncated marker', () => {
    expect(() => walkJpegSegments(new Uint8Array([0xff, 0xd8, 0xff]))).toThrow(/incomplete marker/i)
  })

  it('rejects an oversized segment without reading beyond the buffer', () => {
    expect(() => inspectJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00]))).toThrow(/beyond the end/i)
  })

  it('rejects a zero-length segment', () => {
    expect(() => inspectJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00]))).toThrow(/invalid length/i)
  })

  it.each([
    ['exif', segment(0xe1, exifPayload())],
    ['xmp', segment(0xe1, asciiBytes('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>'))],
    ['icc', segment(0xe2, [...asciiBytes('ICC_PROFILE\0'), 1, 1])],
    ['provenance', segment(0xeb, asciiBytes('c2pa.jumb'))],
    ['photoshop', segment(0xed, asciiBytes('Photoshop 3.0\x008BIM'))],
    ['comment', segment(0xfe, asciiBytes('camera comment'))],
    ['other-app', segment(0xe3, [1, 2, 3, 4])],
  ])('classifies %s metadata', (category, metadata) => {
    const report = inspectJpeg(makeJpeg(metadata))
    expect(report.metadataBlocks[0]?.category).toBe(category)
    expect(report.metadataBlocks[0]).not.toHaveProperty('payload')
  })

  it('flags provenance-related content', () => {
    const report = inspectJpeg(makeJpeg(segment(0xeb, asciiBytes('JUMBF c2pa'))))
    expect(report.provenanceDetected).toBe(true)
  })

  it('does not report ordinary JFIF and Adobe compatibility blocks as metadata', () => {
    const jpeg = makeJpeg(segment(0xee, [...asciiBytes('Adobe'), 0, 1, 2]))
    expect(inspectJpeg(jpeg).metadataBlocks).toEqual([])
  })

  it('parses EXIF orientation without exposing EXIF bytes', () => {
    const report = inspectJpeg(makeJpeg(segment(0xe1, exifPayload(8))))
    expect(report.exifOrientation).toBe(8)
    expect(parseExifOrientation(new Uint8Array(exifPayload(3)))).toBe(3)
  })

  it('ignores malformed EXIF orientation data safely', () => {
    expect(parseExifOrientation(new Uint8Array([...asciiBytes('Exif\0\0'), 0, 1]))).toBeUndefined()
  })
})
