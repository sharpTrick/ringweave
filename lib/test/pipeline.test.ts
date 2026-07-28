import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "../src/core/index.js";
import { polish } from "../src/core/polish.js";
import { ringGreedy, MAX_CACHED_N } from "../src/core/greedy.js";
import { allPairsSummary, isConnected } from "../src/core/metrics.js";
import { Graph, ring } from "../src/core/graph.js";
import { BAD_N, BAD_K } from "./fixtures/malformedInputs.js";

// The unconstrained path has no report channel, so it THROWS a clear error.
describe("malformed inputs throw a clear error (unconstrained path)", () => {
  it.each(BAD_N)("new Graph(%p) throws a clear (non-RangeError) message", (n) => {
    expect(() => new Graph(n)).toThrow(/integer/);
  });
  it.each(BAD_N)("buildBuddyGraph(%p, 3) throws a clear error", (n) => {
    // malformed n -> "integer"; oversized-but-valid n -> the O(n^2) cache cap
    expect(() => buildBuddyGraph(n, 3)).toThrow(/integer|supports up to/);
  });
  it.each(BAD_K)("buildBuddyGraph(30, %p) and ringGreedy(30, %p) throw", (k) => {
    expect(() => buildBuddyGraph(30, k)).toThrow(/integer/);
    expect(() => ringGreedy(30, k)).toThrow(/integer/);
  });

  it("refuses a roster above MAX_CACHED_N with a clear (non-RangeError) message", () => {
    // the O(n^2) distance cache must be capped tighter than MAX_ROSTER
    expect(() => ringGreedy(MAX_CACHED_N + 1, 4)).toThrow(/ringGreedy supports up to/);
    expect(() => buildBuddyGraph(MAX_CACHED_N + 1, 4)).toThrow(/ringGreedy supports up to/);
  });

  // The ring seed floors degree at 2, so k<2 can't be honored — reject rather
  // than silently return a 2-regular graph. (Constrained path handles k<2; see
  // constrained.test.ts.)
  it.each([0, 1])("buildBuddyGraph/ringGreedy reject k=%i (ring floors degree at 2)", (k) => {
    expect(() => buildBuddyGraph(20, k)).toThrow(/needs k >= 2/);
    expect(() => ringGreedy(20, k)).toThrow(/needs k >= 2/);
  });
  it.each([2, 3, 4])("buildBuddyGraph respects the degree cap for k=%i", (k) => {
    expect(buildBuddyGraph(20, k, { polish: false }).degreeMax).toBeLessThanOrEqual(k);
  });
});

describe("polish connectivity", () => {
  it("reports connectivity and never disconnects a connected input", () => {
    const res = polish(ring(20), { seed: 1, maxIters: 2000 });
    expect(res.connected).toBe(true);
    expect(isConnected(res.graph)).toBe(true);
  });
});

describe("buildBuddyGraph", () => {
  it("produces a valid symmetric buddy assignment", () => {
    const r = buildBuddyGraph(30, 4);
    expect(r.buddies.length).toBe(30);
    // symmetry: i lists j iff j lists i
    for (let i = 0; i < 30; i++) {
      for (const j of r.buddies[i]) {
        expect(r.buddies[j]).toContain(i);
      }
    }
    // degree cap respected
    expect(r.degreeMax).toBeLessThanOrEqual(4);
    // well connected
    expect(r.diameter).toBeGreaterThan(0);
    expect(r.asplGap).toBeLessThan(0.2);
  });

  it("is deterministic (same input -> same output)", () => {
    const a = buildBuddyGraph(40, 4, { seed: 7 });
    const b = buildBuddyGraph(40, 4, { seed: 7 });
    expect(a.edges).toEqual(b.edges);
    expect(a.aspl).toBe(b.aspl);
  });

  it("reaches near-optimal ASPL at small n with polish", () => {
    const r = buildBuddyGraph(20, 4, { polish: true });
    // Python: polished (20,4) hits 0% gap; allow a small margin
    expect(r.asplGap).toBeLessThan(0.03);
  });

  it("stays regular for feasible sizes", () => {
    const r = buildBuddyGraph(50, 4);
    expect(r.regular).toBe(true);
    expect(r.degreeMin).toBe(4);
    expect(r.degreeMax).toBe(4);
  });
});

describe("polish", () => {
  it("preserves degree sequence (regularity)", () => {
    const { graph } = ringGreedy(50, 4, { mind: 5, repair: true });
    const before = graph.degrees();
    const res = polish(graph, { mode: "anneal", seed: 1, maxIters: 3000 });
    expect(res.graph.degrees()).toEqual(before);
  });

  it("does not increase ASPL", () => {
    const { graph } = ringGreedy(50, 4, { mind: 5, repair: true });
    const before = allPairsSummary(graph).aspl;
    const res = polish(graph, { mode: "anneal", seed: 1, maxIters: 5000 });
    expect(res.aspl).toBeLessThanOrEqual(before + 1e-9);
  });

  it("is deterministic given a seed", () => {
    const { graph } = ringGreedy(40, 4, { mind: 5, repair: true });
    const a = polish(graph, { mode: "anneal", seed: 99, maxIters: 4000 });
    const b = polish(graph, { mode: "anneal", seed: 99, maxIters: 4000 });
    expect(a.graph.edgeList()).toEqual(b.graph.edgeList());
  });

  it("refuses a seed it cannot honour instead of aliasing it onto another one", () => {
    // The invariant: every seed the core ACCEPTS names its own stream. `seed >>> 0` broke that
    // for a whole family of values at once — `0.9`, `-0`, `NaN`, `2**32` and `12345 + 2**32` all
    // silently became a seed that had already been asked for. Seed is the app's "give me a
    // different arrangement" control, so aliasing answers the one request the user made with the
    // graph they were trying to leave, and reports success. It was the last numeric option in the
    // core that was coerced rather than checked.
    const { graph } = ringGreedy(40, 4, { mind: 5, repair: true });
    for (const bad of [0.9, -1, NaN, Infinity, 2 ** 32, 12345 + 2 ** 32]) {
      expect(() => polish(graph, { seed: bad, maxIters: 10 })).toThrow(/seed .* must be an integer/);
    }
    expect(() => polish(graph, { seed: 0, maxIters: 10 })).not.toThrow();
    expect(() => polish(graph, { seed: 2 ** 32 - 1, maxIters: 10 })).not.toThrow();
    // -0 is `Number.isInteger`-true and >= 0, so it is accepted — and it must be, because it IS
    // 0: `-0 === 0`, `(-0) >>> 0 === 0`, and the stream is identical. Aliasing is only a defect
    // when two DISTINCT values collide.
    expect(() => polish(graph, { seed: -0, maxIters: 10 })).not.toThrow();

    // Closed at the theme, not the case: the same option on the two builders above it. The fast
    // tier throws (its documented contract), and does so whether or not polish runs — the check
    // is at the option, not at the RNG, so it cannot become a function of roster size.
    expect(() => buildBuddyGraph(24, 4, { seed: 12345.6 })).toThrow(/seed .* must be an integer/);
    expect(() => buildBuddyGraph(24, 4, { seed: 12345.6, polish: false })).toThrow(
      /seed .* must be an integer/,
    );
    // ...and distinct accepted seeds are distinct arrangements, which is what the caller asked for.
    const s1 = buildBuddyGraph(60, 4, { seed: 1, polish: true });
    const s2 = buildBuddyGraph(60, 4, { seed: 2, polish: true });
    expect(s1.edges).not.toEqual(s2.edges);
  });
});
