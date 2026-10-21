import { describe, expect, it } from 'vitest'
import { retainChosenFiles, validateImageFile, validateJpegFile } from './fileValidation'
import { makeJpeg } from '../test/jpegFixtures'
import { makePng } from '../test/pngFixtures'

const fileWithBytes = (name: string, bytes: Uint8Array, type = 'image/jpeg'): File => {
  const fileBytes = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(fileBytes).set(bytes)
  const file = new File([fileBytes], name, { type })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  return file
}

describe('JPEG file validation', () => {
  it('accepts a signature-valid JPEG', async () => {
    await expect(validateJpegFile(fileWithBytes('photo.jpg', makeJpeg()))).resolves.toBeInstanceOf(ArrayBuffer)
  })

  it('rejects a renamed non-JPEG', async () => {
    await expect(validateJpegFile(fileWithBytes('renamed.jpeg', new Uint8Array([1, 2, 3]), 'image/jpeg'))).rejects.toThrow(/valid JPEG signature/i)
  })

  it('requires a JPEG filename extension', async () => {
    await expect(validateJpegFile(fileWithBytes('photo.png', makeJpeg(), 'image/png'))).rejects.toThrow(/ending in/i)
  })

  it('detects a valid PNG from its authoritative signature', async () => {
    await expect(validateImageFile(fileWithBytes('art.png', makePng(), 'image/png'))).resolves.toMatchObject({ format: 'png' })
  })

  it('rejects a renamed non-PNG file', async () => {
    await expect(validateImageFile(fileWithBytes('fake.png', new Uint8Array([1, 2, 3]), 'image/png'))).rejects.toThrow(/not a valid JPEG or PNG/i)
  })

  it('rejects extension and signature conflicts in either direction', async () => {
    await expect(validateImageFile(fileWithBytes('jpeg.png', makeJpeg(), 'image/png'))).rejects.toThrow(/extension does not match/i)
    await expect(validateImageFile(fileWithBytes('png.jpg', makePng(), 'image/jpeg'))).rejects.toThrow(/extension does not match/i)
  })

  it('copies a gallery file before the phone releases it', async () => {
    const source = makeJpeg()
    const bytes = new ArrayBuffer(source.byteLength)
    new Uint8Array(bytes).set(source)
    let released = false
    const file = new File([bytes], '1000763815.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => {
        if (released) throw new DOMException('The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.', 'NotReadableError')
        return bytes
      },
    })
    const retained = retainChosenFiles([file])
    released = true
    const [copy] = await retained
    await expect(validateImageFile(copy!)).resolves.toMatchObject({ format: 'jpeg' })
    await expect(copy!.arrayBuffer()).resolves.toBeInstanceOf(ArrayBuffer)
  })

  it('rejects a supported MIME type that conflicts with the file contents', async () => {
    await expect(validateImageFile(fileWithBytes('art.png', makePng(), 'image/jpeg'))).rejects.toThrow(/declared type does not match/i)
  })
})
