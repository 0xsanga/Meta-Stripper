import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeJpeg } from '../jpeg/cleaner'
import { cleanPng } from './cleaner'
import { inspectPng, walkPngChunks } from './parser'
import { makePng, pngAscii, pngChunk } from '../../test/pngFixtures'

vi.mock('../jpeg/cleaner', () => ({
  decodeJpeg: vi.fn(),
  assertSafeDimensions: vi.fn(),
}))

const blobLike = (bytes: Uint8Array, type = 'image/png'): Blob => ({
  size: bytes.byteLength,
  type,
  arrayBuffer: async () => Uint8Array.from(bytes).buffer,
} as Blob)

describe('static PNG cleaning', () => {
  const close = vi.fn()
  const clearRect = vi.fn()
  const drawImage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(decodeJpeg).mockResolvedValue({
      source: {} as CanvasImageSource,
      width: 48,
      height: 32,
      close,
    })
    const context = { clearRect, drawImage } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      callback(blobLike(makePng([], { width: 48, height: 32, colorType: 6 }), type ?? 'image/png'))
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('keeps a PNG with no removable metadata without decoding it', async () => {
    const source = makePng([], { width: 48, height: 32, colorType: 6 })
    const result = await cleanPng(blobLike(source))
    expect(result.strategy).toBe('already-clean')
    expect(result.bytes).toEqual(source)
    expect(decodeJpeg).not.toHaveBeenCalled()
  })

  it('directly removes a 21.3 KB caBX block without decoding or recompressing IDAT', async () => {
    const caBxPayload = new Array<number>(21_300).fill(0x41)
    const source = makePng([pngChunk('caBX', caBxPayload)], { width: 48, height: 32, colorType: 6 })
    const sourceIdat = walkPngChunks(source).filter((chunk) => chunk.type === 'IDAT').map((chunk) => Array.from(chunk.data))
    const result = await cleanPng(blobLike(source))
    const resultIdat = walkPngChunks(result.bytes).filter((chunk) => chunk.type === 'IDAT').map((chunk) => Array.from(chunk.data))

    expect(result).toMatchObject({ strategy: 'direct-strip', width: 48, height: 32, remainingMetadataBlocks: 0 })
    expect(inspectPng(result.bytes).metadataBlocks).toEqual([])
    expect(resultIdat).toEqual(sourceIdat)
    expect(result.bytes.byteLength).toBe(source.byteLength - 21_312)
    expect(result.bytes.byteLength).toBeLessThan(source.byteLength)
    expect(decodeJpeg).not.toHaveBeenCalled()
  })

  it('preserves RGBA transparency information exactly during direct stripping', async () => {
    const source = makePng([pngChunk('tEXt', pngAscii('Author\0Ada'))], { width: 48, height: 32, colorType: 6 })
    const result = await cleanPng(blobLike(source))
    expect(result.strategy).toBe('direct-strip')
    expect(inspectPng(result.bytes)).toMatchObject({ colorType: 6, hasTransparency: true })
    expect(walkPngChunks(result.bytes).find((chunk) => chunk.type === 'IHDR')?.data)
      .toEqual(walkPngChunks(source).find((chunk) => chunk.type === 'IHDR')?.data)
  })

  it('preserves palette transparency, PLTE, and tRNS byte-for-byte', async () => {
    const source = makePng([pngChunk('caBX', [1, 2, 3])], { width: 48, height: 32, colorType: 3, transparency: true })
    const result = await cleanPng(blobLike(source))
    const sourceChunks = walkPngChunks(source)
    const resultChunks = walkPngChunks(result.bytes)
    for (const type of ['PLTE', 'tRNS']) {
      expect(resultChunks.find((chunk) => chunk.type === type)?.data)
        .toEqual(sourceChunks.find((chunk) => chunk.type === type)?.data)
    }
    expect(inspectPng(result.bytes)).toMatchObject({ colorType: 3, hasTransparency: true })
    expect(decodeJpeg).not.toHaveBeenCalled()
  })

  it.each([
    ['textual metadata', pngChunk('iTXt', pngAscii('Title\0\0\0\0\0Hello'))],
    ['pixel density', pngChunk('pHYs', [0, 0, 1, 0, 0, 0, 1, 0, 1])],
    ['timestamp', pngChunk('tIME', [0x07, 0xe8, 1, 2, 3, 4, 5])],
    ['safe unknown ancillary data', pngChunk('vpAg', [9, 8, 7])],
  ])('directly removes %s', async (_label, metadata) => {
    const result = await cleanPng(blobLike(makePng([metadata])))
    expect(result.strategy).toBe('direct-strip')
    expect(inspectPng(result.bytes).metadataBlocks).toEqual([])
    expect(decodeJpeg).not.toHaveBeenCalled()
  })

  it.each([
    ['eXIf orientation-sensitive data', pngChunk('eXIf', [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])],
    ['iCCP colour profile', pngChunk('iCCP', pngAscii('profile\0\0data'))],
    ['uncertain rendering-dependent data', pngChunk('bKGD', [0, 0, 0, 0, 0, 0])],
  ])('uses a transparent canvas fallback for %s', async (_label, metadata) => {
    const result = await cleanPng(blobLike(makePng([metadata], { width: 48, height: 32, colorType: 6 })))
    expect(result).toMatchObject({ strategy: 'canvas-rebuild', width: 48, height: 32, remainingMetadataBlocks: 0 })
    expect(result.blob.type).toBe('image/png')
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d', { alpha: true })
    expect(clearRect).toHaveBeenCalledWith(0, 0, 48, 32)
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 48, 32)
    expect(inspectPng(result.bytes).hasTransparency).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })

  it('refuses animated PNG cleaning before decoding or numbering can occur', async () => {
    const animated = makePng([pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0])])
    await expect(cleanPng(blobLike(animated))).rejects.toThrow(/flatten or damage the animation/i)
    expect(decodeJpeg).not.toHaveBeenCalled()
  })
})
