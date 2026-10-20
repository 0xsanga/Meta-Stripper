import { PNG_SIGNATURE, calculatePngCrc } from '../lib/png/parser'

export const pngAscii = (value: string): number[] => Array.from(value, (character) => character.charCodeAt(0))

const uint32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]

export const pngChunk = (type: string, data: number[] = []): number[] => {
  const body = new Uint8Array([...pngAscii(type), ...data])
  return [...uint32(data.length), ...body, ...uint32(calculatePngCrc(body))]
}

export const ihdrData = (width = 2, height = 2, colorType = 6, bitDepth = 8): number[] => [
  ...uint32(width),
  ...uint32(height),
  bitDepth,
  colorType,
  0,
  0,
  0,
]

export const makePng = (
  ancillaryChunks: number[][] = [],
  options: { width?: number; height?: number; colorType?: number; bitDepth?: number; transparency?: boolean } = {},
): Uint8Array => new Uint8Array([
  ...PNG_SIGNATURE,
  ...pngChunk('IHDR', ihdrData(options.width, options.height, options.colorType, options.bitDepth)),
  ...(options.colorType === 3 ? pngChunk('PLTE', [255, 0, 0, 0, 0, 255]) : []),
  ...(options.transparency ? pngChunk('tRNS', options.colorType === 3 ? [0, 255] : [0, 0, 0, 0, 0, 0]) : []),
  ...ancillaryChunks.flat(),
  ...pngChunk('IDAT', [0x78, 0x9c, 0x01, 0x00, 0x00, 0xff, 0xff]),
  ...pngChunk('IEND'),
])
