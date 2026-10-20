import { describe, expect, it, vi } from 'vitest'
import { cleanJpeg, requireSafeJpegFrame } from './cleaner'
import { stripJpegMetadata } from './stripper'
import { asciiBytes, exifPayload, makeJpeg, segment } from '../../test/jpegFixtures'

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

  it('rejects an oversized oriented JPEG before decoding it', async () => {
    const decode = vi.fn(async () => { throw new Error('JPEG decode should not run') })
    vi.stubGlobal('createImageBitmap', decode)
    try {
      const source = makeJpeg(segment(0xe1, exifPayload(6)))
      for (let index = 0; index < source.length - 8; index += 1) {
        if (source[index] === 0xff && source[index + 1] === 0xc0) {
          source[index + 5] = 0x3a
          source[index + 6] = 0x98
          source[index + 7] = 0x3a
          source[index + 8] = 0x98
          break
        }
      }
      await expect(cleanJpeg(blobLike(source))).rejects.toThrow(/too large to process safely/i)
      expect(decode).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a JPEG that does not declare its dimensions', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x11, 0xff, 0xd9])
    expect(() => requireSafeJpegFrame(bytes)).toThrow(/pixel dimensions/i)
  })

  it('returns the original bytes when nothing removable is present', async () => {
    const source = makeJpeg()
    const result = await cleanJpeg(blobLike(source))
    expect(result.strategy).toBe('already-clean')
    expect(result.bytes).toEqual(source)
  })
})
