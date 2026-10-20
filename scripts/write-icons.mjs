import { writeFileSync } from 'node:fs'
import { zlibSync } from 'fflate'

const crcTable = new Uint32Array(256)
for (let value = 0; value < 256; value += 1) {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  crcTable[value] = crc
}

const crc32 = (bytes) => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const name = Buffer.from(type)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

const icon = (size) => {
  const rowBytes = size * 4
  const raw = Buffer.alloc((rowBytes + 1) * size)
  const outer = Math.round(size * 0.18)
  const inner = Math.round(size * 0.34)
  for (let y = 0; y < size; y += 1) {
    const offset = y * (rowBytes + 1)
    raw[offset] = 0
    for (let x = 0; x < size; x += 1) {
      const framed = x >= outer && x < size - outer && y >= outer && y < size - outer
      const centre = x >= inner && x < size - inner && y >= inner && y < size - inner
      const paper = framed && !centre
      const pixel = offset + 1 + x * 4
      raw[pixel] = paper ? 0xf4 : 0x1c
      raw[pixel + 1] = paper ? 0xf3 : 0x1b
      raw[pixel + 2] = paper ? 0xef : 0x19
      raw[pixel + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', Buffer.from(zlibSync(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [192, 512]) writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), icon(size))
