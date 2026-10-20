import { PRODUCT } from '../config/product'

export interface SequenceCounter {
  readonly persistent: boolean
  readonly warning?: string
  peek(): number
  assignVerified(extension?: 'jpg' | 'png'): string
  reset(): void
}

const isValidSequence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

const parseStoredSequence = (value: string | null): number => {
  if (value === null || !/^\d+$/.test(value)) return 1
  const parsed = Number(value)
  return isValidSequence(parsed) ? parsed : 1
}

export const createSequenceCounter = (storage?: Storage | null): SequenceCounter => {
  let memoryValue = 1
  let activeStorage: Storage | null = storage ?? null

  if (storage === undefined) {
    try {
      activeStorage = window.localStorage
      const probe = `${PRODUCT.sequenceStorageKey}.probe`
      activeStorage.setItem(probe, '1')
      activeStorage.removeItem(probe)
    } catch {
      activeStorage = null
    }
  }

  if (activeStorage) {
    try {
      const loaded = parseStoredSequence(activeStorage.getItem(PRODUCT.sequenceStorageKey))
      activeStorage.setItem(PRODUCT.sequenceStorageKey, String(loaded))
      memoryValue = loaded
    } catch {
      activeStorage = null
    }
  }

  const read = (): number => {
    if (!activeStorage) return memoryValue
    try {
      const value = parseStoredSequence(activeStorage.getItem(PRODUCT.sequenceStorageKey))
      if (activeStorage.getItem(PRODUCT.sequenceStorageKey) !== String(value)) {
        activeStorage.setItem(PRODUCT.sequenceStorageKey, String(value))
      }
      return value
    } catch {
      activeStorage = null
      return memoryValue
    }
  }

  const write = (value: number): void => {
    memoryValue = value
    if (!activeStorage) return
    try {
      activeStorage.setItem(PRODUCT.sequenceStorageKey, String(value))
    } catch {
      activeStorage = null
    }
  }

  return {
    get persistent() {
      return activeStorage !== null
    },
    get warning() {
      return activeStorage
        ? undefined
        : 'Browser storage is unavailable. File numbering will restart when this app closes.'
    },
    peek: read,
    assignVerified(extension = 'jpg') {
      const current = read()
      if (current === Number.MAX_SAFE_INTEGER) {
        write(1)
        return `${PRODUCT.shortName}${current}.${extension}`
      }
      write(current + 1)
      return `${PRODUCT.shortName}${current}.${extension}`
    },
    reset() {
      write(1)
    },
  }
}
