import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(process.cwd(), 'src')

const sourceFiles = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
  const fullPath = join(directory, entry)
  if (statSync(fullPath).isDirectory()) return sourceFiles(fullPath)
  return /\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [fullPath] : []
})

describe('client privacy boundary', () => {
  it('does not call the network from application source', () => {
    const hits = sourceFiles(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const calls = source.match(/fetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket|new EventSource|navigator\.geolocation/g)
      return calls ? [`${relative(sourceRoot, file)}: ${calls.join(', ')}`] : []
    })
    expect(hits).toEqual([])
  })
})
