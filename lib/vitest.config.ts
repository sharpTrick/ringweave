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
  test: {
    // PINNED, not defaulted. Vitest's default include is `**/*.test.*` from the
    // package root, so a review lens dropping a throwaway probe anywhere under
    // `lib/` becomes part of `npm test` — and a probe whose expectation is wrong
    // reports as a regression in the code under review. That happened four times
    // in one run, in four different directories, which is why the fix is a glob
    // and not another instruction to tidy up. Every tracked test lives under
    // `test/`, verified with `git ls-files`, so nothing legitimate is excluded.
    include: ["test/**/*.test.ts"],
    testTimeout: 20000,
  },
});
