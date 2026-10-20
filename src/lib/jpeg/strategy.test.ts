import { describe, expect, it } from 'vitest'
import { inspectJpeg } from './parser'
import { selectJpegCleaningStrategy } from './strategy'
import { asciiBytes, exifPayload, makeJpeg, segment } from '../../test/jpegFixtures'

const strategyFor = (...segments: number[][]) => selectJpegCleaningStrategy(inspectJpeg(makeJpeg(...segments)))

describe('JPEG cleaning strategy', () => {
  it('keeps a JPEG with no removable metadata on the already-clean path', () => {
    expect(strategyFor()).toBe('already-clean')
  })

  it('strips comments directly when orientation and colour do not need a rebuild', () => {
    expect(strategyFor(segment(0xfe, asciiBytes('private note')))).toBe('direct-strip')
  })

  it('strips upright EXIF directly', () => {
    expect(strategyFor(segment(0xe1, exifPayload(1)))).toBe('direct-strip')
  })

  it('rebuilds when EXIF orientation must be applied', () => {
    expect(strategyFor(segment(0xe1, exifPayload(6)), segment(0xfe, asciiBytes('note')))).toBe('canvas-rebuild')
  })

  it('rebuilds when an ICC profile is present', () => {
    expect(strategyFor(segment(0xe2, asciiBytes('ICC_PROFILE\0')), segment(0xfe, asciiBytes('note')))).toBe('canvas-rebuild')
  })
})
