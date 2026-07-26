/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// After build, copy dist/index.html -> dist/404.html (SPA fallback). GitHub Pages
// serves only the site-ROOT 404.html for unmatched paths, so this makes production
// deep links resolve; per-PR preview subdirs get a 404.html too but Pages ignores
// subdir 404s, so preview deep links aren't covered (moot until a router is added).
// Build-only and cross-platform (no shell `cp`, so it also works on Windows).
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
  test: {
    // PINNED, not defaulted. Vitest's default include is `**/*.test.*` from the
    // package root, so a review lens dropping a throwaway probe anywhere under
    // `app/` becomes part of `npm test` — and a probe whose expectation is wrong
    // reports as a regression in the code under review. That happened four times
    // in one run, in four different directories, which is why the fix is a glob
    // and not another instruction to tidy up. Every tracked test lives under
    // `test/`, verified with `git ls-files`, so nothing legitimate is excluded.
    include: ["test/**/*.test.{ts,tsx}"],
    // A few tests call the real core (buildBuddyGraph auto-polish can take seconds at n~30-60),
    // so a per-test compute must not silently ride Vitest's 5s default and flake under load.
    // Fixtures that don't exercise polish pass polish:false; this is the backstop for those that do.
    testTimeout: 20000,
  },
})
