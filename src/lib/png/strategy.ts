import type { PngInspectionReport, PngMetadataBlock, PngCleaningStrategy } from './types'
import { PngError } from './types'

const RENDERING_DEPENDENT_ANCILLARY = new Set([
  'bKGD',
  'oFFs',
  'pCAL',
  'sCAL',
  'sTER',
])

const hasSafeToCopyBit = (chunkType: string): boolean => {
  const fourthByte = chunkType.charCodeAt(3)
  return Number.isFinite(fourthByte) && (fourthByte & 0x20) !== 0
}

const requiresVisualNormalisation = (block: PngMetadataBlock): boolean => {
  if (block.category === 'exif' || block.category === 'icc') return true
  if (block.category !== 'other-ancillary') return false
  return RENDERING_DEPENDENT_ANCILLARY.has(block.chunkType) || !hasSafeToCopyBit(block.chunkType)
}

export const selectPngCleaningStrategy = (report: PngInspectionReport): PngCleaningStrategy => {
  if (report.isAnimated) {
    throw new PngError(
      'Animated PNG cleaning is unavailable because rebuilding it would flatten or damage the animation.',
      'ANIMATED_PNG_UNSUPPORTED',
    )
  }
  return report.metadataBlocks.some(requiresVisualNormalisation) ? 'canvas-rebuild' : 'direct-strip'
}
