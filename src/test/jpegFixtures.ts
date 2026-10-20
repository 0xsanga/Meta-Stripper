const ascii = (value: string): number[] => Array.from(value, (character) => character.charCodeAt(0))

export const segment = (marker: number, payload: number[] = []): number[] => {
  const length = payload.length + 2
  return [0xff, marker, (length >>> 8) & 0xff, length & 0xff, ...payload]
}

export const exifPayload = (orientation = 6): number[] => [
  ...ascii('Exif\0\0'),
  0x49, 0x49, 0x2a, 0x00,
  0x08, 0x00, 0x00, 0x00,
  0x01, 0x00,
  0x12, 0x01,
  0x03, 0x00,
  0x01, 0x00, 0x00, 0x00,
  orientation, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]

export const makeJpeg = (...metadataSegments: number[][]): Uint8Array =>
  new Uint8Array([
    0xff, 0xd8,
    ...segment(0xe0, [...ascii('JFIF\0'), 1, 2, 0, 0, 1, 0, 1, 0, 0]),
    ...metadataSegments.flat(),
    ...segment(0xdb, [0, 1, 2, 3]),
    ...segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    ...segment(0xc4, [0, 1, 2]),
    ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x11, 0x22, 0xff, 0x00, 0x33,
    0xff, 0xd9,
  ])

export const asciiBytes = ascii
