import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// After build, copy dist/index.html -> dist/404.html so deep links resolve under
// a GitHub Pages subpath (SPA fallback). Build-only and cross-platform (no shell
// `cp`, so it also works if the build ever runs on Windows).
function spa404Fallback() {
  return {
    name: 'spa-404-fallback',
    apply: 'build' as const,
    closeBundle() {
      const index = resolve(__dirname, 'dist/index.html')
      if (existsSync(index)) {
        copyFileSync(index, resolve(__dirname, 'dist/404.html'))
      }
    },
  }
}

// `base` controls the public path assets are served from. Production is
// `/ringweave/`; per-PR previews override it via VITE_BASE (e.g.
// `/ringweave/pr-preview/pr-12/`). Exposed to app code as import.meta.env.BASE_URL.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/ringweave/',
  plugins: [react(), spa404Fallback()],
})
