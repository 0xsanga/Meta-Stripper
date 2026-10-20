export type MetadataKind = 'privacy' | 'provenance' | 'technical'

export type MetadataCategory =
  | 'exif'
  | 'xmp'
  | 'icc'
  | 'provenance'
  | 'photoshop'
  | 'comment'
  | 'other-app'

export interface MetadataBlock {
  category: MetadataCategory
  name: string
  marker: string
  approximateBytes: number
  explanation: string
  kind: MetadataKind
}

export interface InspectionWarning {
  code: string
  message: string
}

export interface JpegInspectionReport {
  isJpeg: true
  metadataBlocks: MetadataBlock[]
  exifOrientation?: number
  provenanceDetected: boolean
  warnings: InspectionWarning[]
}

export interface CleanedJpeg {
  blob: Blob
  bytes: Uint8Array
  width: number
  height: number
  remainingMetadataBlocks: number
  strategy: 'direct-strip' | 'canvas-rebuild' | 'already-clean'
}

export type JpegErrorCode =
  | 'INVALID_SIGNATURE'
  | 'TRUNCATED_MARKER'
  | 'INVALID_SEGMENT_LENGTH'
  | 'SEGMENT_OUT_OF_BOUNDS'
  | 'MISSING_SCAN_DATA'
  | 'DECODE_FAILED'
  | 'ENCODE_FAILED'
  | 'VERIFICATION_FAILED'

export class JpegError extends Error {
  constructor(
    message: string,
    public readonly code: JpegErrorCode,
  ) {
    super(message)
    this.name = 'JpegError'
  }
}
