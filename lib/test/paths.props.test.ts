/**
 * Property-based invariants for `shortestPath` / `eccentricity` over random
 * graphs. A path is defined by what must always hold — contiguous, correct
 * endpoints, exactly as long as the distance says, and identical no matter what
 * order the edges were inserted in — and those hold for every graph, not just the
 * fixtures in paths.test.ts.
 *
 * The length invariant is the load-bearing one: it checks the path against
 * `bfsDistances`, which is itself validated against the Python reference. So this
 * is not a TS BFS asserted against another TS BFS.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Graph } from "../src/core/graph.js";
import {
  shortestPath,
  eccentricity,
  bfsDistances,
  isConnected,
  UNREACHABLE,
} from "../src/core/metrics.js";

/** A random graph as a vertex count plus a unique, self-loop-free edge list. */
const scenario = fc.integer({ min: 2, max: 30 }).chain((n) =>
  fc.record({
    n: fc.constant(n),
    edges: fc.uniqueArray(
      fc
        .tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 }))
        .filter(([a, b]) => a !== b),
      // Sparse enough that disconnected graphs occur often — the unreachable
      // branches are the ones worth exercising.
      { maxLength: n, selector: ([a, b]) => (a < b ? `${a},${b}` : `${b},${a}`) },
    ),
    s: fc.integer({ min: 0, max: n - 1 }),
    t: fc.integer({ min: 0, max: n - 1 }),
  }),
);

interface Scenario {
  n: number;
  edges: [number, number][];
  s: number;
  t: number;
}

function build(sc: Scenario): Graph {
  const g = new Graph(sc.n);
  for (const [u, v] of sc.edges) g.addEdge(u, v);
  return g;
}

/** Same edge set, inserted in reversed order with reversed endpoints. */
function buildReversed(sc: Scenario): Graph {
  const g = new Graph(sc.n);
  for (let i = sc.edges.length - 1; i >= 0; i--) {
    const [u, v] = sc.edges[i];
    g.addEdge(v, u);
  }
  return g;
}

describe("shortestPath invariants over random graphs", () => {
  it("is contiguous, correctly ended, and exactly as long as the distance", () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        const g = build(sc);
        const path = shortestPath(g, sc.s, sc.t);
        const dist = bfsDistances(g, sc.s);

        if (dist[sc.t] === UNREACHABLE) {
          expect(path).toBeNull();
          return;
        }

        expect(path).not.toBeNull();
        const p = path as number[];
        expect(p[0]).toBe(sc.s);
        expect(p[p.length - 1]).toBe(sc.t);
        // The oracle: length agrees with the Python-validated distance function.
        expect(p.length - 1).toBe(dist[sc.t]);
        // Every consecutive pair is a real edge, and no vertex repeats (which a
        // shortest path cannot do, and which a length check alone would miss).
        const seen = new Set<number>();
        for (let i = 0; i < p.length; i++) {
          expect(seen.has(p[i])).toBe(false);
          seen.add(p[i]);
          if (i > 0) expect(g.adj[p[i - 1]].has(p[i])).toBe(true);
        }
      }),
    );
  });

  it("is identical when the graph is rebuilt with edges inserted in reverse", () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        // Adjacency is a Set, so insertion order changes iteration order. A path
        // reconstructed from BFS parents would differ here; min-index does not.
        expect(shortestPath(build(sc), sc.s, sc.t)).toEqual(
          shortestPath(buildReversed(sc), sc.s, sc.t),
        );
      }),
    );
  });

  it("agrees with the distance function in both directions", () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        const g = build(sc);
        const there = shortestPath(g, sc.s, sc.t);
        const back = shortestPath(g, sc.t, sc.s);
        // Reachability is symmetric, and both are shortest, so they agree on
        // existence and on length even though they need not be reverses.
        expect(there === null).toBe(back === null);
        if (there !== null && back !== null) {
          expect(there.length).toBe(back.length);
        }
      }),
    );
  });
});

describe("eccentricity invariants over random graphs", () => {
  it("is finite exactly when the graph is connected", () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        const g = build(sc);
        expect(Number.isFinite(eccentricity(g, sc.s))).toBe(isConnected(g));
      }),
    );
  });

  it("bounds every path length from that vertex", () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        const g = build(sc);
        const path = shortestPath(g, sc.s, sc.t);
        // Skip unreachable draws rather than branching on them: a conditional
        // assertion leaves the case where the body never runs indistinguishable
        // from a test with no assertions at all.
        fc.pre(path !== null);
        expect((path as number[]).length - 1).toBeLessThanOrEqual(eccentricity(g, sc.s));
      }),
    );
  });

  it("does not depend on edge-insertion order", () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        expect(eccentricity(build(sc), sc.s)).toBe(eccentricity(buildReversed(sc), sc.s));
      }),
    );
  });
});
