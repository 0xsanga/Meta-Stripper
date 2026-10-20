import { createHash } from 'node:crypto'

const SHELL_FILE = /^\/(?:index\.html|manifest\.webmanifest|icon-\d+\.png|assets\/[A-Za-z0-9._-]+\.(?:js|css))$/

export const selectShellPaths = (relativePaths) => {
  const urls = []
  for (const relativePath of relativePaths) {
    const normalised = relativePath.replaceAll('\\', '/')
    if (normalised === 'sw.js' || normalised.endsWith('.map')) continue
    const url = `/${normalised}`
    if (!SHELL_FILE.test(url)) continue
    urls.push(url)
  }
  if (!urls.includes('/index.html')) throw new Error('The build is missing index.html.')
  if (!urls.some((url) => url.endsWith('.js'))) throw new Error('The build is missing its JavaScript.')
  if (!urls.some((url) => url.endsWith('.css'))) throw new Error('The build is missing its CSS.')
  return ['/', ...urls.filter((url) => url !== '/').sort()]
}

export const renderServiceWorker = (shellPaths) => {
  if (!shellPaths.includes('/') || !shellPaths.includes('/index.html')) {
    throw new Error('The app shell must include the document.')
  }
  const id = createHash('sha256').update(shellPaths.join('\n')).digest('hex').slice(0, 12)
  return `/* Generated app shell. Only these URLs may enter Cache Storage. */
const CACHE = 'meta-stripper-shell-${id}'
const SHELL = ${JSON.stringify(shellPaths)}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true, ignoreVary: true })
      || await caches.match(url.pathname === '/' ? '/index.html' : url.pathname, { ignoreSearch: true, ignoreVary: true })
    return cached || fetch(event.request)
  })())
})
`
}
