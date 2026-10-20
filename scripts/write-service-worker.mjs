import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderServiceWorker, selectShellPaths } from './service-worker.mjs'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))

const walk = (directory) => {
  const files = []
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry)
    if (statSync(fullPath).isDirectory()) files.push(...walk(fullPath))
    else files.push(relative(dist, fullPath))
  }
  return files
}

writeFileSync(join(dist, 'sw.js'), renderServiceWorker(selectShellPaths(walk(dist))))
