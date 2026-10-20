import { LIMITS } from '../config/product'
import { inspectJpeg } from './jpeg/parser'
import { PNG_SIGNATURE, inspectPng } from './png/parser'

const jpegExtension = /\.jpe?g$/i
const pngExtension = /\.png$/i

export type SupportedImageFormat = 'jpeg' | 'png'

export interface ValidatedImageFile {
  format: SupportedImageFormat
  buffer: ArrayBuffer
}

const isPngSignature = (bytes: Uint8Array): boolean =>
  bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value)

const isJpegSignature = (bytes: Uint8Array): boolean =>
  bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8

export const validateImageFile = async (file: File): Promise<ValidatedImageFile> => {
  if (!jpegExtension.test(file.name) && !pngExtension.test(file.name)) {
    throw new Error('Choose a file ending in .jpg, .jpeg, or .png.')
  }
  if (file.size === 0) throw new Error('This file is empty.')
  if (file.size > LIMITS.maxFileBytes) {
    throw new Error(`This file is larger than the ${LIMITS.maxFileBytes / 1024 / 1024} MB safety limit.`)
  }

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let format: SupportedImageFormat
  if (isPngSignature(bytes)) format = 'png'
  else if (isJpegSignature(bytes)) format = 'jpeg'
  else throw new Error('This file is not a valid JPEG or PNG image.')

  const extensionMatches = format === 'png' ? pngExtension.test(file.name) : jpegExtension.test(file.name)
  if (!extensionMatches) {
    throw new Error(`The filename extension does not match the file's ${format === 'png' ? 'PNG' : 'JPEG'} format.`)
  }
  if (
    file.type &&
    (file.type === 'image/png' || file.type === 'image/jpeg') &&
    file.type !== `image/${format}`
  ) {
    throw new Error(`The file's declared type does not match its ${format === 'png' ? 'PNG' : 'JPEG'} contents.`)
  }

  if (format === 'png') inspectPng(buffer)
  else inspectJpeg(buffer)
  return { format, buffer }
}

export const validateJpegFile = async (file: File): Promise<ArrayBuffer> => {
  if (!jpegExtension.test(file.name)) throw new Error('Choose a file ending in .jpg or .jpeg.')
  if (file.size === 0) throw new Error('This file is empty.')
  if (file.size > LIMITS.maxFileBytes) {
    throw new Error(`This file is larger than the ${LIMITS.maxFileBytes / 1024 / 1024} MB safety limit.`)
  }
  const buffer = await file.arrayBuffer()
  inspectJpeg(buffer)
  return buffer
}

export const validatePngFile = async (file: File): Promise<ArrayBuffer> => {
  const validated = await validateImageFile(file)
  if (validated.format !== 'png') throw new Error('Choose a PNG file ending in .png.')
  return validated.buffer
}
