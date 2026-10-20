import type { JpegInspectionReport } from './types'
import type { PngCleaningStrategy } from '../png/types'

const needsCanvasRebuild = (report: JpegInspectionReport): boolean => {
  const orientationNeedsRebuild = report.exifOrientation !== undefined && report.exifOrientation !== 1
  const colourNeedsRebuild = report.metadataBlocks.some((block) => block.category === 'icc')
  return orientationNeedsRebuild || colourNeedsRebuild
}

export const selectJpegCleaningStrategy = (report: JpegInspectionReport): PngCleaningStrategy => {
  if (needsCanvasRebuild(report)) return 'canvas-rebuild'
  return report.metadataBlocks.length === 0 ? 'already-clean' : 'direct-strip'
}
