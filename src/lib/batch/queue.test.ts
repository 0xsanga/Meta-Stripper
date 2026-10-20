import { describe, expect, it } from 'vitest'
import { BATCH_LIMITS } from '../../config/product'
import { assertBatchAdditionAllowed, BatchLimitError, createQueueItems, summarizeQueue } from './queue'
import type { QueueItem } from './types'

const file = (name: string, size = 1): File => {
  const value = new File([new Uint8Array(Math.min(size, 8))], name, { type: 'image/jpeg' })
  if (size !== value.size) Object.defineProperty(value, 'size', { value: size })
  return value
}

describe('batch queue helpers', () => {
  it('preserves selection order and duplicate filenames while assigning unique internal identities', () => {
    let id = 0
    const duplicate = file('same.jpg')
    const files = [duplicate, file('art.png'), duplicate]
    const items = createQueueItems(files, () => `id-${++id}`)

    expect(items.map((item) => item.file.name)).toEqual(['same.jpg', 'art.png', 'same.jpg'])
    expect(items.map((item) => item.id)).toEqual(['id-1', 'id-2', 'id-3'])
    expect(new Set(items.map((item) => item.id)).size).toBe(3)
    expect(items.every((item) => item.status === 'inspecting')).toBe(true)
  })

  it('enforces the shared queue count limit without changing the existing queue', () => {
    const existing = createQueueItems(
      Array.from({ length: BATCH_LIMITS.maxQueuedFiles - 1 }, (_, index) => file(`${index}.jpg`)),
      (() => { let id = 0; return () => `existing-${++id}` })(),
    )
    const snapshot = [...existing]

    expect(() => assertBatchAdditionAllowed(existing, [file('extra-1.jpg'), file('extra-2.jpg')]))
      .toThrow(BatchLimitError)
    expect(existing).toEqual(snapshot)
  })

  it('enforces the shared combined source-byte limit', () => {
    const existing = createQueueItems([file('large.jpg', BATCH_LIMITS.maxCombinedSourceBytes - 5)], () => 'large')
    expect(() => assertBatchAdditionAllowed(existing, [file('over.png', 6)])).toThrow(/200 MB/)
    expect(() => assertBatchAdditionAllowed(existing, [file('exact.png', 5)])).not.toThrow()
  })

  it('summarises ready, verified, failed, removed, and byte totals', () => {
    const resultBlob = new Blob([new Uint8Array([1, 2, 3])])
    const items: QueueItem[] = [
      { id: 'a', file: file('a.jpg', 10), status: 'ready' },
      { id: 'b', file: file('b.png', 20), status: 'unsupported' },
      { id: 'c', file: file('c.png', 30), status: 'failed' },
      { id: 'd', file: file('d.jpg', 40), status: 'verified', result: {
        blob: resultBlob, bytes: new Uint8Array([1, 2, 3]), filename: 'MS1.jpg',
        downloadUrl: 'blob:one', strategy: 'canvas-rebuild', removedBlocks: 2,
      } },
    ]

    expect(summarizeQueue(items)).toEqual({
      total: 4, ready: 1, verified: 1, failed: 2, removedBlocks: 2,
      originalBytes: 100, cleanedBytes: 3,
    })
  })
})
