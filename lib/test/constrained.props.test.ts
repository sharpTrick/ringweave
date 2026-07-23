/**
 * Property-based invariants for the constraint core. A graph algorithm is
 * defined by what must always hold; these assert the hard guarantees over many
 * randomized *feasible* constraint sets, catching whole classes of bugs that
 * example fixtures miss.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isConnected } from "../src/core/metrics.js";
import {
  Constraints,
  validate,
  constrainedGreedy,
  polishConstrained,
} from "../src/core/index.js";

/** A feasible constraint scenario: sparse prohibited pairs + a required matching. */
const scenario = fc.integer({ min: 10, max: 40 }).chain((n) =>
  fc.record({
    n: fc.constant(n),
    k: fc.integer({ min: 3, max: 5 }),
    prohibited: fc.uniqueArray(
      fc
        .tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 }))
        .filter(([a, b]) => a !== b),
      { maxLength: Math.max(1, Math.floor(n / 8)), selector: ([a, b]) => `${a},${b}` },
    ),
    // unique vertices paired up => a required matching (required-degree <= 1)
    reqVerts: fc.uniqueArray(fc.integer({ min: 0, max: n - 1 }), {
      maxLength: Math.floor(n / 4),
    }),
  }),
);

function build(s: {
  n: number;
  k: number;
  prohibited: [number, number][];
  reqVerts: number[];
}): Constraints {
  const cons = new Constraints(s.n);
  for (const [a, b] of s.prohibited) cons.prohibit(a, b);
  const even = s.reqVerts.length - (s.reqVerts.length % 2);
  for (let i = 0; i < even; i += 2) cons.require(s.reqVerts[i], s.reqVerts[i + 1]);
  return cons;
}

describe("constrainedGreedy invariants over random feasible inputs", () => {
  it("satisfies hard constraints, stays connected, and is deterministic", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const cons = build(s);
        fc.pre(validate(cons, s.k).length === 0);

        const g = constrainedGreedy(s.n, s.k, cons, { minSeparation: 5 });

        // symmetry
        for (let u = 0; u < s.n; u++) {
          for (const v of g.adj[u]) expect(g.adj[v].has(u)).toBe(true);
        }
        // hard guarantees
        for (const [a, b] of cons.prohibitedPairs()) expect(g.hasEdge(a, b)).toBe(false);
        for (const [a, b] of cons.requiredPairs()) expect(g.hasEdge(a, b)).toBe(true);
        // no self-loops, no isolated vertices, connected
        for (let v = 0; v < s.n; v++) expect(g.hasEdge(v, v)).toBe(false);
        expect(isConnected(g)).toBe(true);
        // determinism: RNG-free, so a rerun is identical
        const rerun = constrainedGreedy(s.n, s.k, cons, { minSeparation: 5 });
        expect(rerun.edgeList()).toEqual(g.edgeList());
      }),
      { numRuns: 60 },
    );
  });

  it("polish preserves the degree sequence and the hard constraints", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const cons = build(s);
        fc.pre(validate(cons, s.k).length === 0);

        const g = constrainedGreedy(s.n, s.k, cons, { minSeparation: 5 });
        const before = g.degrees();
        const polished = polishConstrained(g, cons, { seed: 3, iters: 600 });

        expect(polished.degrees()).toEqual(before);
        for (const [a, b] of cons.prohibitedPairs()) {
          expect(polished.hasEdge(a, b)).toBe(false);
        }
        for (const [a, b] of cons.requiredPairs()) {
          expect(polished.hasEdge(a, b)).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });
});
