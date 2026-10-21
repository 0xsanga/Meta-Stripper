export type VideoFormat = 'mp4' | 'mov'

export type VideoMetadataKind = 'privacy' | 'provenance' | 'technical'

export interface VideoMetadataBlock {
  name: string
  box: string
  approximateBytes: number
  explanation: string
  kind: VideoMetadataKind
}

export interface VideoInspectionReport {
  isVideo: true
  format: VideoFormat
  metadataBlocks: VideoMetadataBlock[]
  width?: number
  height?: number
  synthIdMetadata: boolean
  warnings: { code: string; message: string }[]
}

export interface CleanedVideo {
  blob: Blob
  bytes: Uint8Array
  width: number
  height: number
  remainingMetadataBlocks: number
  strategy: 'direct-strip' | 'already-clean'
}

export class VideoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VideoError'
  }
}
