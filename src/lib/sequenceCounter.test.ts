import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRODUCT } from '../config/product'
import { createSequenceCounter } from './sequenceCounter'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('persistent MS sequence counter', () => {
  let storage: MemoryStorage

  beforeEach(() => { storage = new MemoryStorage() })

  it('starts with MS1.jpg and increments only on verified assignment', () => {
    const counter = createSequenceCounter(storage)
    expect(counter.peek()).toBe(1)
    expect(counter.assignVerified()).toBe('MS1.jpg')
    expect(counter.peek()).toBe(2)
  })

  it('loads the next sequence across instances', () => {
    storage.setItem(PRODUCT.sequenceStorageKey, '17')
    const first = createSequenceCounter(storage)
    expect(first.peek()).toBe(17)
    expect(first.assignVerified('png')).toBe('MS17.png')
    expect(createSequenceCounter(storage).peek()).toBe(18)
  })

  it('does not increment during inspection, failure, cancellation, or repeated download', () => {
    const counter = createSequenceCounter(storage)
    const inspectedNumber = counter.peek()
    const failedNumber = counter.peek()
    expect(inspectedNumber).toBe(1)
    expect(failedNumber).toBe(1)
    const assigned = counter.assignVerified()
    const repeatedDownloadName = assigned
    expect(repeatedDownloadName).toBe('MS1.jpg')
    expect(counter.peek()).toBe(2)
  })

  it.each(['0', '-1', '1.5', 'unsafe', String(Number.MAX_SAFE_INTEGER + 1), ''])('recovers invalid stored value %s to 1', (value) => {
    storage.setItem(PRODUCT.sequenceStorageKey, value)
    const counter = createSequenceCounter(storage)
    expect(counter.peek()).toBe(1)
    expect(storage.getItem(PRODUCT.sequenceStorageKey)).toBe('1')
  })

  it('resets only the next number', () => {
    const counter = createSequenceCounter(storage)
    counter.assignVerified()
    counter.assignVerified()
    counter.reset()
    expect(counter.peek()).toBe(1)
  })

  it('uses a warned in-memory fallback when localStorage is unavailable', () => {
    const counter = createSequenceCounter(null)
    expect(counter.persistent).toBe(false)
    expect(counter.warning).toMatch(/will restart/i)
    expect(counter.assignVerified()).toBe('MS1.jpg')
    expect(counter.assignVerified()).toBe('MS2.jpg')
  })

  it('stores only the namespaced next number and no file data', () => {
    const setItem = vi.spyOn(storage, 'setItem')
    const counter = createSequenceCounter(storage)
    counter.assignVerified()
    expect(setItem).toHaveBeenCalled()
    for (const [key, value] of setItem.mock.calls) {
      expect(key).toBe(PRODUCT.sequenceStorageKey)
      expect(value).toMatch(/^\d+$/)
    }
    expect(storage.length).toBe(1)
  })
})
