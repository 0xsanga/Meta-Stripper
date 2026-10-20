import type { MetadataKind } from '../jpeg/types'

export type PngMetadataCategory =
  | 'exif'
  | 'text'
  | 'xmp'
  | 'icc'
  | 'timestamp'
  | 'resolution'
  | 'provenance'
  | 'signature'
  | 'other-ancillary'
  | 'animation'

export interface PngMetadataBlock {
  chunkType: string
  category: PngMetadataCategory
  name: string
  approximateBytes: number
  explanation: string
  kind: MetadataKind
  removable: boolean
}

export interface PngInspectionReport {
  isPng: true
  width: number
  height: number
  bitDepth: number
  colorType: number
  hasTransparency: boolean
  isAnimated: boolean
  metadataBlocks: PngMetadataBlock[]
  warnings: Array<{ code: string; message: string }>
}

export interface CleanedPng {
  blob: Blob
  bytes: Uint8Array
  width: number
  height: number
  remainingMetadataBlocks: number
  strategy: PngCleaningStrategy
}

export type PngCleaningStrategy = 'direct-strip' | 'canvas-rebuild' | 'already-clean'

export type PngErrorCode =
  | 'INVALID_SIGNATURE'
  | 'FILE_TOO_LARGE'
  | 'TRUNCATED_CHUNK'
  | 'IMPOSSIBLE_CHUNK_LENGTH'
  | 'INVALID_CHUNK_TYPE'
  | 'INVALID_CRC'
  | 'MISSING_IHDR'
  | 'IHDR_NOT_FIRST'
  | 'INVALID_IHDR'
  | 'MISSING_IDAT'
  | 'MISSING_IEND'
  | 'INVALID_IEND'
  | 'UNKNOWN_CRITICAL_CHUNK'
  | 'ANIMATED_PNG_UNSUPPORTED'
  | 'DECODE_FAILED'
  | 'ENCODE_FAILED'
  | 'VERIFICATION_FAILED'

export class PngError extends Error {
  constructor(
    message: string,
    public readonly code: PngErrorCode,
  ) {
    super(message)
    this.name = 'PngError'
  }
}
