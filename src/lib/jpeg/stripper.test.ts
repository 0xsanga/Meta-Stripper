import { describe, expect, it } from 'vitest'
import { inspectJpeg } from './parser'
import { stripJpegMetadata, verifyCleanedJpeg } from './stripper'
import { asciiBytes, exifPayload, makeJpeg, segment } from '../../test/jpegFixtures'

describe('JPEG metadata stripping and verification', () => {
  it('removes all targeted metadata blocks', () => {
    const source = makeJpeg(
      segment(0xe1, exifPayload()),
      segment(0xe1, asciiBytes('http://ns.adobe.com/xap/1.0/\0')),
      segment(0xe2, asciiBytes('ICC_PROFILE\0')),
      segment(0xeb, asciiBytes('JUMBF c2pa')),
      segment(0xed, asciiBytes('Photoshop 3.0\x008BIM')),
      segment(0xfe, asciiBytes('comment')),
      segment(0xe4, [4, 3, 2, 1]),
    )
    const cleaned = stripJpegMetadata(source)
    expect(inspectJpeg(cleaned).metadataBlocks).toHaveLength(0)
    expect(() => verifyCleanedJpeg(cleaned)).not.toThrow()
  })

  it('preserves structural markers and compressed scan data', () => {
    const source = makeJpeg(segment(0xe1, exifPayload()))
    const cleaned = stripJpegMetadata(source)
    const markers = Array.from(cleaned)
    expect(markers).toEqual(expect.arrayContaining([0xff, 0xdb, 0xff, 0xc0, 0xff, 0xc4, 0xff, 0xda]))
    expect(markers.slice(-7)).toEqual([0x11, 0x22, 0xff, 0x00, 0x33, 0xff, 0xd9])
  })

  it('preserves JFIF compatibility data', () => {
    const cleaned = stripJpegMetadata(makeJpeg(segment(0xfe, asciiBytes('remove me'))))
    expect(Array.from(cleaned.slice(2, 9))).toEqual([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49])
  })

  it('fails verification when removable metadata remains', () => {
    const unclean = makeJpeg(segment(0xfe, asciiBytes('still here')))
    expect(() => verifyCleanedJpeg(unclean)).toThrow(/Verification found 1/i)
  })
})
