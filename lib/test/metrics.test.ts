import { describe, it, expect } from "vitest";
import { Graph, ring } from "../src/core/graph.js";
import { allPairsSummary, girth, connectedComponents } from "../src/core/metrics.js";
import { mooreLowerBounds, cycleAspl } from "../src/core/bounds.js";

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
