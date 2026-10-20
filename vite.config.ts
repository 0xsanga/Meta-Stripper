import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { previewHeaders } from './scripts/security-headers.mjs'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    modulePreload: false,
  },
  preview: {
    headers: previewHeaders,
  },
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    setupFiles: './src/test/setup.ts',
    css: true,
    coverage: { reporter: ['text', 'html'] },
  },
})
