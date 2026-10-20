import { zipSync, type Zippable } from 'fflate'

export interface VerifiedZipEntry {
  filename: string
  blob: Blob
}

export interface GeneratedZip {
  bytes: Uint8Array
  filename: string
}

export const FIXED_ZIP_DATE = new Date(1980, 0, 1, 0, 0, 0)
const VERIFIED_FILENAME = /^MS(\d+)\.(?:jpg|png)$/

const sequenceFromFilename = (filename: string): number => {
  const match = VERIFIED_FILENAME.exec(filename)
  if (!match?.[1]) throw new Error('ZIP entries must use verified MS JPEG or PNG filenames.')
  const sequence = Number(match[1])
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('A ZIP entry has an invalid MS sequence number.')
  return sequence
}

export const createVerifiedZip = async (entries: readonly VerifiedZipEntry[]): Promise<GeneratedZip> => {
  if (entries.length < 2) throw new Error('At least two verified files are required for a ZIP download.')

  const archive: Zippable = Object.create(null) as Zippable
  const seen = new Set<string>()
  const sequences: number[] = []
  for (const entry of entries) {
    const sequence = sequenceFromFilename(entry.filename)
    if (seen.has(entry.filename)) throw new Error('Verified ZIP filenames must be unique.')
    seen.add(entry.filename)
    sequences.push(sequence)
    archive[entry.filename] = [new Uint8Array(await entry.blob.arrayBuffer()), { level: 0, mtime: FIXED_ZIP_DATE }]
  }

  const lowest = Math.min(...sequences)
  const highest = Math.max(...sequences)
  return {
    bytes: zipSync(archive, { level: 0, mtime: FIXED_ZIP_DATE }),
    filename: `Meta-Stripper-MS${lowest}-to-MS${highest}.zip`,
  }
}
