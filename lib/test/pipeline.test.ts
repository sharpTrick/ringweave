import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "../src/core/index.js";
import { polish } from "../src/core/polish.js";
import { ringGreedy } from "../src/core/greedy.js";
import { allPairsSummary } from "../src/core/metrics.js";
import { Graph } from "../src/core/graph.js";

// Malformed-input class (negative / fractional / NaN / Infinity / oversized).
// The unconstrained path has no report channel, so it THROWS a clear error.
const BAD_N = [-1, 2.5, Number.NaN, Infinity, 5e9];
const BAD_K = [-1, 2.5, Number.NaN, Infinity];

describe("malformed inputs throw a clear error (unconstrained path)", () => {
  it.each(BAD_N)("new Graph(%p) throws a clear (non-RangeError) message", (n) => {
    expect(() => new Graph(n)).toThrow(/integer/);
  });
  it.each(BAD_N)("buildBuddyGraph(%p, 3) throws", (n) => {
    expect(() => buildBuddyGraph(n, 3)).toThrow(/integer/);
  });
  it.each(BAD_K)("buildBuddyGraph(30, %p) and ringGreedy(30, %p) throw", (k) => {
    expect(() => buildBuddyGraph(30, k)).toThrow(/integer/);
    expect(() => ringGreedy(30, k)).toThrow(/integer/);
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
