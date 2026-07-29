/**
 * Constraint core tests. Byte-identity with the Python reference is not
 * required; instead we assert the hard guarantees (required present, prohibited
 * absent, connected) and oracle parity — ASPL/diameter within a small tolerance
 * of the Python reference recorded in reference.json.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Graph } from "../src/core/graph.js";
import { constrainedWork, MAX_CONSTRAINED_WORK } from "../src/core/budgets.js";
import { allPairsSummary, connectedComponents, isConnected } from "../src/core/metrics.js";
import { BAD_N, BAD_K } from "./fixtures/malformedInputs.js";
import {
  Constraints,
  validate,
  constrainedGreedy,
  polishConstrained,
  buildConstrainedBuddyGraph,
  MAX_ROSTER,
  MAX_CONSTRAINED_N,
} from "../src/core/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(join(here, "fixtures", "reference.json"), "utf8"));

interface ConstrainedFixture {
  scenario: string;
  n: number;
  k: number;
  mind: number;
  required: [number, number][];
  prohibited: [number, number][];
  aspl: number;
  diameter: number;
  deg_min: number;
  deg_max: number;
  connected: boolean;
  satisfied: boolean;
}

function consFrom(fx: ConstrainedFixture): Constraints {
  const c = new Constraints(fx.n);
  for (const [a, b] of fx.required) c.require(a, b);
  for (const [a, b] of fx.prohibited) c.prohibit(a, b);
  return c;
}

function hasAllRequired(g: Graph, c: Constraints): boolean {
  return c.requiredPairs().every(([a, b]) => g.hasEdge(a, b));
}

function hasNoProhibited(g: Graph, c: Constraints): boolean {
  return c.prohibitedPairs().every(([a, b]) => !g.hasEdge(a, b));
}

function extent(xs: number[]): [number, number] {
  let lo = xs[0];
  let hi = xs[0];
  for (const x of xs) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return [lo, hi];
}

describe("constrainedGreedy oracle parity vs Python", () => {
  for (const fx of ref.constrained as ConstrainedFixture[]) {
    it(`${fx.scenario} n=${fx.n} k=${fx.k}`, () => {
      const cons = consFrom(fx);
      const g = constrainedGreedy(fx.n, fx.k, cons, { minSeparation: fx.mind });

      // hard guarantees + oracle parity on connectivity/satisfaction
      expect(hasNoProhibited(g, cons)).toBe(true);
      expect(hasAllRequired(g, cons)).toBe(true);
      expect(isConnected(g)).toBe(fx.connected);
      expect(fx.satisfied).toBe(true);

      // quality parity with the reference implementation
      const { aspl, diameter } = allPairsSummary(g);
      expect(Math.abs(aspl - fx.aspl) / fx.aspl).toBeLessThan(0.1);
      expect(Math.abs(diameter - fx.diameter)).toBeLessThanOrEqual(1);

      // degree is a hard cap now (forceConnect respects k), and spread matches
      // the reference on these fixtures. Loop, not Math.max(...), to stay safe
      // at large n (see degreeExtent).
      const degs = g.degrees();
      const [dMin, dMax] = extent(degs);
      expect(dMax).toBeLessThanOrEqual(fx.k);
      expect(dMax - dMin).toBeLessThanOrEqual(fx.deg_max - fx.deg_min + 1);
    });
  }
});

describe("validate infeasibility messages", () => {
  it("required-degree over k", () => {
    const c = new Constraints(6);
    c.require(0, 1).require(0, 2).require(0, 3);
    expect(validate(c, 2)).toContain(
      "person 0 has 3 required buddies but each person gets 2",
    );
  });

  it("pair both required and prohibited", () => {
    const c = new Constraints(6);
    c.require(1, 4).prohibit(1, 4);
    expect(validate(c, 4)).toContain("pair 1–4 is both required and prohibited");
  });

  it("person prohibited from everyone", () => {
    const c = new Constraints(4);
    for (let v = 1; v < 4; v++) c.prohibit(0, v);
    expect(validate(c, 3)).toContain(
      "person 0 is prohibited from everyone — they'd have no buddies",
    );
  });

  it("feasible constraints return no errors", () => {
    const c = new Constraints(20);
    c.require(0, 1).prohibit(2, 3);
    expect(validate(c, 4)).toEqual([]);
  });

  it("rejects out-of-range and self-referential person ids", () => {
    const outOfRange = new Constraints(5);
    outOfRange.require(0, 100);
    expect(validate(outOfRange, 4)).toContain(
      "constraint references unknown person 100 (roster has 5)",
    );

    const negative = new Constraints(5);
    negative.prohibit(-1, 0);
    expect(validate(negative, 4).length).toBeGreaterThan(0);

    const selfPair = new Constraints(5);
    selfPair.require(2, 2);
    expect(validate(selfPair, 4)).toContain(
      "person 2 cannot be paired with themselves",
    );
  });

  it("accepts an all-prohibited roster when k=0 (nobody needs buddies)", () => {
    const c = new Constraints(3);
    c.prohibit(0, 1).prohibit(0, 2).prohibit(1, 2);
    expect(validate(c, 0)).toEqual([]);
  });

  it("refuses when prohibited pairs split the group into unconnectable parts", () => {
    // {0,1} vs {2,3}, every cross pair prohibited: no connected graph exists
    const c = new Constraints(4);
    for (const a of [0, 1]) for (const b of [2, 3]) c.prohibit(a, b);
    const errs = validate(c, 1);
    expect(errs.some((e) => e.includes("split the group"))).toBe(true);
  });
});

// Same malformed-input class as pipeline.test.ts (shared fixture), but the
// constraint-aware path REFUSES (report.refusals) rather than throwing — validate
// must never throw, even on an astronomically large roster.
describe("malformed inputs are refused, never thrown (constrained path)", () => {
  it.each(BAD_N)("validate never throws for roster size %p", (n) => {
    const errs = validate(new Constraints(n), 4);
    expect(errs.length).toBeGreaterThan(0);
  });
  it.each(BAD_K)("validate never throws for buddy count %p", (k) => {
    expect(validate(new Constraints(10), k).length).toBeGreaterThan(0);
  });
  it.each(BAD_N)("buildConstrainedBuddyGraph refuses roster size %p", (n) => {
    const r = buildConstrainedBuddyGraph(n, 4, new Constraints(n));
    expect(r.report.refusals.length).toBeGreaterThan(0);
    expect(r.edges).toEqual([]);
  });
  it.each(BAD_K)("buildConstrainedBuddyGraph refuses buddy count %p", (k) => {
    const r = buildConstrainedBuddyGraph(10, k, new Constraints(10));
    expect(r.report.refusals.length).toBeGreaterThan(0);
  });

  it("merge fails fast on an n mismatch", () => {
    expect(() => new Constraints(5).merge(new Constraints(6))).toThrow(/cannot merge/);
  });

  // The constrained path is O(n²) in time, so it is capped far tighter than
  // MAX_ROSTER — a legal-but-huge roster must be refused (validate/builder) or
  // thrown (direct primitive), not left to hang. All three entry points share
  // the ceiling; assert the boundary at each so widening one can't reopen it.
  describe("constrained roster cap (MAX_CONSTRAINED_N)", () => {
    it("validate accepts exactly the cap and refuses one past it", () => {
      expect(validate(new Constraints(MAX_CONSTRAINED_N), 4)).toEqual([]);
      const over = validate(new Constraints(MAX_CONSTRAINED_N + 1), 4);
      expect(over.length).toBe(1);
      expect(over[0]).toMatch(/constrained maximum/);
    });
    it("buildConstrainedBuddyGraph refuses one past the cap (no graph)", () => {
      const r = buildConstrainedBuddyGraph(
        MAX_CONSTRAINED_N + 1,
        4,
        new Constraints(MAX_CONSTRAINED_N + 1),
      );
      expect(r.report.refusals.some((m) => /constrained maximum/.test(m))).toBe(true);
      expect(r.edges).toEqual([]);
    });
    it("constrainedGreedy (direct) throws one past the cap", () => {
      expect(() =>
        constrainedGreedy(MAX_CONSTRAINED_N + 1, 4, new Constraints(MAX_CONSTRAINED_N + 1)),
      ).toThrow(/constrained maximum/);
    });
    it("validate still refuses (never throws) an astronomically large roster", () => {
      expect(validate(new Constraints(MAX_ROSTER + 1), 4).length).toBeGreaterThan(0);
    });
  });

  // Cost scales as n²·min(k,n-1), so a dense k blows generation up even under the
  // n-cap. MAX_CONSTRAINED_WORK refuses such inputs at all three entry points
  // BEFORE any generation runs (so this table is fast). Cases span the dense
  // corner and oversized-work sparse-large; the boundary is re-derived from the
  // exported constant, so a future threshold change keeps the guard honest.
  describe("constrained work budget (MAX_CONSTRAINED_WORK)", () => {
    const OVER: [number, number][] = [
      [5000, 10], // sparse but large-n
      [3000, 20],
      [1000, 200],
      [500, 499], // near-complete (dense)
    ];
    it.each(OVER)("refuses n=%i, k=%i whose estimated work exceeds the budget", (n, k) => {
      expect(constrainedWork(n, k, 0)).toBeGreaterThan(MAX_CONSTRAINED_WORK);
      expect(validate(new Constraints(n), k).some((m) => /too large to generate/.test(m))).toBe(
        true,
      );
      const r = buildConstrainedBuddyGraph(n, k, new Constraints(n));
      expect(r.report.refusals.some((m) => /too large to generate/.test(m))).toBe(true);
      expect(r.edges).toEqual([]);
      expect(() => constrainedGreedy(n, k, new Constraints(n))).toThrow(/too large to generate/);
    });
    it("accepts a roster at exactly the budget (work not strictly over)", () => {
      expect(constrainedWork(5000, 4, 0)).toBe(MAX_CONSTRAINED_WORK);
      expect(validate(new Constraints(5000), 4)).toEqual([]);
    });

    it("charges the constraint set, so no dimension the inner loop probes is invisible", () => {
      // The estimator was (n, k)-only while every legality decision in the generator probes the
      // prohibited set. Measured at k=4: n=5000 with no prohibitions is 15.0 s (the calibration
      // point, exactly at the budget) and the same roster with a million prohibited pairs is
      // 49.4 s — 3.3x the worst case the constant documents — with `validate` returning `[]`.
      // n=3000 is the shape with headroom: 5.5 s bare, 17.1 s with a million pairs.
      const dense = (n: number, pairs: number): Constraints => {
        const c = new Constraints(n);
        let made = 0;
        for (let a = 0; a < n && made < pairs; a++) {
          for (let b = a + 1; b < n && made < pairs; b++) {
            c.prohibit(a, b);
            made++;
          }
        }
        return c;
      };
      const withPairs = dense(3000, 1_000_000);
      expect(constrainedWork(3000, 4, 0)).toBeLessThanOrEqual(MAX_CONSTRAINED_WORK);
      expect(constrainedWork(3000, 4, withPairs.prohibitedCount)).toBeGreaterThan(MAX_CONSTRAINED_WORK);
      expect(validate(withPairs, 4).some((m) => /too large to generate/.test(m))).toBe(true);
      // ...and the refusal reaches both entry points, so the gate and the throw stay in step.
      expect(() => constrainedGreedy(3000, 4, withPairs)).toThrow(/too large to generate/);
      expect(buildConstrainedBuddyGraph(3000, 4, withPairs).report.refusals.length).toBeGreaterThan(0);

      // MONOTONE in the constraint set: adding a prohibited pair can only move an input toward
      // refusal. That is the property, and it is what a (n,k)-only estimator could not have.
      for (const n of [50, 500, 3000]) {
        let prev = constrainedWork(n, 4, 0);
        for (const pairs of [1, 100, 10_000, 1_000_000]) {
          const next = constrainedWork(n, 4, pairs);
          expect(next).toBeGreaterThan(prev);
          prev = next;
        }
      }
      // And nothing the APP can express is affected: its cap is 200 pairs.
      expect(constrainedWork(200, 4, 200)).toBeLessThanOrEqual(MAX_CONSTRAINED_WORK);
    }, 60_000);
  });

  it.each(BAD_N)(
    "Constraints(%p) degree accessors throw a clear error, not a native RangeError",
    (n) => {
      expect(() => new Constraints(n).requiredDegree()).toThrow(/valid count/);
      expect(() => new Constraints(n).prohibitedDegree()).toThrow(/valid count/);
    },
  );
});

describe("constrained path honors low buddy counts (cross-path with buildBuddyGraph)", () => {
  // Where buildBuddyGraph rejects k<2, the constrained path builds it correctly.
  // Pin the STRUCTURE, not just the degree cap (a 0-edge graph caps trivially).
  // Even and odd n so the k=1 odd-n leftover vertex is covered too.
  it.each([12, 13])("k=0 -> empty graph (n=%i)", (n) => {
    const r = buildConstrainedBuddyGraph(n, 0, new Constraints(n));
    expect(r.edges.length).toBe(0);
    expect(r.degreeMax).toBe(0);
  });
  it.each([12, 13])("k=1 -> a matching of floor(n/2) edges (n=%i)", (n) => {
    const r = buildConstrainedBuddyGraph(n, 1, new Constraints(n));
    expect(r.edges.length).toBe(Math.floor(n / 2));
    expect(r.degreeMax).toBeLessThanOrEqual(1);
  });
  it.each([12, 13])("k=2 -> 2-regular, every degree exactly 2 (n=%i)", (n) => {
    const r = buildConstrainedBuddyGraph(n, 2, new Constraints(n));
    expect(r.degreeMin).toBe(2);
    expect(r.degreeMax).toBe(2);
  });
});

describe("fromTags compiles same-group to prohibited", () => {
  it("prohibits household members", () => {
    const tags = [0, 0, 1, 1, 1, null, null];
    const c = Constraints.fromTags(7, tags, "prohibit_same");
    expect(c.isProhibited(0, 1)).toBe(true); // group 0
    expect(c.isProhibited(2, 3)).toBe(true); // group 1
    expect(c.isProhibited(2, 4)).toBe(true);
    expect(c.isProhibited(3, 4)).toBe(true);
    expect(c.isProhibited(5, 6)).toBe(false); // null tags never prohibited
    expect(c.isProhibited(0, 2)).toBe(false); // different groups
  });

  it("treats a short/sparse tags array as ungrouped past its end", () => {
    // only 2 of 5 entries present — indices 2..4 have no tag and must not group
    const c = Constraints.fromTags(5, [0, 1], "prohibit_same");
    expect(c.prohibitedCount).toBe(0);
  });
});

describe("polishConstrained preserves hard constraints and degrees", () => {
  it("keeps prohibited out, required in, and the degree sequence fixed", () => {
    const cons = new Constraints(40);
    cons.require(0, 1).require(2, 3);
    cons.prohibit(4, 5).prohibit(6, 7);
    const base = constrainedGreedy(40, 4, cons, { minSeparation: 5 });
    const before = base.degrees();

    const polished = polishConstrained(base, cons, { seed: 1, iters: 4000 }).graph;

    expect(hasNoProhibited(polished, cons)).toBe(true);
    expect(hasAllRequired(polished, cons)).toBe(true);
    expect(polished.degrees()).toEqual(before);
    // polish never worsens ASPL relative to its input
    expect(allPairsSummary(polished).aspl).toBeLessThanOrEqual(
      allPairsSummary(base).aspl + 1e-9,
    );
  });

  it("never disconnects a connected graph, even at extreme prior weight", () => {
    const g = new Graph(6);
    for (let i = 0; i < 6; i++) g.addEdge(i, (i + 1) % 6); // connected 2-regular cycle
    const cons = new Constraints(6);
    // priors only fully satisfiable by two disjoint triangles (a disconnected graph)
    const tri: [number, number][] = [
      [0, 1], [1, 2], [0, 2], [3, 4], [4, 5], [3, 5],
    ];
    for (const [a, b] of tri) cons.addPrior(a, b);
    const polished = polishConstrained(g, cons, { seed: 1, iters: 4000, priorWeight: 100 }).graph;
    expect(isConnected(polished)).toBe(true);
  });
});

describe("prior weight preserves churn buddies", () => {
  it("a high prior weight keeps more prior buddies than zero weight", () => {
    const n = 60;
    const k = 4;
    const base = constrainedGreedy(n, k, new Constraints(n), { minSeparation: 5 });
    const cons = new Constraints(n);
    for (const [a, b] of base.edgeList()) cons.addPrior(a, b);
    const total = cons.priorCount;

    const keptWith = (weight: number) => {
      const g = polishConstrained(base, cons, {
        seed: 7,
        iters: 6000,
        priorWeight: weight,
      }).graph;
      return cons.priorPairs().filter(([a, b]) => g.hasEdge(a, b)).length;
    };

    const keptLow = keptWith(0);
    const keptHigh = keptWith(50);

    expect(keptHigh).toBeGreaterThanOrEqual(keptLow);
    expect(keptHigh / total).toBeGreaterThan(0.9);
  });
});

describe("buildConstrainedBuddyGraph pipeline", () => {
  it("refuses impossible input with reasons and no graph", () => {
    const c = new Constraints(6);
    c.require(0, 1).require(0, 2).require(0, 3);
    const r = buildConstrainedBuddyGraph(6, 2, c);
    expect(r.report.satisfied).toBe(false);
    expect(r.report.refusals.length).toBeGreaterThan(0);
    expect(r.edges).toEqual([]);
  });

  it("generates a satisfying graph and reports it", () => {
    const c = new Constraints(30);
    c.require(0, 1).prohibit(2, 3);
    const r = buildConstrainedBuddyGraph(30, 4, c, { seed: 0 });
    expect(r.report.satisfied).toBe(true);
    expect(r.report.reqViolations).toBe(0);
    expect(r.report.prohViolations).toBe(0);
    expect(r.report.refusals).toEqual([]);
    // a satisfied graph is connected, so the whole roster is one group
    expect(r.report.connected).toBe(true);
    expect(r.report.largestComponentFraction).toBe(1);
    expect(r.buddies[0]).toContain(1);
  });

  it("promotes hard priors to required edges", () => {
    const c = new Constraints(30);
    c.addPrior(0, 15).addPrior(7, 22);
    c.priorHard = true;
    const r = buildConstrainedBuddyGraph(30, 4, c, { seed: 0 });
    expect(r.buddies[0]).toContain(15);
    expect(r.buddies[7]).toContain(22);
    expect(r.report.priorsKeptFraction).toBe(1);
  });

  it("refuses a hard prior that is also prohibited (no prohibited edge slips in)", () => {
    const c = new Constraints(10);
    c.prohibit(0, 1).addPrior(0, 1);
    c.priorHard = true;
    const r = buildConstrainedBuddyGraph(10, 4, c, { seed: 0 });
    expect(r.report.refusals.length).toBeGreaterThan(0);
    expect(r.edges).toEqual([]);
    expect(r.buddies[0] ?? []).not.toContain(1);
    // refused input produced no graph: 0, not the empty-graph vacuous 1
    expect(r.report.largestComponentFraction).toBe(0);
  });

  it("refuses when hard priors push required degree over k", () => {
    const c = new Constraints(12);
    c.require(0, 1).addPrior(0, 2).addPrior(0, 3);
    c.priorHard = true;
    const r = buildConstrainedBuddyGraph(12, 2, c, { seed: 0 });
    expect(r.report.refusals.length).toBeGreaterThan(0);
    expect(r.edges).toEqual([]);
  });

  it("refuses out-of-range constraints without throwing", () => {
    const c = new Constraints(5);
    c.require(0, 99);
    const r = buildConstrainedBuddyGraph(5, 3, c);
    expect(r.report.refusals.length).toBeGreaterThan(0);
    expect(r.edges).toEqual([]);
  });

  it("refuses (not crashes) when n disagrees with the constraints' size", () => {
    const c = new Constraints(10);
    c.require(8, 9);
    const r = buildConstrainedBuddyGraph(3, 2, c);
    expect(r.report.refusals.length).toBeGreaterThan(0);
    expect(r.edges).toEqual([]);
  });

  it("never exceeds the buddy count k, even under heavy prohibition", () => {
    // person 0 free, everyone else mutually prohibited: can't all connect at k=2
    const c = new Constraints(20);
    for (let a = 1; a < 20; a++) {
      for (let b = a + 1; b < 20; b++) c.prohibit(a, b);
    }
    const r = buildConstrainedBuddyGraph(20, 2, c, { seed: 0 });
    expect(r.degreeMax).toBeLessThanOrEqual(2); // no runaway hub
    expect(r.report.prohViolations).toBe(0);
  });

  it("one stuck person does not starve the rest of the roster", () => {
    const n = 30;
    const k = 6;
    const c = new Constraints(n);
    for (const r of [10, 11, 12, 13, 14, 15]) c.require(5, r); // saturate person 5 to k
    for (let j = 0; j < n - 1; j++) if (j !== 5) c.prohibit(n - 1, j); // 29 can only reach (full) 5
    expect(validate(c, k)).toEqual([]); // validate can't see the degree-budget trap
    const r = buildConstrainedBuddyGraph(n, k, c, { polish: false, seed: 0 });
    // the bulk still get buddies — far above the ~n-1 edges of a starved run
    expect(r.edges.length).toBeGreaterThan(50);
    expect(r.degreeMax).toBe(k);
    // honest residual disconnection: 29 is stranded, the other 29 form one group.
    // This is the only report path that exercises the REAL largestComponentFraction
    // computation strictly inside (0,1) — a hardcoded constant would not survive it.
    expect(r.report.refusals).toEqual([]);
    expect(r.report.connected).toBe(false);
    expect(r.report.largestComponentFraction).toBeCloseTo(29 / 30, 12);
  });

  it("stays fast on a many-stuck sink-bottleneck (guards the cubic regression)", () => {
    const n = 400;
    const k = 4;
    const c = new Constraints(n);
    // half the roster can only reach the soon-saturated sink 0 => many stuck
    for (let v = 1; v <= n / 2; v++) {
      for (let w = 1; w < n; w++) if (w !== v) c.prohibit(v, w);
    }
    expect(validate(c, k)).toEqual([]);
    const t0 = Date.now();
    const r = buildConstrainedBuddyGraph(n, k, c, { polish: false });
    const ms = Date.now() - t0;
    expect(r.degreeMax).toBeLessThanOrEqual(k);
    expect(ms).toBeLessThan(1500); // ~0.13s in practice; a rescan regression is ~4.6s
  });
});

describe("constrainedGreedy precondition (always-on)", () => {
  it("throws a clear error on out-of-range or over-k input, even without validate", () => {
    const oob = new Constraints(5);
    oob.require(0, 99);
    expect(() => constrainedGreedy(5, 2, oob)).toThrow(/out of range/);

    const overK = new Constraints(6);
    overK.require(0, 1).require(0, 2).require(0, 3);
    expect(() => constrainedGreedy(6, 2, overK)).toThrow(/required buddies/);
  });

  it("throws a clear error on a self-pair or invalid n", () => {
    const selfPair = new Constraints(5);
    selfPair.require(2, 2);
    expect(() => constrainedGreedy(5, 3, selfPair)).toThrow(/themselves/);
    const badN = new Constraints(Number.NaN);
    expect(() => constrainedGreedy(Number.NaN, 2, badN)).toThrow(/valid count/);
    // A roster/constraints size disagreement, which the primitive alone did not refuse.
    // Endpoints were checked against `n` while the required-degree vector was sized by
    // `cons.n`, so with cons.n < n the vector had holes at exactly the vertices under test:
    // `undefined > k` is false, the required-degree refusal never fired, and the graph came
    // back exceeding k with the dev-mode postcondition compiled out in production.
    const small = new Constraints(3);
    small.require(0, 1).require(0, 2);
    expect(() => constrainedGreedy(8, 2, small)).toThrow(/does not match the constraints/);
  });
});

describe("connectivity is repaired by rewiring, not only by adding", () => {
  // `forceConnect` can only ADD an edge whose BOTH endpoints are under k, so a component whose
  // whole boundary is saturated cannot be joined however many legal pairs exist elsewhere — and
  // the comment that used to end the generator claimed residual disconnection "means the roster
  // cannot be connected within k buddies each", which is false. A degree-preserving double edge
  // swap reaches what an addition cannot, because it frees the degree it spends.
  it("connects the recorded witness, which validate accepts and completion split", () => {
    const cons = new Constraints(7);
    cons.prohibit(3, 5);
    cons.prohibit(3, 4);
    expect(validate(cons, 2)).toEqual([]); // the input is feasible, so a split is on us
    const g = constrainedGreedy(7, 2, cons);
    expect(connectedComponents(g)).toHaveLength(1);
    // The hard guarantees still hold: no prohibited edge, and nobody over k.
    for (const [a, b] of g.edgeList()) expect(cons.isProhibited(a, b)).toBe(false);
    expect(Math.max(...g.degrees())).toBeLessThanOrEqual(2);
    // ...through the builder too, with polish OFF so the repair is what did it. Auto-polish
    // happens to run at n=7 and would have hidden this, which is how the guarantee had become a
    // function of roster size.
    const built = buildConstrainedBuddyGraph(7, 2, cons, { polish: false });
    expect(built.report.connected).toBe(true);
    expect(built.report.largestComponentFraction).toBe(1);
  });

  it("leaves no split that a single constraint-preserving swap could have merged", () => {
    // The property, brute-forced: for every feasible input in the sweep whose result is still
    // disconnected, no degree-preserving double edge swap that keeps the hard constraints
    // reduces the component count. That is the exact condition the repair searches for, so a
    // residual split now means "no such swap exists", not "the algorithm cannot reach it".
    // The two shapes a 1,500-case cross-language sweep found still split after the repair, kept
    // as explicit witnesses so the brute force below is never vacuous, plus a deterministic
    // pseudo-random sweep around them.
    const witnesses: { n: number; k: number; proh: [number, number][] }[] = [
      { n: 4, k: 2, proh: [[1, 2], [1, 3], [2, 3]] },
      { n: 5, k: 2, proh: [[0, 1], [0, 2], [0, 4], [1, 2], [2, 4]] },
    ];
    let disconnected = 0;
    const check = (n: number, k: number, cons: Constraints): void => {
      const g = constrainedGreedy(n, k, cons);
      const comps = connectedComponents(g).length;
      if (comps === 1) return;
      disconnected++;
      const edges = g.edgeList();
      for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
          const [a, b] = edges[i];
          const [c, d] = edges[j];
          if (cons.isRequired(a, b) || cons.isRequired(c, d)) continue;
          for (const [x, y] of [[c, d], [d, c]] as const) {
            if (a === x || b === y || a === y || b === x) continue;
            if (g.hasEdge(a, x) || g.hasEdge(b, y)) continue;
            if (cons.isProhibited(a, x) || cons.isProhibited(b, y)) continue;
            const h = g.copy();
            h.removeEdge(a, b);
            h.removeEdge(c, d);
            h.addEdge(a, x);
            h.addEdge(b, y);
            expect(connectedComponents(h).length).toBeGreaterThanOrEqual(comps);
          }
        }
      }
    };
    for (const w of witnesses) {
      const cons = new Constraints(w.n);
      for (const [a, b] of w.proh) cons.prohibit(a, b);
      expect(validate(cons, w.k)).toEqual([]);
      check(w.n, w.k, cons);
    }
    for (let n = 4; n <= 12; n++) {
      for (let k = 2; k <= 3; k++) {
        for (let p = 0; p < 40; p++) {
          const cons = new Constraints(n);
          // Deterministic pseudo-random prohibitions — no RNG in the core's tests either.
          for (let t = 0; t < 4; t++) {
            const a = (p * 7 + t * 3) % n;
            const b = (p * 5 + t * 11 + 1) % n;
            if (a !== b) cons.prohibit(a, b);
          }
          if (validate(cons, k).length > 0) continue;
          check(n, k, cons);
        }
      }
    }
    // Not vacuous: the sweep must actually produce splits, or it proves nothing. The witnesses
    // above guarantee at least two even if the pseudo-random shapes all connect.
    expect(disconnected).toBeGreaterThan(1);
  }, 60_000);
});
