import { describe, it, expect } from "vitest";
import { Graph, ring } from "../src/core/graph.js";
import {
  allPairsSummary,
  girth,
  connectedComponents,
  largestComponentFraction,
} from "../src/core/metrics.js";
import { mooreLowerBounds, cycleAspl, asplGap } from "../src/core/bounds.js";

function petersen(): Graph {
  const g = new Graph(10);
  for (let i = 0; i < 5; i++) {
    g.addEdge(i, (i + 1) % 5);
    g.addEdge(i, i + 5);
    g.addEdge(5 + i, 5 + ((i + 2) % 5));
  }
  return g;
}

describe("cycle metrics", () => {
  it("matches the closed-form ASPL, diameter, and girth", () => {
    for (const n of [5, 6, 7, 8, 10, 11, 20, 21]) {
      const g = ring(n);
      const { aspl, diameter, connected } = allPairsSummary(g);
      expect(connected).toBe(true);
      expect(aspl).toBeCloseTo(cycleAspl(n), 12);
      expect(diameter).toBe(Math.floor(n / 2));
      expect(girth(g)).toBe(n);
    }
  });
});

describe("Petersen graph", () => {
  it("is a Moore graph: diam 2, girth 5, ASPL 5/3", () => {
    const g = petersen();
    for (let v = 0; v < 10; v++) expect(g.degree(v)).toBe(3);
    const { aspl, diameter, connected } = allPairsSummary(g);
    expect(connected).toBe(true);
    expect(diameter).toBe(2);
    expect(aspl).toBeCloseTo(5 / 3, 12);
    expect(girth(g)).toBe(5);
  });
});

describe("complete graph", () => {
  it("has ASPL 1, diameter 1, girth 3", () => {
    for (const n of [4, 5, 8]) {
      const g = new Graph(n);
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) g.addEdge(i, j);
      const { aspl, diameter } = allPairsSummary(g);
      expect(aspl).toBeCloseTo(1, 12);
      expect(diameter).toBe(1);
      expect(girth(g)).toBe(3);
    }
  });
});

describe("Moore bound", () => {
  it("exactly meets Petersen (10,3): ASPL 5/3, diam 2", () => {
    const { asplLb, diameterLb } = mooreLowerBounds(10, 3);
    expect(diameterLb).toBe(2);
    expect(asplLb).toBeCloseTo(5 / 3, 12);
    const g = petersen();
    const { aspl } = allPairsSummary(g);
    expect(aspl).toBeGreaterThanOrEqual(asplLb - 1e-9);
    expect(aspl).toBeCloseTo(asplLb, 12);
  });
});

describe("girth of a tree", () => {
  it("is Infinity", () => {
    const g = new Graph(4);
    g.addEdge(0, 1);
    g.addEdge(1, 2);
    g.addEdge(2, 3);
    expect(girth(g)).toBe(Infinity);
  });
});

describe("connectedComponents", () => {
  it("partitions vertices into connected components", () => {
    const g = new Graph(6);
    g.addEdge(0, 1); // {0,1,2}
    g.addEdge(1, 2);
    g.addEdge(3, 4); // {3,4}
    // vertex 5 isolated
    const sizes = connectedComponents(g)
      .map((c) => c.length)
      .sort((a, b) => a - b);
    expect(sizes).toEqual([1, 2, 3]);
  });

  it("returns one component for a connected graph and none for n=0", () => {
    expect(connectedComponents(ring(7)).length).toBe(1);
    expect(connectedComponents(new Graph(0)).length).toBe(0);
  });
});

describe("largestComponentFraction", () => {
  it("is 1 for a connected graph", () => {
    expect(largestComponentFraction(ring(7))).toBe(1);
    expect(largestComponentFraction(petersen())).toBe(1);
  });

  it("is the largest component's share when disconnected", () => {
    // two disjoint triangles: largest of 6 is 3 -> 0.5 (mirrors Python test_core)
    const g = new Graph(6);
    g.addEdge(0, 1);
    g.addEdge(1, 2);
    g.addEdge(0, 2);
    g.addEdge(3, 4);
    g.addEdge(4, 5);
    g.addEdge(3, 5);
    expect(largestComponentFraction(g)).toBeCloseTo(0.5, 12);
  });

  it("counts an isolated vertex against the fraction", () => {
    const g = new Graph(5); // path 0-1-2-3 plus isolated 4 -> 4/5
    g.addEdge(0, 1);
    g.addEdge(1, 2);
    g.addEdge(2, 3);
    expect(largestComponentFraction(g)).toBeCloseTo(0.8, 12);
  });

  it("is 1 for the single-vertex and empty boundaries", () => {
    expect(largestComponentFraction(new Graph(1))).toBe(1); // one component of size 1
    expect(largestComponentFraction(new Graph(0))).toBe(1); // vacuous
  });
});

// Ratchet: malformed n/k fed directly to the bounds exports must return a finite
// result quickly — a non-integer k in ~(1.6,1.98) used to spin forever (denormal
// fixed point). Per-test timeout so a regression fails as a timeout, not a hang.
describe("mooreLowerBounds / asplGap reject malformed n,k (no infinite loop)", () => {
  const BAD = [-1, 0, 1.5, 1.9, 1.95, 2.5, Number.NaN, Infinity];
  it.each(BAD)("mooreLowerBounds(50, %p) is finite and terminates", (k) => {
    const b = mooreLowerBounds(50, k);
    expect(Number.isFinite(b.asplLb)).toBe(true);
    expect(Number.isFinite(b.diameterLb)).toBe(true);
  }, 1000);
  it.each(BAD)("asplGap(1, 50, %p) is finite", (k) => {
    expect(Number.isFinite(asplGap(1, 50, k))).toBe(true);
  }, 1000);
  it("caps an oversized n instead of an O(n) stall", () => {
    expect(Number.isFinite(mooreLowerBounds(5e9, 2).asplLb)).toBe(true);
  }, 1000);
});
