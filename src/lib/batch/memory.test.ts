import { describe, expect, it } from 'vitest'
import { BATCH_LIMITS } from '../../config/product'
import { assertDecodedBudget, decodedByteEstimate } from './memory'

describe('decoded image memory budget', () => {
  it('estimates four bytes per pixel', () => {
    expect(decodedByteEstimate(6000, 6000)).toBe(144_000_000)
  })

  it('allows three large images and stops before a fourth is decoded', () => {
    const one = decodedByteEstimate(6000, 6000)
    expect(() => assertDecodedBudget(one * 2, 6000, 6000)).not.toThrow()
    expect(one * 3).toBeLessThanOrEqual(BATCH_LIMITS.maxDecodedBytes)
    expect(() => assertDecodedBudget(one * 3, 6000, 6000)).toThrow(/512\.0 MB safety limit/i)
  })
})
