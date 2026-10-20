import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { PRODUCT } from './config/product'
import { cleanJpeg, readJpegDimensions } from './lib/jpeg/cleaner'
import { cleanPng } from './lib/png/cleaner'
import { makeJpeg, segment, asciiBytes, exifPayload } from './test/jpegFixtures'
import { makePng, pngAscii, pngChunk } from './test/pngFixtures'

vi.mock('./lib/jpeg/cleaner', () => ({
  readJpegDimensions: vi.fn(),
  cleanJpeg: vi.fn(),
}))

vi.mock('./lib/png/cleaner', () => ({ cleanPng: vi.fn() }))

const makeFile = (name = 'holiday.jpg') => {
  const bytes = makeJpeg(segment(0xfe, asciiBytes('private note')))
  const fileBytes = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(fileBytes).set(bytes)
  const file = new File([fileBytes], name, { type: 'image/jpeg' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  return { file, bytes }
}

const makePngFile = (name = 'artwork.png', chunks: number[][] = []) => {
  const bytes = makePng(chunks, { width: 320, height: 240, colorType: 6 })
  const fileBytes = Uint8Array.from(bytes).buffer
  const file = new File([fileBytes], name, { type: 'image/png' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  return { file, bytes }
}

describe('Meta Stripper interface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(readJpegDimensions).mockResolvedValue({ width: 1600, height: 1200 })
    const bytes = makeJpeg()
    vi.mocked(cleanJpeg).mockResolvedValue({
      blob: new Blob([Uint8Array.from(bytes).buffer], { type: 'image/jpeg' }),
      bytes,
      width: 1600,
      height: 1200,
      remainingMetadataBlocks: 0,
      strategy: 'direct-strip',
    })
    const pngBytes = makePng([], { width: 320, height: 240, colorType: 6 })
    vi.mocked(cleanPng).mockResolvedValue({
      blob: new Blob([Uint8Array.from(pngBytes).buffer], { type: 'image/png' }),
      bytes: pngBytes,
      width: 320,
      height: 240,
      remainingMetadataBlocks: 0,
      strategy: 'direct-strip',
    })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:local-result') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  it('exposes the private upload state and accessible file picker', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /leave the image/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Choose a JPEG or PNG image')).toHaveAttribute('accept', '.jpg,.jpeg,.png,image/jpeg,image/png')
    expect(screen.getByText(/nothing is uploaded/i)).toBeInTheDocument()
    expect(document.title).toContain(PRODUCT.name)
  })

  it('moves through inspection, cleaning, verified success, and retains the assigned download name', async () => {
    const user = userEvent.setup()
    render(<App />)
    const { file } = makeFile()
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), file)

    expect(await screen.findByRole('heading', { name: '1 removable block found' })).toBeInTheDocument()
    expect(screen.getByText('JPEG comment')).toBeInTheDocument()
    expect(screen.getByText(/1,600 × 1,200 px/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /deep clean/i }))
    expect(await screen.findByRole('heading', { name: /verified clean/i })).toBeInTheDocument()
    const download = screen.getByRole('link', { name: /download cleaned image MS1.jpg/i })
    expect(download).toHaveAttribute('download', 'MS1.jpg')
    expect(download).toHaveAttribute('download', 'MS1.jpg')
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('2')

    await user.click(screen.getByRole('button', { name: /clean another image/i }))
    expect(screen.getByRole('heading', { name: /drop an image here/i })).toBeInTheDocument()
  })

  it('announces inspecting and cleaning states accessibly', async () => {
    const user = userEvent.setup()
    vi.mocked(readJpegDimensions).mockImplementationOnce(() => new Promise(() => undefined))
    const firstRender = render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), makeFile().file)
    expect(screen.getByRole('heading', { name: /inspecting your image/i })).toBeInTheDocument()
    expect(screen.getByText('Inspecting the image locally.')).toBeInTheDocument()
    firstRender.unmount()

    vi.mocked(readJpegDimensions).mockResolvedValueOnce({ width: 1600, height: 1200 })
    vi.mocked(cleanJpeg).mockImplementationOnce(() => new Promise(() => undefined))
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), makeFile().file)
    await user.click(await screen.findByRole('button', { name: /deep clean/i }))
    expect(screen.getByRole('heading', { name: /removing metadata/i })).toBeInTheDocument()
    expect(screen.getByText('Removing metadata and verifying the image locally.')).toBeInTheDocument()
  })

  it('shows a controlled error without consuming a number', async () => {
    const user = userEvent.setup()
    render(<App />)
    const { file } = makeFile('renamed.png')
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), file)
    expect(await screen.findByRole('alert')).toHaveTextContent(/extension does not match/i)
    expect(screen.getByText(/no file number was used/i)).toBeInTheDocument()
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('1')
  })

  it('requires confirmation before resetting the shared counter', async () => {
    localStorage.setItem(PRODUCT.sequenceStorageKey, '8')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByText('Numbering settings'))
    expect(screen.getByText(/MS8/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /reset file counter/i }))
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('8')
    await user.click(screen.getByRole('button', { name: /reset file counter/i }))
    await waitFor(() => expect(screen.getByText(/MS1/)).toBeInTheDocument())
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('1')
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm.mock.calls[0]?.[0]).toMatch(/previously downloaded files will not be changed/i)
  })

  it('inspects and cleans a transparent PNG with a dynamic PNG download', async () => {
    const user = userEvent.setup()
    render(<App />)
    const { file } = makePngFile('artwork.png', [pngChunk('tEXt', pngAscii('Author\0Ada'))])
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), file)

    expect(await screen.findByRole('heading', { name: /1 removable block found/i })).toBeInTheDocument()
    expect(screen.getByText(/PNG ·/)).toBeInTheDocument()
    expect(screen.getByText(/PNG transparency is preserved/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /deep clean/i }))

    const download = await screen.findByRole('link', { name: /download cleaned image MS1.png/i })
    expect(download).toHaveTextContent('Download PNG')
    expect(download).toHaveAttribute('download', 'MS1.png')
    expect(screen.getByText('Metadata removed without recompressing the image pixels.')).toBeInTheDocument()
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('2')
    expect(download).toHaveAttribute('download', 'MS1.png')
  })

  it('shares one sequence across JPEG and PNG results', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), makeFile().file)
    await user.click(await screen.findByRole('button', { name: /deep clean/i }))
    expect(await screen.findByText('MS1.jpg')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clean another image/i }))
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), makePngFile('artwork.png', [pngChunk('tEXt', pngAscii('Author\0Ada'))]).file)
    await user.click(await screen.findByRole('button', { name: /deep clean/i }))
    expect(await screen.findByText('MS2.png')).toBeInTheDocument()
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('3')
  })

  it('identifies animated PNG files and refuses cleaning without using a number', async () => {
    const user = userEvent.setup()
    render(<App />)
    const animation = pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0])
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), makePngFile('animated.png', [animation]).file)
    expect(await screen.findByText(/This PNG is animated/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deep clean/i })).toBeDisabled()
    expect(screen.getByText(/flatten or damage the animation/i)).toBeInTheDocument()
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('1')
    expect(vi.mocked(cleanPng)).not.toHaveBeenCalled()
  })

  it('does not consume a number when direct PNG stripping fails', async () => {
    vi.mocked(cleanPng).mockRejectedValueOnce(new Error('Direct strip verification failed safely.'))
    const user = userEvent.setup()
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), makePngFile('noted.png', [pngChunk('tEXt', pngAscii('Author\0Ada'))]).file)
    await user.click(await screen.findByRole('button', { name: /deep clean/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/direct strip verification failed safely/i)
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('1')
  })

  it('does not consume a number when PNG canvas fallback fails', async () => {
    vi.mocked(cleanPng).mockRejectedValueOnce(new Error('Canvas fallback failed safely.'))
    const user = userEvent.setup()
    render(<App />)
    const exif = pngChunk('eXIf', [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), makePngFile('oriented.png', [exif]).file)
    await user.click(await screen.findByRole('button', { name: /deep clean/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/canvas fallback failed safely/i)
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('1')
  })

  it('explains the PNG canvas fallback after verified success', async () => {
    const pngBytes = makePng([], { width: 320, height: 240, colorType: 6 })
    vi.mocked(cleanPng).mockResolvedValueOnce({
      blob: new Blob([Uint8Array.from(pngBytes).buffer], { type: 'image/png' }),
      bytes: pngBytes,
      width: 320,
      height: 240,
      remainingMetadataBlocks: 0,
      strategy: 'canvas-rebuild',
    })
    const user = userEvent.setup()
    render(<App />)
    const profile = pngChunk('iCCP', pngAscii('profile\0\0data'))
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), makePngFile('profiled.png', [profile]).file)
    await user.click(await screen.findByRole('button', { name: /deep clean/i }))
    expect(await screen.findByText(/pixels were rebuilt to safely normalise orientation or colour interpretation/i)).toBeInTheDocument()
  })

  it('shows a direct JPEG strip when orientation and colour do not need a rebuild', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), makeFile().file)
    expect(await screen.findByText(/direct metadata strip/i)).toBeInTheDocument()
  })

  it('plans a canvas rebuild when JPEG orientation must be applied', async () => {
    const user = userEvent.setup()
    render(<App />)
    const bytes = makeJpeg(segment(0xe1, exifPayload(6)))
    const file = new File([Uint8Array.from(bytes)], 'turned.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), file)
    expect(await screen.findByText(/canvas rebuild/i)).toBeInTheDocument()
  })

  it('downloads an already-clean JPEG without rebuilding or numbering it during inspection', async () => {
    const user = userEvent.setup()
    const bytes = makeJpeg()
    const file = new File([Uint8Array.from(bytes)], 'plain.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), file)

    expect(await screen.findByRole('heading', { name: 'No removable metadata' })).toBeInTheDocument()
    expect(screen.getByText(/No file number was used/i)).toBeInTheDocument()
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('1')
    expect(vi.mocked(cleanJpeg)).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /download plain.jpg without rebuilding/i }))
    expect(await screen.findByRole('link', { name: /download cleaned image MS1.jpg/i })).toHaveAttribute('download', 'MS1.jpg')
    expect(screen.getByText(/original image bytes were kept/i)).toBeInTheDocument()
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('2')
    expect(vi.mocked(cleanJpeg)).not.toHaveBeenCalled()
  })
})
