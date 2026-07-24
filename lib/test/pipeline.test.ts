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
});
