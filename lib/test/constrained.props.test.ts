import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isConnected, largestComponentFraction } from "../src/core/metrics.js";
import {
  Constraints,
  validate,
  constrainedGreedy,
  polishConstrained,
  Graph,
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

/** Same constraint set as `build`, inserted in reversed order (endpoints too). */
function buildReversed(s: {
  n: number;
  k: number;
  prohibited: [number, number][];
  reqVerts: number[];
}): Constraints {
  const cons = new Constraints(s.n);
  const even = s.reqVerts.length - (s.reqVerts.length % 2);
  for (let i = even - 2; i >= 0; i -= 2) cons.require(s.reqVerts[i + 1], s.reqVerts[i]);
  for (let i = s.prohibited.length - 1; i >= 0; i--) {
    const [a, b] = s.prohibited[i];
    cons.prohibit(b, a);
  }
  return cons;
}

describe("constrainedGreedy invariants over random feasible inputs", () => {
  it("satisfies hard constraints, stays connected, and is deterministic", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const cons = build(s);
        fc.pre(validate(cons, s.k).length === 0);

        const g = constrainedGreedy(s.n, s.k, cons, { minSeparation: 5 });

        for (let u = 0; u < s.n; u++) {
          for (const v of g.adj[u]) expect(g.adj[v].has(u)).toBe(true);
        }
        for (const [a, b] of cons.prohibitedPairs()) expect(g.hasEdge(a, b)).toBe(false);
        for (const [a, b] of cons.requiredPairs()) expect(g.hasEdge(a, b)).toBe(true);
        for (let v = 0; v < s.n; v++) expect(g.degree(v)).toBeLessThanOrEqual(s.k);
        for (let v = 0; v < s.n; v++) expect(g.hasEdge(v, v)).toBe(false);
        expect(isConnected(g)).toBe(true);
        const frac = largestComponentFraction(g);
        expect(frac).toBeGreaterThanOrEqual(1 / s.n);
        expect(frac).toBeLessThanOrEqual(1);
        expect(frac === 1).toBe(isConnected(g));
        // Legal-edge-maximal: no addable legal edge may remain, which is what makes forceConnect
        // provably inert — it reuses the same legality predicate.
        for (let u = 0; u < s.n; u++) {
          for (let v = u + 1; v < s.n; v++) {
            const addable =
              g.degree(u) < s.k &&
              g.degree(v) < s.k &&
              !g.hasEdge(u, v) &&
              !cons.isProhibited(u, v);
            expect(addable).toBe(false);
          }
        }
        const rerun = constrainedGreedy(s.n, s.k, cons, { minSeparation: 5 });
        expect(rerun.edgeList()).toEqual(g.edgeList());
        // Constraint insertion ORDER must not leak into output — a guard against a future change
        // that consumes adjacency-Set iteration order directly.
        const reordered = buildReversed(s);
        const g2 = constrainedGreedy(s.n, s.k, reordered, { minSeparation: 5 });
        expect(g2.edgeList()).toEqual(g.edgeList());
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
        const polished = polishConstrained(g, cons, { seed: 3, iters: 600 }).graph;

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

  it("a higher prior weight never keeps fewer priors than zero weight", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const cons = build(s);
        fc.pre(validate(cons, s.k).length === 0);

        // The generated graph's own edges stand in for last round's buddies (churn).
        const base = constrainedGreedy(s.n, s.k, cons, { minSeparation: 5 });
        for (const [a, b] of base.edgeList()) cons.addPrior(a, b);

        const kept = (weight: number) => {
          const g = polishConstrained(base, cons, {
            seed: 5,
            iters: 800,
            priorWeight: weight,
          }).graph;
          return cons.priorPairs().filter(([a, b]) => g.hasEdge(a, b)).length;
        };
        expect(kept(50)).toBeGreaterThanOrEqual(kept(0));
      }),
      { numRuns: 25 },
    );
  });
});

/** Component id per vertex, by plain BFS — independent of the generator's Tarjan pass. */
function componentOwner(g: Graph): number[] {
  const owner = new Array<number>(g.n).fill(-1);
  let next = 0;
  for (let root = 0; root < g.n; root++) {
    if (owner[root] !== -1) continue;
    const queue = [root];
    owner[root] = next;
    while (queue.length > 0) {
      const u = queue.pop() as number;
      for (const v of g.adj[u]) {
        if (owner[v] === -1) {
          owner[v] = next;
          queue.push(v);
        }
      }
    }
    next++;
  }
  return owner;
}

function isBridge(g: Graph, a: number, b: number): boolean {
  const copy = g.copy();
  copy.removeEdge(a, b);
  return componentOwner(copy)[a] !== componentOwner(copy)[b];
}

/**
 * Non-vacuity: `scenario` above connects on every run, so a maximality property asserted over it
 * would be vacuously true. Small n at k=2 with heavy prohibitions is the only regime that strands
 * anyone, and the counter in the test below keeps that honest if this generator ever drifts.
 */
const strandScenario = fc.integer({ min: 4, max: 8 }).chain((n) =>
  fc.record({
    n: fc.constant(n),
    k: fc.constantFrom(2, 3),
    prohibited: fc.uniqueArray(
      fc
        .tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 }))
        .filter(([a, b]) => a !== b),
      { maxLength: n, selector: ([a, b]) => `${Math.min(a, b)},${Math.max(a, b)}` },
    ),
  }),
);

describe("constrainedGreedy leaves no repair on the table", () => {
  it("no under-k person could be joined by re-pointing one droppable edge", () => {
    let sawDisconnected = 0;
    fc.assert(
      fc.property(strandScenario, (s) => {
        const cons = new Constraints(s.n);
        for (const [a, b] of s.prohibited) cons.prohibit(a, b);
        fc.pre(validate(cons, s.k).length === 0);

        const g = constrainedGreedy(s.n, s.k, cons);
        if (!isConnected(g)) sawDisconnected++;

        // Checked from OUTSIDE the generator, with an independent component walk and a
        // remove-and-retest bridge oracle rather than the generator's own Tarjan pass.
        const owner = componentOwner(g);
        for (let u = 0; u < s.n; u++) {
          if (g.degree(u) >= s.k) continue;
          for (const [a, b] of g.edgeList()) {
            if (owner[a] === owner[u]) continue;
            if (cons.isRequired(a, b) || isBridge(g, a, b)) continue;
            for (const keep of [a, b]) {
              const available = !cons.isProhibited(u, keep) && !g.hasEdge(u, keep);
              expect(available).toBe(false);
            }
          }
        }
      }),
      { numRuns: 300 },
    );
    // Non-vacuity: without this the property above passes on a generator that never strands
    // anyone.
    expect(sawDisconnected).toBeGreaterThan(0);
  });
});
