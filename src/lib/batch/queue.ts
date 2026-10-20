import { BATCH_LIMITS } from '../../config/product'
import type { QueueItem, QueueSummary } from './types'

export class BatchLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BatchLimitError'
  }
}

let fallbackId = 0

export const createQueueId = (): string => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  fallbackId += 1
  return `meta-stripper-${Date.now()}-${fallbackId}`
}

export const assertBatchAdditionAllowed = (existing: QueueItem[], incoming: readonly File[]): void => {
  if (existing.length + incoming.length > BATCH_LIMITS.maxQueuedFiles) {
    throw new BatchLimitError(
      `You can queue up to ${BATCH_LIMITS.maxQueuedFiles} files. Remove some images or choose a smaller selection.`,
    )
  }
  const existingBytes = existing.reduce((sum, item) => sum + item.file.size, 0)
  const incomingBytes = incoming.reduce((sum, file) => sum + file.size, 0)
  if (existingBytes + incomingBytes > BATCH_LIMITS.maxCombinedSourceBytes) {
    throw new BatchLimitError(
      `Queued source files can total up to ${BATCH_LIMITS.maxCombinedSourceBytes / 1024 / 1024} MB. Remove some images or choose smaller files.`,
    )
  }
}

export const createQueueItems = (
  files: readonly File[],
  idFactory: () => string = createQueueId,
): QueueItem[] => files.map((file) => ({ id: idFactory(), file, status: 'inspecting' }))

export const summarizeQueue = (items: readonly QueueItem[]): QueueSummary => ({
  total: items.length,
  ready: items.filter((item) => item.status === 'ready').length,
  verified: items.filter((item) => item.status === 'verified').length,
  failed: items.filter((item) => item.status === 'failed' || item.status === 'unsupported').length,
  removedBlocks: items.reduce((sum, item) => sum + (item.result?.removedBlocks ?? 0), 0),
  originalBytes: items.reduce((sum, item) => sum + item.file.size, 0),
  cleanedBytes: items.reduce((sum, item) => sum + (item.result?.blob.size ?? 0), 0),
})
