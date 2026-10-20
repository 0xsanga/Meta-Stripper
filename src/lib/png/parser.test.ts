import { describe, expect, it } from 'vitest'
import { inspectPng, PNG_SIGNATURE, walkPngChunks } from './parser'
import { ihdrData, makePng, pngAscii, pngChunk } from '../../test/pngFixtures'

describe('PNG inspection', () => {
  it('detects a valid PNG and reads its dimensions and transparency', () => {
    const report = inspectPng(makePng([], { width: 640, height: 480, colorType: 6 }))
    expect(report).toMatchObject({ isPng: true, width: 640, height: 480, hasTransparency: true, isAnimated: false })
  })

  it('rejects an incomplete or invalid eight-byte signature', () => {
    expect(() => inspectPng(new Uint8Array([137, 80, 78, 71]))).toThrow(/complete PNG signature/i)
  })

  it('rejects a truncated chunk', () => {
    const truncated = new Uint8Array([...PNG_SIGNATURE, 0, 0, 0, 13, ...pngAscii('IHDR'), 0, 1])
    expect(() => walkPngChunks(truncated)).toThrow(/extends beyond|truncated/i)
  })

  it('rejects an impossible unsigned chunk length', () => {
    const impossible = new Uint8Array([...PNG_SIGNATURE, 0x80, 0, 0, 0, ...pngAscii('IHDR'), 0, 0, 0, 0])
    expect(() => walkPngChunks(impossible)).toThrow(/impossible chunk length/i)
  })

  it('rejects a missing IHDR', () => {
    expect(() => inspectPng(PNG_SIGNATURE)).toThrow(/does not contain a header/i)
  })

  it('rejects IHDR in any position other than first', () => {
    const bytes = new Uint8Array([...PNG_SIGNATURE, ...pngChunk('IDAT', [1]), ...pngChunk('IHDR', ihdrData()), ...pngChunk('IEND')])
    expect(() => inspectPng(bytes)).toThrow(/header chunk must be first/i)
  })

  it('rejects a missing IEND', () => {
    const bytes = new Uint8Array([...PNG_SIGNATURE, ...pngChunk('IHDR', ihdrData()), ...pngChunk('IDAT', [1])])
    expect(() => inspectPng(bytes)).toThrow(/end chunk/i)
  })

  it('rejects an invalid CRC', () => {
    const bytes = makePng()
    bytes[29] = bytes[29]! ^ 0xff
    expect(() => inspectPng(bytes)).toThrow(/invalid CRC/i)
  })

  it('rejects unknown critical chunks safely', () => {
    const bytes = makePng([pngChunk('ABCD', [1, 2])])
    expect(() => inspectPng(bytes)).toThrow(/unsupported critical chunk/i)
  })

  it.each([
    ['exif', 'eXIf', [1, 2, 3]],
    ['text', 'tEXt', pngAscii('Author\0Ada')],
    ['text', 'zTXt', pngAscii('Comment\0\0compressed')],
    ['text', 'iTXt', pngAscii('Title\0\0\0\0\0Hello')],
    ['xmp', 'iTXt', pngAscii('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>')],
    ['icc', 'iCCP', pngAscii('Display\0\0profile')],
    ['timestamp', 'tIME', [0x07, 0xe8, 1, 2, 3, 4, 5]],
    ['resolution', 'pHYs', [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]],
    ['provenance', 'caBX', pngAscii('c2pa')],
    ['signature', 'dSIG', [1, 2, 3]],
    ['other-ancillary', 'vpAg', [9, 8, 7]],
  ])('classifies %s data in a %s chunk', (category, type, data) => {
    const report = inspectPng(makePng([pngChunk(type, data)]))
    expect(report.metadataBlocks[0]).toMatchObject({ category, chunkType: type, removable: true })
    expect(report.metadataBlocks[0]).not.toHaveProperty('data')
  })

  it('detects an animated PNG without aborting inspection', () => {
    const report = inspectPng(makePng([pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0])]))
    expect(report.isAnimated).toBe(true)
    expect(report.metadataBlocks).toContainEqual(expect.objectContaining({ category: 'animation', removable: false }))
  })

  it('recognises palette transparency as display-essential rather than metadata', () => {
    const report = inspectPng(makePng([], { colorType: 2, transparency: true }))
    expect(report.hasTransparency).toBe(true)
    expect(report.metadataBlocks).toEqual([])
  })
})
