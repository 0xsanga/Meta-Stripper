import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { BATCH_LIMITS, PRODUCT } from './config/product'
import { cleanJpeg, readJpegDimensions } from './lib/jpeg/cleaner'
import { cleanPng } from './lib/png/cleaner'
import { asciiBytes, makeJpeg, segment } from './test/jpegFixtures'
import { makePng, pngAscii, pngChunk } from './test/pngFixtures'

vi.mock('./lib/jpeg/cleaner', () => ({ readJpegDimensions: vi.fn(), cleanJpeg: vi.fn() }))
vi.mock('./lib/png/cleaner', () => ({ cleanPng: vi.fn() }))

const browserBlob = (bytes: Uint8Array, type: string): Blob => ({
  size: bytes.byteLength,
  type,
  arrayBuffer: async () => bytes.slice().buffer,
} as Blob)

const jpegFile = (name: string): File => {
  const bytes = makeJpeg(segment(0xfe, asciiBytes(`note for ${name}`)))
  const file = new File([Uint8Array.from(bytes)], name, { type: 'image/jpeg' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.slice().buffer })
  return file
}

const pngFile = (name: string, extraChunks: number[][] = []): File => {
  const bytes = makePng([...extraChunks, pngChunk('tEXt', pngAscii(`Author\0${name}`))], { width: 40, height: 30, colorType: 6 })
  const file = new File([Uint8Array.from(bytes)], name, { type: 'image/png' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.slice().buffer })
  return file
}

const cleanedJpeg = () => {
  const bytes = makeJpeg()
  return { blob: browserBlob(Uint8Array.from(bytes), 'image/jpeg'), bytes, width: 40, height: 30, remainingMetadataBlocks: 0, strategy: 'direct-strip' as const }
}

