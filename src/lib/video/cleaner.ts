import { LIMITS } from '../../config/product'
import { assertPlayableStructure, describeMetadata, videoDimensions } from './metadata'
import { looksLikeBmff, parseBmff } from './parser'
import { stripVideoMetadata, verifyCleanedVideo } from './stripper'
import { selectVideoCleaningStrategy } from './strategy'
import { VideoError, type CleanedVideo, type VideoFormat, type VideoInspectionReport } from './types'

const formatOf = (name: string): VideoFormat => /\.mov$/i.test(name) ? 'mov' : 'mp4'

export const inspectVideo = (input: ArrayBuffer | Uint8Array, name = 'video.mp4'): VideoInspectionReport => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength > LIMITS.maxVideoBytes) {
    throw new VideoError(`This video is larger than the ${LIMITS.maxVideoBytes / 1024 / 1024} MB safety limit.`)
  }
  if (!looksLikeBmff(bytes)) throw new VideoError('This file is not a valid MP4 or MOV video.')
  const boxes = parseBmff(bytes)
  assertPlayableStructure(boxes)
  const report: VideoInspectionReport = {
    isVideo: true,
    format: formatOf(name),
    metadataBlocks: describeMetadata(bytes, boxes),
    ...videoDimensions(boxes, bytes),
    synthIdMetadata: false,
    warnings: [],
  }
  report.synthIdMetadata = report.metadataBlocks.some((block) => block.name === 'SynthID metadata')
  return report
}

export const cleanVideo = async (blob: Blob): Promise<CleanedVideo> => {
  const source = new Uint8Array(await blob.arrayBuffer())
  const report = inspectVideo(source, blob instanceof File ? blob.name : 'video.mp4')
  const strategy = selectVideoCleaningStrategy(report)
  const bytes = strategy === 'already-clean' ? source : stripVideoMetadata(source)
  verifyCleanedVideo(bytes)
  if (bytes.byteLength > source.byteLength) throw new VideoError('Direct video cleaning unexpectedly increased the file size.')
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const type = report.format === 'mov' ? 'video/quicktime' : 'video/mp4'
  return {
    blob: new Blob([copy], { type }),
    bytes: copy,
    width: report.width ?? 0,
    height: report.height ?? 0,
    remainingMetadataBlocks: 0,
    strategy,
  }
}
