import { defineConfig } from "vitest/config";

/**
 * The core's suite runs real generation, so a few cases are genuinely slow: at n=40, k=4 a
 * polished `buildBuddyGraph` takes ~3 s on a 4-core 2.8 GHz container, and the determinism
 * test builds twice — ~5.5 s against vitest's 5 s default, which made it fail on slower
 * machines while passing on faster ones.
 *
 * 20 s matches `app/vite.config.ts` (added when the same flakiness hit the app suite), so both
 * packages share one budget: ~4x headroom over the slowest observed case, still tight enough
 * that a genuine hang fails rather than hanging CI.
 */
export default defineConfig({
  test: { testTimeout: 20000 },
});
