export const PRODUCT = {
  name: 'Meta Stripper',
  shortName: 'MS',
  description: 'Private, browser-only image metadata cleaning.',
  sequenceStorageKey: 'meta-stripper.nextSequence',
} as const

export const LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxPixels: 40_000_000,
  maxDimension: 12_000,
  jpegQuality: 0.98,
} as const

export const BATCH_LIMITS = {
  maxQueuedFiles: 20,
  maxCombinedSourceBytes: 200 * 1024 * 1024,
  cleaningConcurrency: 1,
} as const
