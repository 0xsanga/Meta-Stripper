import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { previewHeaders, productionHeaders } from '../scripts/security-headers.mjs'

describe('security headers', () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[]
  }
  const published = Object.fromEntries(vercel.headers[0]?.headers.map((header) => [header.key, header.value]) ?? [])

  it('publishes the production policy without a script exception', () => {
    expect(published).toEqual(productionHeaders)
    expect(published['Content-Security-Policy']).toContain("default-src 'none'")
    expect(published['Content-Security-Policy']).toContain("script-src 'self'")
    expect(published['Content-Security-Policy']).not.toMatch(/unsafe-inline|unsafe-eval|https?:/)
  })

  it('keeps local preview on http and allows image previews', () => {
    expect(previewHeaders['Content-Security-Policy']).toContain("img-src 'self' blob:")
    expect(previewHeaders['Content-Security-Policy']).not.toContain('upgrade-insecure-requests')
    expect(previewHeaders).not.toHaveProperty('Strict-Transport-Security')
  })

  it('does not cache the service worker with the hashed assets', () => {
    const worker = vercel.headers.find((rule) => rule.source === '/sw.js')
    const assets = vercel.headers.find((rule) => rule.source === '/assets/(.*)')
    expect(worker?.headers).toEqual([{ key: 'Cache-Control', value: 'no-cache' }])
    expect(assets?.headers[0]?.value).toContain('immutable')
  })
})
