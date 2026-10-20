import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'

const raster = async (page: Page, kind: 'jpeg' | 'png', tone: string) => {
  const base64 = await page.evaluate(async ({ kind, tone }) => {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 12
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable.')
    context.fillStyle = tone
    context.fillRect(0, 0, 16, 12)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, kind === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92))
    if (!blob) throw new Error('The browser did not encode the image.')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, { kind, tone })
  return Buffer.from(base64, 'base64')
}

const chooseImages = async (page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) => {
  await page.getByLabel('Choose a JPEG or PNG image').setInputFiles(files)
}

test('cleans a batch, downloads a result and a ZIP, and reopens offline', async ({ page, context }) => {
  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toContain("default-src 'none'")
  expect(response?.headers()['content-security-policy']).not.toContain('unsafe-inline')
  await expect(page.getByRole('heading', { name: /Leave the image/ })).toBeVisible()

  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  const first = await raster(page, 'jpeg', '#24362b')
  const second = await raster(page, 'jpeg', '#6e4e24')
  await chooseImages(page, [
    { name: 'field-note.jpg', mimeType: 'image/jpeg', buffer: first },
    { name: 'second-note.jpg', mimeType: 'image/jpeg', buffer: second },
  ])
  const statuses = page.locator('.status-pill')
  await expect(statuses).toHaveCount(2)
  await expect(statuses.filter({ hasText: 'Inspecting' })).toHaveCount(0)
  await expect(statuses.filter({ hasText: 'Failed' })).toHaveCount(0)
  const cleanAll = page.getByRole('button', { name: /Clean all ready \([1-9]/ })
  if (await cleanAll.count()) {
    await cleanAll.click()
    await expect(page.locator('.status-pill', { hasText: 'Cleaning' })).toHaveCount(0)
  }
  for (const save of await page.getByRole('button', { name: /without rebuilding/ }).all()) {
    const saved = page.waitForEvent('download')
    await save.click()
    await saved
  }
  await expect(page.getByRole('link', { name: 'Download cleaned image MS1.jpg' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download cleaned image MS2.jpg' })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download cleaned image MS1.jpg' }).click()
  expect((await download).suggestedFilename()).toBe('MS1.jpg')

  const archiveEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download all as ZIP (2)' }).click()
  const archive = await archiveEvent
  expect(archive.suggestedFilename()).toMatch(/^Meta-Stripper-MS\d+-to-MS\d+\.zip$/)
  const entries = unzipSync(new Uint8Array(await readFile(await archive.path())))
  expect(Object.keys(entries).sort()).toEqual(['MS1.jpg', 'MS2.jpg'])

  const cachedPaths = await page.evaluate(async () => {
    const names = await caches.keys()
    const requests = (await Promise.all(names.map(async (name) => (await caches.open(name)).keys()))).flat()
    return requests.map((request) => new URL(request.url).pathname)
  })
  expect(cachedPaths.join(' ')).not.toMatch(/field-note|second-note|MS1|MS2/)
  expect(cachedPaths).toContain('/')

  await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: /Leave the image/ })).toBeVisible()
  const offlineFile = await raster(page, 'jpeg', '#1c1b19')
  await chooseImages(page, [{ name: 'offline-note.jpg', mimeType: 'image/jpeg', buffer: offlineFile }])
  await expect(page.getByRole('button', { name: /Deep Clean offline-note.jpg/ })).toBeEnabled()
  await page.getByRole('button', { name: /Deep Clean offline-note.jpg/ }).click()
  await expect(page.getByRole('link', { name: /Download cleaned image MS\d+\.jpg/ })).toBeVisible()
})

test('reaches cleaning from the keyboard', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Numbering settings').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Next successful file: MS1/)).toBeVisible()

  const file = await raster(page, 'png', '#345048')
  await chooseImages(page, [{ name: 'key.png', mimeType: 'image/png', buffer: file }])
  const clean = page.getByRole('button', { name: /Deep Clean key.png|Download key.png without rebuilding/ })
  await expect(clean).toBeVisible()
  await clean.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: /Download cleaned image MS1\.png/ })).toBeVisible()
})
