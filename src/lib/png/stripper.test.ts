import { describe, expect, it } from 'vitest'
import { inspectPng, walkPngChunks } from './parser'
import { stripPngMetadata, verifyCleanedPng } from './stripper'
import { makePng, pngAscii, pngChunk } from '../../test/pngFixtures'

describe('PNG metadata stripping and verification', () => {
  it('removes targeted metadata and unknown ancillary chunks', () => {
    const source = makePng([
      pngChunk('eXIf', [1, 2]),
      pngChunk('tEXt', pngAscii('Author\0Ada')),
      pngChunk('iCCP', pngAscii('profile\0\0data')),
      pngChunk('tIME', [0x07, 0xe8, 1, 2, 3, 4, 5]),
      pngChunk('pHYs', [0, 0, 1, 0, 0, 0, 1, 0, 1]),
      pngChunk('caBX', pngAscii('c2pa')),
      pngChunk('dSIG', [1]),
      pngChunk('vpAg', [2]),
    ])
    const cleaned = stripPngMetadata(source)
    expect(inspectPng(cleaned).metadataBlocks).toEqual([])
    expect(() => verifyCleanedPng(cleaned)).not.toThrow()
  })

  it('preserves required critical chunks and transparency', () => {
    const source = makePng([pngChunk('tEXt', pngAscii('remove\0me'))], { colorType: 2, transparency: true })
    const cleaned = stripPngMetadata(source)
    expect(walkPngChunks(cleaned).map((chunk) => chunk.type)).toEqual(['IHDR', 'tRNS', 'IDAT', 'IEND'])
    expect(inspectPng(cleaned).hasTransparency).toBe(true)
  })

  it('preserves standard colour-rendering chunks', () => {
    const source = makePng([pngChunk('gAMA', [0, 0, 0xb1, 0x8f]), pngChunk('sRGB', [0])])
    const cleaned = stripPngMetadata(source)
    expect(walkPngChunks(cleaned).map((chunk) => chunk.type)).toEqual(['IHDR', 'gAMA', 'sRGB', 'IDAT', 'IEND'])
  })

  it('fails verification while removable metadata remains', () => {
    expect(() => verifyCleanedPng(makePng([pngChunk('tEXt', pngAscii('still\0here'))]))).toThrow(/Verification found 1/i)
  })

  it('refuses to strip an animated PNG', () => {
    const animated = makePng([pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0])])
    expect(() => stripPngMetadata(animated)).toThrow(/flatten or damage the animation/i)
  })
})