const cleanedPng = () => {
  const bytes = makePng([], { width: 40, height: 30, colorType: 6 })
  return { blob: browserBlob(Uint8Array.from(bytes), 'image/png'), bytes, width: 40, height: 30, remainingMetadataBlocks: 0, strategy: 'direct-strip' as const }
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Meta Stripper batch workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(readJpegDimensions).mockResolvedValue({ width: 40, height: 30 })
    vi.mocked(cleanJpeg).mockResolvedValue(cleanedJpeg())
    vi.mocked(cleanPng).mockResolvedValue(cleanedPng())
    let url = 0
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:local-${++url}`) })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  it('keeps mixed selections, duplicate names, and original order as distinct queue items', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), [
      jpegFile('same.jpg'), pngFile('art.png'), jpegFile('same.jpg'),
    ])

    await screen.findByRole('heading', { name: '3 images' })
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(3)
    expect(cards.map((card) => card.querySelector('.queue-filename')?.textContent)).toEqual(['same.jpg', 'art.png', 'same.jpg'])
    expect(screen.getAllByRole('button', { name: 'Deep Clean same.jpg' })).toHaveLength(2)
    expect(screen.getByText(/JPEG \+ PNG/)).toBeInTheDocument()
  })

  it('isolates an invalid file and rejects an over-limit addition without discarding the queue', async () => {
    const user = userEvent.setup()
    render(<App />)
    const corrupt = new File([new Uint8Array([1, 2, 3])], 'broken.jpg', { type: 'image/jpeg' })
    Object.defineProperty(corrupt, 'arrayBuffer', { value: async () => Uint8Array.from([1, 2, 3]).buffer })
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), [jpegFile('good.jpg'), corrupt])

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid JPEG or PNG/i)
    expect(screen.getByRole('button', { name: 'Deep Clean good.jpg' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Retry inspection for broken.jpg/ })).toBeEnabled()

    const extras = Array.from({ length: BATCH_LIMITS.maxQueuedFiles - 1 }, (_, index) => jpegFile(`extra-${index}.jpg`))
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), extras)
    await waitFor(() => expect(screen.getAllByText(/queue up to 20 files/i)).toHaveLength(2))
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  it('keeps APNG unsupported inside a batch and assigns it no number', async () => {
    const user = userEvent.setup()
    const animation = pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0])
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), [
      jpegFile('still.jpg'), pngFile('animated.png', [animation]),
    ])

    expect(await screen.findByText(/This PNG is animated/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deep Clean animated.png' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Clean all ready (1)' }))
    expect(await screen.findByText('MS1.jpg')).toBeInTheDocument()
    expect(vi.mocked(cleanPng)).not.toHaveBeenCalled()
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('2')
  })

  it('cleans sequentially, continues after a per-file failure, and assigns numbers only to verified results', async () => {
    const user = userEvent.setup()
    let active = 0
    let maximumActive = 0
    const order: string[] = []
    vi.mocked(cleanJpeg).mockImplementation(async (file) => {
      active += 1; maximumActive = Math.max(maximumActive, active); order.push((file as File).name)
      await new Promise((resolve) => window.setTimeout(resolve, 5)); active -= 1
      return cleanedJpeg()
    })
    vi.mocked(cleanPng).mockImplementation(async (file) => {
      active += 1; maximumActive = Math.max(maximumActive, active); order.push((file as File).name)
      await new Promise((resolve) => window.setTimeout(resolve, 5)); active -= 1
      throw new Error('PNG verification failed safely.')
    })
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), [jpegFile('one.jpg'), pngFile('bad.png'), jpegFile('three.jpg')])
    await user.click(await screen.findByRole('button', { name: 'Clean all ready (3)' }))

    expect(await screen.findByText('MS2.jpg')).toBeInTheDocument()
    expect(order).toEqual(['one.jpg', 'bad.png', 'three.jpg'])
    expect(maximumActive).toBe(1)
    expect(screen.getByRole('link', { name: /MS1.jpg/ })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/PNG verification failed safely/i)
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('3')
    const summary = screen.getByLabelText('Queue summary')
    expect(within(summary).getByText('Verified').nextElementSibling).toHaveTextContent('2')
    expect(within(summary).getByText('Failed').nextElementSibling).toHaveTextContent('1')
  })

  it('stops a batch only after the current image finishes', async () => {
    const first = deferred<ReturnType<typeof cleanedJpeg>>()
    vi.mocked(cleanJpeg).mockImplementationOnce(() => first.promise)
    const user = userEvent.setup()
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), [jpegFile('one.jpg'), jpegFile('two.jpg')])
    await user.click(await screen.findByRole('button', { name: 'Clean all ready (2)' }))
    expect(screen.getByText('Cleaning 1 of 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop after current' }))
    expect(screen.getByRole('button', { name: /Stopping after current/ })).toBeDisabled()

    await act(async () => { first.resolve(cleanedJpeg()); await first.promise })
    expect(await screen.findByRole('button', { name: 'Deep Clean two.jpg' })).toBeEnabled()
    expect(vi.mocked(cleanJpeg)).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Batch stopped after 1 of 2/)).toBeInTheDocument()
  })

  it('prevents a duplicate clean action and supports an explicit cleaning retry', async () => {
    const first = deferred<ReturnType<typeof cleanedJpeg>>()
    vi.mocked(cleanJpeg).mockImplementationOnce(() => first.promise).mockRejectedValueOnce(new Error('Second item failed.')).mockResolvedValueOnce(cleanedJpeg())
    const user = userEvent.setup()
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), [jpegFile('one.jpg'), jpegFile('two.jpg')])
    const firstButton = await screen.findByRole('button', { name: 'Deep Clean one.jpg' })
    fireEvent.click(firstButton); fireEvent.click(firstButton)
    expect(vi.mocked(cleanJpeg)).toHaveBeenCalledTimes(1)
    await act(async () => { first.resolve(cleanedJpeg()); await first.promise })
    expect(await screen.findByText('MS1.jpg')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Deep Clean two.jpg' }))
    const retry = await screen.findByRole('button', { name: 'Retry cleaning for two.jpg' })
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('2')
    await user.click(retry)
    expect(await screen.findByText('MS2.jpg')).toBeInTheDocument()
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('3')
  })

  it('revokes removed and cleared previews, moves focus, and never reuses an assigned number', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), [jpegFile('one.jpg'), jpegFile('two.jpg')])
    const cleanButtons = await screen.findAllByRole('button', { name: /Deep Clean/ })
    await user.click(cleanButtons[0]!)
    await screen.findByText('MS1.jpg')
    await user.click(screen.getByRole('button', { name: 'Remove one.jpg from queue' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove two.jpg from queue' })).toHaveFocus())
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), jpegFile('three.jpg'))
    await user.click(await screen.findByRole('button', { name: 'Deep Clean three.jpg' }))
    expect(await screen.findByText('MS2.jpg')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.getByRole('heading', { name: /Drop an image here/ })).toBeInTheDocument()
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('3')
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([
      'blob:local-1', 'blob:local-2', 'blob:local-3', 'blob:local-4', 'blob:local-5',
    ]))
  })

  it('revokes every remaining object URL when the interface unmounts', async () => {
    const user = userEvent.setup()
    const view = render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), [jpegFile('one.jpg'), pngFile('two.png')])
    await screen.findByRole('button', { name: 'Clean all ready (2)' })
    view.unmount()

    expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([
      'blob:local-1', 'blob:local-2',
    ]))
  })

  it('does not number an already-clean image while cleaning the rest of the queue', async () => {
    const user = userEvent.setup()
    const plainBytes = makeJpeg()
    const plain = new File([Uint8Array.from(plainBytes)], 'plain.jpg', { type: 'image/jpeg' })
    Object.defineProperty(plain, 'arrayBuffer', { value: async () => plainBytes.slice().buffer })
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), [plain, jpegFile('note.jpg')])

    expect(await screen.findByRole('heading', { name: 'No removable metadata' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Clean all ready (1)' }))
    expect(await screen.findByText('MS1.jpg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download plain.jpg without rebuilding' })).toBeEnabled()
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('2')
    expect(vi.mocked(cleanJpeg)).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Download plain.jpg without rebuilding' }))
    expect(await screen.findByText('MS2.jpg')).toBeInTheDocument()
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('3')
    expect(vi.mocked(cleanJpeg)).toHaveBeenCalledTimes(1)
  })

  it('downloads a deterministic local ZIP without consuming another sequence number', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    render(<App />)
    await user.upload(screen.getByLabelText('Choose a JPEG or PNG image'), [jpegFile('one.jpg'), pngFile('two.png')])
    await user.click(await screen.findByRole('button', { name: 'Clean all ready (2)' }))
    const zipButton = await screen.findByRole('button', { name: 'Download all as ZIP (2)' })
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('3')
    await user.click(zipButton)

    expect(await screen.findByText(/Meta-Stripper-MS1-to-MS2.zip is ready/)).toBeInTheDocument()
    expect(click).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(PRODUCT.sequenceStorageKey)).toBe('3')
  })
})
