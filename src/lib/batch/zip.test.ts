import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createSequenceCounter } from '../sequenceCounter'
import { createVerifiedZip } from './zip'

const blob = (bytes: number[]): Blob => ({
  size: bytes.length,
  type: 'application/octet-stream',
  arrayBuffer: async () => Uint8Array.from(bytes).buffer,
} as Blob)

const u16 = (bytes: Uint8Array, offset: number): number => bytes[offset]! | (bytes[offset + 1]! << 8)
const u32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0

interface CentralEntry {
  name: string
  method: number
  time: number
  date: number
  extraLength: number
  commentLength: number
}

const readCentralEntries = (bytes: Uint8Array): { entries: CentralEntry[]; archiveCommentLength: number } => {
  let end = bytes.length - 22
  while (end >= 0 && u32(bytes, end) !== 0x06054b50) end -= 1
  if (end < 0) throw new Error('Missing ZIP end record')
  const total = u16(bytes, end + 10)
  let offset = u32(bytes, end + 16)
  const entries: CentralEntry[] = []
  for (let index = 0; index < total; index += 1) {
    if (u32(bytes, offset) !== 0x02014b50) throw new Error('Missing ZIP central entry')
    const nameLength = u16(bytes, offset + 28)
    const extraLength = u16(bytes, offset + 30)
    const commentLength = u16(bytes, offset + 32)
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    entries.push({
      name,
      method: u16(bytes, offset + 10),
      time: u16(bytes, offset + 12),
      date: u16(bytes, offset + 14),
      extraLength,
      commentLength,
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return { entries, archiveCommentLength: u16(bytes, end + 20) }
}

describe('verified ZIP generation', () => {
  it('creates a real store-mode archive with only exact verified MS names and bytes', async () => {
    const jpeg = [0xff, 0xd8, 0xff, 0xd9]
    const png = [137, 80, 78, 71, 13, 10, 26, 10]
    const generated = await createVerifiedZip([
      { filename: 'MS9.png', blob: blob(png) },
      { filename: 'MS4.jpg', blob: blob(jpeg) },
    ])
    const extracted = unzipSync(generated.bytes)

    expect(generated.filename).toBe('Meta-Stripper-MS4-to-MS9.zip')
    expect(Object.keys(extracted)).toEqual(['MS9.png', 'MS4.jpg'])
    expect(Array.from(extracted['MS9.png']!)).toEqual(png)
    expect(Array.from(extracted['MS4.jpg']!)).toEqual(jpeg)

    const central = readCentralEntries(generated.bytes)
    expect(central.entries.map((entry) => entry.name)).toEqual(['MS9.png', 'MS4.jpg'])
    expect(central.entries.every((entry) => entry.method === 0)).toBe(true)
    expect(central.entries.every((entry) => entry.time === 0 && entry.date === 0x21)).toBe(true)
    expect(central.entries.every((entry) => entry.extraLength === 0 && entry.commentLength === 0)).toBe(true)
    expect(central.entries.every((entry) => !entry.name.includes('/'))).toBe(true)
    expect(central.archiveCommentLength).toBe(0)
    expect(new TextDecoder('latin1').decode(generated.bytes)).not.toContain('holiday-original.jpg')
  })

  it('produces stable bytes for the same verified inputs and does not change numbering', async () => {
    const storage = new Map<string, string>()
    const storageLike = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => storage.clear(),
      key: () => null,
      get length() { return storage.size },
    } as Storage
    const counter = createSequenceCounter(storageLike)
    counter.assignVerified('jpg')
    const before = counter.peek()
    const entries = [
      { filename: 'MS1.jpg', blob: blob([1, 2, 3]) },
      { filename: 'MS2.png', blob: blob([4, 5, 6]) },
    ]
    const first = await createVerifiedZip(entries)
    const second = await createVerifiedZip(entries)

    expect(first.bytes).toEqual(second.bytes)
    expect(first.filename).toBe(second.filename)
    expect(counter.peek()).toBe(before)
  })

  it('rejects incomplete or non-verified entry sets', async () => {
    await expect(createVerifiedZip([{ filename: 'MS1.jpg', blob: blob([1]) }])).rejects.toThrow(/two verified/)
    await expect(createVerifiedZip([
      { filename: 'holiday.jpg', blob: blob([1]) },
      { filename: 'MS2.png', blob: blob([2]) },
    ])).rejects.toThrow(/verified MS/)
    await expect(createVerifiedZip([
      { filename: 'MS2.png', blob: blob([1]) },
      { filename: 'MS2.png', blob: blob([2]) },
    ])).rejects.toThrow(/unique/)
  })
})
