import { BATCH_LIMITS } from '../../config/product'
import { formatBytes } from '../format'

export const decodedByteEstimate = (width: number, height: number): number => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return Number.POSITIVE_INFINITY
  }
  const pixels = width * height
  if (!Number.isSafeInteger(pixels)) return Number.POSITIVE_INFINITY
  const bytes = pixels * 4
  return Number.isSafeInteger(bytes) ? bytes : Number.POSITIVE_INFINITY
}

export const reservedDecodedBytes = (
  items: readonly { id?: string; width?: number; height?: number }[],
  excludingId?: string,
): number => items.reduce((sum, item) => {
  if (excludingId && item.id === excludingId) return sum
  if (!item.width || !item.height) return sum
  return sum + decodedByteEstimate(item.width, item.height)
}, 0)

export const assertDecodedBudget = (reservedBytes: number, width: number, height: number): void => {
  const incoming = decodedByteEstimate(width, height)
  const total = reservedBytes + incoming
  if (!Number.isFinite(total) || total > BATCH_LIMITS.maxDecodedBytes) {
    throw new Error(
      `Decoded image memory would pass the ${formatBytes(BATCH_LIMITS.maxDecodedBytes)} safety limit. Remove an image or choose a smaller one.`,
    )
  }
}
