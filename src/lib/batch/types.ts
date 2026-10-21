import type { SupportedImageFormat } from '../fileValidation'
import type { JpegInspectionReport } from '../jpeg/types'
import type { PngCleaningStrategy, PngInspectionReport } from '../png/types'
import type { VideoInspectionReport } from '../video/types'

export type QueueItemStatus =
  | 'inspecting'
  | 'ready'
  | 'already-clean'
  | 'cleaning'
  | 'verified'
  | 'unsupported'
  | 'failed'

export interface QueueCleanResult {
  blob: Blob
  bytes: Uint8Array
  filename: string
  downloadUrl: string
  strategy: PngCleaningStrategy
  removedBlocks: number
}

export interface QueueItem {
  id: string
  file: File
  status: QueueItemStatus
  format?: SupportedImageFormat
  report?: JpegInspectionReport | PngInspectionReport | VideoInspectionReport
  width?: number
  height?: number
  previewUrl?: string
  knownStrategy?: PngCleaningStrategy
  error?: string
  failureStage?: 'inspection' | 'cleaning'
  result?: QueueCleanResult
}

export interface QueueSummary {
  total: number
  ready: number
  verified: number
  failed: number
  removedBlocks: number
  originalBytes: number
  cleanedBytes: number
}
