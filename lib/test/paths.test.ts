/**
 * `shortestPath` and `eccentricity`: the two queries the app's path finder and
 * node explorer are built on. Both are user-facing in a way the aggregate metrics
 * are not — a path is shown edge by edge — so determinism is asserted directly
 * rather than inferred from a metric matching.
 */
import { describe, it, expect } from "vitest";
import { Graph, ring } from "../src/core/graph.js";
import {
  shortestPath,
  eccentricity,
  bfsDistances,
  UNREACHABLE,
} from "../src/core/metrics.js";

/** Build a graph from an explicit edge list, in the order given. */
function graphOf(n: number, edges: [number, number][]): Graph {
  const g = new Graph(n);
  for (const [u, v] of edges) g.addEdge(u, v);
  return g;
}

describe("shortestPath", () => {
  it("returns the single vertex for s === t", () => {
    expect(shortestPath(ring(6), 3, 3)).toEqual([3]);
  });

  it("returns adjacent endpoints as a two-vertex path", () => {
    expect(shortestPath(ring(6), 0, 1)).toEqual([0, 1]);
  });

  it("walks the short way around a ring, not the long way", () => {
    // ring(8): 0-1-2-3-4-5-6-7-0. 0 to 6 is two steps backwards, six forwards.
    expect(shortestPath(ring(8), 0, 6)).toEqual([0, 7, 6]);
  });

  it("returns null when the target is unreachable", () => {
    const g = graphOf(4, [
      [0, 1],
      [2, 3],
    ]);
    expect(shortestPath(g, 0, 2)).toBeNull();
    expect(shortestPath(g, 0, 1)).toEqual([0, 1]);
  });

  it("returns null on an edgeless graph, and the trivial path to self", () => {
    const g = new Graph(3);
    expect(shortestPath(g, 0, 2)).toBeNull();
    expect(shortestPath(g, 1, 1)).toEqual([1]);
  });

  it("breaks ties by lowest index, not by edge-insertion order", () => {
    // 0 reaches 3 via either 1 or 2, both at distance 1 from 0.
    const edges: [number, number][] = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ];
    const forward = graphOf(4, edges);
    const reversed = graphOf(4, [...edges].reverse());
    expect(shortestPath(forward, 0, 3)).toEqual([0, 1, 3]);
    expect(shortestPath(reversed, 0, 3)).toEqual([0, 1, 3]);
  });

  it("is greedy from the start, so it is not simply reversible", () => {
    // Two disjoint 3-hop routes between 0 and 5: 0-1-4-5 and 0-2-3-5. Reading
    // smallest-first from 0 takes 1 and lands on the first; reading smallest-first
    // from 5 takes 3 and lands on the second. This asymmetry is documented, and it
    // is why the path finder canonicalises on min(s, t).
    const g = graphOf(6, [
      [0, 1],
      [1, 4],
      [4, 5],
      [0, 2],
      [2, 3],
      [3, 5],
    ]);
    const there = shortestPath(g, 0, 5);
    const back = shortestPath(g, 5, 0);
    expect(there).toEqual([0, 1, 4, 5]);
    expect(back).toEqual([5, 3, 2, 0]);
    // Both are genuinely shortest, they are just different paths.
    expect(back?.length).toBe(there?.length);
  });

  it("rejects an out-of-range or non-integer endpoint rather than looping", () => {
    const g = ring(5);
    expect(() => shortestPath(g, 5, 0)).toThrow(/source 5/);
    expect(() => shortestPath(g, 0, -1)).toThrow(/target -1/);
    expect(() => shortestPath(g, 1.5, 0)).toThrow(/source 1.5/);
  });
});

describe("eccentricity", () => {
  it("is the distance to the furthest person", () => {
    // ring(7): the furthest vertex is three steps away in either direction.
    expect(eccentricity(ring(7), 0)).toBe(3);
    expect(eccentricity(ring(8), 0)).toBe(4);
  });

  it("is 0 for a single-vertex graph", () => {
    expect(eccentricity(new Graph(1), 0)).toBe(0);
  });

  it("is Infinity when anyone is unreachable, never a small number", () => {
    const g = graphOf(4, [
      [0, 1],
      [2, 3],
    ]);
    // The reachable half is one step away; reporting 1 would read as "everyone is
    // within one step" for a roster split down the middle.
    expect(eccentricity(g, 0)).toBe(Infinity);
  });

  it("is Infinity for an isolated vertex in a larger graph", () => {
    const g = graphOf(3, [[0, 1]]);
    expect(eccentricity(g, 2)).toBe(Infinity);
  });

  it("agrees with the maximum of the distance vector when connected", () => {
    const g = ring(9);
    for (let v = 0; v < g.n; v++) {
      const dist = bfsDistances(g, v);
      let max = 0;
      for (const d of dist) {
        expect(d).not.toBe(UNREACHABLE);
        if (d > max) max = d;
      }
      expect(eccentricity(g, v)).toBe(max);
    }
  });

  it("rejects an out-of-range vertex", () => {
    expect(() => eccentricity(ring(5), 9)).toThrow(/vertex 9/);
  });
});
