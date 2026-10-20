import { describe, expect, it } from 'vitest'
import { renderServiceWorker, selectShellPaths } from '../../../scripts/service-worker.mjs'

describe('app shell selection', () => {
  const built = [
    'index.html',
    'manifest.webmanifest',
    'icon-192.png',
    'icon-512.png',
    'assets/index-Ab12.js',
    'assets/index-Ab12.css',
    'sw.js',
    'assets/index-Ab12.js.map',
  ]

  it('keeps only the built document, script, style, manifest, and icons', () => {
    expect(selectShellPaths(built)).toEqual([
      '/',
      '/assets/index-Ab12.css',
      '/assets/index-Ab12.js',
      '/icon-192.png',
      '/icon-512.png',
      '/index.html',
      '/manifest.webmanifest',
    ])
  })

  it('drops source names and image uploads', () => {
    const shell = selectShellPaths([...built, 'field-note.jpg', 'report.json', 'assets/photo.png'])
    expect(shell.join(' ')).not.toMatch(/field-note|report|photo/)
  })

  it('renders a worker that precaches that list and never writes other responses', () => {
    const source = renderServiceWorker(selectShellPaths(built))
    expect(source).toContain('cache.addAll(SHELL)')
    expect(source).toContain('ignoreVary: true')
    expect(source).not.toContain('cache.put')
    expect(source).toContain('"/icon-192.png"')
    expect(source).not.toContain('field-note')
  })
})
