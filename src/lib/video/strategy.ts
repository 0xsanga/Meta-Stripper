import type { VideoInspectionReport } from './types'

export const selectVideoCleaningStrategy = (report: VideoInspectionReport): 'direct-strip' | 'already-clean' =>
  report.metadataBlocks.length === 0 ? 'already-clean' : 'direct-strip'
