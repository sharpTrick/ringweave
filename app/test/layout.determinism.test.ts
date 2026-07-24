import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { forceLayout, ringLayout, FORCE_MAX_N } from "../src/graph/layout";

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
});
