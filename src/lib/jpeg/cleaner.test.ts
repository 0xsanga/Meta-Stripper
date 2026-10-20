import { describe, expect, it, vi } from 'vitest'
import { cleanJpeg } from './cleaner'
import { stripJpegMetadata } from './stripper'
import { asciiBytes, makeJpeg, segment } from '../../test/jpegFixtures'

const blobLike = (bytes: Uint8Array): Blob => ({
  size: bytes.byteLength,
  type: 'image/jpeg',
  arrayBuffer: async () => Uint8Array.from(bytes).buffer,
} as Blob)

describe('adaptive JPEG cleaning', () => {
  it('removes a comment without decoding or rewriting the scan', async () => {
    const decode = vi.fn(async () => { throw new Error('JPEG decode should not run') })
    vi.stubGlobal('createImageBitmap', decode)
    try {
      const source = makeJpeg(segment(0xfe, asciiBytes('private note')))
      const result = await cleanJpeg(blobLike(source))

      expect(result.strategy).toBe('direct-strip')
      expect(result.bytes).toEqual(stripJpegMetadata(source))
      expect(result.bytes.byteLength).toBeLessThan(source.byteLength)
      expect(Array.from(result.bytes.subarray(-7))).toEqual([0x11, 0x22, 0xff, 0x00, 0x33, 0xff, 0xd9])
      expect(result.width).toBe(1)
      expect(result.height).toBe(1)
      expect(decode).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns the original bytes when nothing removable is present', async () => {
    const source = makeJpeg()
    const result = await cleanJpeg(blobLike(source))
    expect(result.strategy).toBe('already-clean')
    expect(result.bytes).toEqual(source)
  })
})
