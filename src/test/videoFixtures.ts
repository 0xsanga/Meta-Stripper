const text = (value: string): Uint8Array => Uint8Array.from(value, (character) => character.charCodeAt(0))

export const videoBox = (type: string, payload: Uint8Array = new Uint8Array(), uuid?: Uint8Array): Uint8Array => {
  const header = 8 + (uuid ? 16 : 0)
  const out = new Uint8Array(header + payload.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, out.length)
  out.set(text(type), 4)
  if (uuid) out.set(uuid, 8)
  out.set(payload, header)
  return out
}

export const concatVideo = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export const C2PA_UUID = Uint8Array.of(0x63, 0x32, 0x70, 0x61, 0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71)
export const XMP_UUID = Uint8Array.of(0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac)

const findType = (bytes: Uint8Array, type: string): number => {
  for (let offset = 0; offset + 8 <= bytes.length; offset += 1) {
    if (String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!) === type) return offset
  }
  return -1
}

export interface VideoFixtureOptions {
  moovFirst?: boolean
  encoder?: boolean
  c2pa?: boolean
  xmp?: boolean
  synthId?: boolean
  compressor?: string
  fragmented?: boolean
}

export const makeVideo = (options: VideoFixtureOptions = {}): Uint8Array => {
  const ftyp = videoBox('ftyp', text('isom\0\0\0\0isom'))
  const mvhd = videoBox('mvhd', new Uint8Array(100))
  const stco = videoBox('stco', new Uint8Array(12))
  new DataView(stco.buffer).setUint32(12, 1)
  const sample = options.compressor ? visualSample(options.compressor) : undefined
  const stbl = videoBox('stbl', concatVideo(sample ? videoBox('stsd', sample) : new Uint8Array(), stco))
  const trak = videoBox('trak', videoBox('mdia', videoBox('minf', stbl)))
  const tags: Uint8Array[] = []
  if (options.encoder) tags.push(videoBox('udta', videoBox('\u00a9too', text('Lavf58.76.100'))))
  if (options.c2pa) tags.push(videoBox('uuid', text(options.synthId ? 'c2pa SynthID manifest' : 'jumb c2pa manifest'), C2PA_UUID))
  if (options.xmp) tags.push(videoBox('uuid', text('<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>'), XMP_UUID))
  const moov = videoBox('moov', concatVideo(mvhd, trak, ...tags))
  const mdat = videoBox('mdat', text('FRAME-BYTES'))
  const file = options.moovFirst === false ? concatVideo(ftyp, mdat, moov) : concatVideo(ftyp, moov, mdat)
  if (options.fragmented) return concatVideo(file, videoBox('moof', new Uint8Array(8)))
  const mdatAt = findType(file, 'mdat')
  const stcoAt = findType(file, 'stco')
  new DataView(file.buffer).setUint32(stcoAt + 16, mdatAt + 8)
  return file
}

const visualSample = (name: string): Uint8Array => {
  const entry = new Uint8Array(8 + 86)
  const view = new DataView(entry.buffer)
  view.setUint32(0, 4)
  view.setUint32(4, 1)
  const sample = new Uint8Array(86)
  new DataView(sample.buffer).setUint32(0, 86)
  sample.set(text('avc1'), 4)
  sample[50] = Math.min(name.length, 31)
  for (let index = 0; index < sample[50]; index += 1) sample[51 + index] = name.charCodeAt(index)
  entry.set(sample, 8)
  return entry
}
