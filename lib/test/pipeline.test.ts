import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "../src/core/index.js";
import { polish } from "../src/core/polish.js";
import { ringGreedy } from "../src/core/greedy.js";
import { allPairsSummary } from "../src/core/metrics.js";
import { Graph } from "../src/core/graph.js";

describe("input validation (unconstrained path)", () => {
  it("rejects a non-integer or negative roster size instead of crashing", () => {
    expect(() => buildBuddyGraph(2.5, 3)).toThrow(/non-negative integer/);
    expect(() => new Graph(2.5)).toThrow(/non-negative integer/);
    expect(() => new Graph(-3)).toThrow(/non-negative integer/);
  });

  it("rejects a NaN/Infinity buddy count instead of silently uncapping degree", () => {
    expect(() => buildBuddyGraph(300, Number.NaN)).toThrow(/non-negative integer/);
    expect(() => buildBuddyGraph(300, Infinity)).toThrow(/non-negative integer/);
    expect(() => ringGreedy(30, -1)).toThrow(/non-negative integer/);
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
