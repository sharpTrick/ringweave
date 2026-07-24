import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { forceLayout, forceIters, ringLayout, FORCE_MAX_N, FORCE_MAX_EDGES } from "../src/graph/layout";

describe("layout determinism", () => {
  const result = buildBuddyGraph(30, 4, { seed: 12345 });

  it("ring layout is stable and unit-scaled", () => {
    const a = ringLayout(30);
    const b = ringLayout(30);
    expect(a).toEqual(b);
    for (const p of a) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 10);
  });

  it("force layout is deterministic run-to-run (no Math.random)", () => {
    const a = forceLayout(30, result.edges);
    const b = forceLayout(30, result.edges);
    expect(a).toEqual(b);
    expect(a).toHaveLength(30);
    for (const p of a) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("falls back to the ring layout above FORCE_MAX_N (no super-linear settle)", () => {
    const n = FORCE_MAX_N + 1;
    const start = performance.now();
    const pts = forceLayout(n, []);
    expect(performance.now() - start).toBeLessThan(100);
    expect(pts).toEqual(ringLayout(n)); // exact ring fallback, not a settled sim
  });

  // Class: an IN-RANGE force settle (n <= FORCE_MAX_N) must not freeze the main thread. Ticks
  // scale down with n so O(n · ticks) stays bounded — a fixed 300 ticks froze ~1.5 s at n=1000.
  it("scales ticks down with n so the settle stays cheap (full ticks only for small graphs)", () => {
    expect(forceIters(30)).toBe(300); // small: full settle
    expect(forceIters(120)).toBe(300); // at the knee: still full
    expect(forceIters(1000)).toBeLessThan(300); // large: scaled down
    // monotonic non-increasing past the knee, and never below the floor
    for (const n of [200, 500, 750, 1000]) {
      expect(forceIters(n)).toBeGreaterThanOrEqual(40);
      expect(forceIters(n)).toBeLessThanOrEqual(forceIters(n - 100));
    }
  });

  it("settles every in-range n within a wall-clock budget (no main-thread freeze)", () => {
    for (const n of [250, 500, FORCE_MAX_N]) {
      for (const m of [0, n]) {
        const edges: [number, number][] = Array.from({ length: m }, (_, i) => [i, (i + 1) % n]);
        const start = performance.now();
        const pts = forceLayout(n, edges);
        const ms = performance.now() - start;
        expect(pts).toHaveLength(n);
        expect(ms).toBeLessThan(700); // was ~1500ms at n=1000 with fixed 300 ticks
      }
    }
  });

  it("falls back to the ring layout above FORCE_MAX_EDGES even when n is small", () => {
    const n = 100; // well under FORCE_MAX_N
    const edges: [number, number][] = [];
    for (let i = 0; i < n && edges.length <= FORCE_MAX_EDGES; i++) {
      for (let j = i + 1; j < n; j++) edges.push([i, j]);
    }
    expect(edges.length).toBeGreaterThan(FORCE_MAX_EDGES);
    const pts = forceLayout(n, edges);
    expect(pts).toEqual(ringLayout(n)); // dense graph renders as ring, not a frozen sim
  });
});
