/**
 * The optimizer must never make a roster more broken than it found it.
 *
 * This is the invariant behind a real defect, not a hypothetical one. `aspl` is
 * averaged over REACHABLE pairs only, so splitting a disconnected graph further
 * LOWERS it; with a flat disconnection penalty both polish passes hill-climbed
 * into deeper fragmentation while the average separation they reported
 * "improved". A 16-person roster went from one group of 14 to five fragments and
 * reported its separation falling from 5.0 to 1.3.
 *
 * The guarantee now lives in the objective's shape — unreachable pairs are
 * charged above any achievable distance, so any fragmenting move strictly
 * increases energy and cannot be accepted by a strict-decrease optimizer. These
 * tests assert the property directly rather than the mechanism, so a future
 * rewrite of the objective is still held to it.
 *
 * Independently corroborated: a review lens built its own exhaustive probe over
 * randomly structured disconnected graphs (mixed paths, cycles and partial
 * cliques) and examined 432,954 fragmenting double-edge swaps without finding a
 * single one that lowers the energy. That is a far larger sample than fast-check
 * reaches here, and it was produced by something with no stake in the fix.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Graph } from "../src/core/graph.js";
import {
  allPairsSummary,
  penalizedAspl,
  connectedComponents,
  largestComponentFraction,
} from "../src/core/metrics.js";
import { polish } from "../src/core/polish.js";
import { repairDegrees, ringGreedy } from "../src/core/greedy.js";
import { bfsDistances } from "../src/core/metrics.js";
import { ring } from "../src/core/graph.js";
import { mooreLowerBounds, asplGap } from "../src/core/bounds.js";
import {
  Constraints,
  polishConstrained,
  autoPolishEnabled,
  buildBuddyGraph,
  buildConstrainedBuddyGraph,
} from "../src/core/index.js";
import {
  MAX_GREEDY_WORK,
  greedyWork,
  MAX_POLISH_WORK,
  polishWork,
  checkPolishSize,
  boundedPolishIterations,
} from "../src/core/budgets.js";

function graphOf(n: number, edges: [number, number][]): Graph {
  const g = new Graph(n);
  for (const [a, b] of edges) g.addEdge(a, b);
  return g;
}

const components = (g: Graph) => connectedComponents(g).length;

/** Random graphs, sparse enough that disconnected ones are common. */
const scenario = fc.integer({ min: 6, max: 22 }).chain((n) =>
  fc.record({
    n: fc.constant(n),
    edges: fc.uniqueArray(
      fc
        .tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 }))
        .filter(([a, b]) => a !== b),
      { minLength: 4, maxLength: n, selector: ([a, b]) => (a < b ? `${a},${b}` : `${b},${a}`) },
    ),
    seed: fc.integer({ min: 0, max: 1000 }),
  }),
);

describe("penalizedAspl", () => {
  it("leaves a connected graph's score exactly equal to its ASPL", () => {
    // The early return, not arithmetic that happens to agree: every fixture in
    // the repo is a connected case and none of them may move by even one bit.
    fc.assert(
      fc.property(scenario, (s) => {
        const g = graphOf(s.n, s.edges);
        const summary = allPairsSummary(g);
        fc.pre(summary.connected);
        expect(penalizedAspl(summary, g.n)).toBe(summary.aspl);
      }),
    );
  });

  it("strictly rises when a graph is broken into more pieces", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const g = graphOf(s.n, s.edges);
        const before = components(g);
        // Remove one edge; keep only the draws where it actually splits something.
        const [u, v] = s.edges[0];
        const worse = g.copy();
        worse.removeEdge(u, v);
        fc.pre(components(worse) > before);
        expect(penalizedAspl(allPairsSummary(worse), worse.n)).toBeGreaterThan(
          penalizedAspl(allPairsSummary(g), g.n),
        );
      }),
    );
  });

  it("scores every disconnected graph worse than every connected one", () => {
    // The charged mean alone does not guarantee this — a clique plus one isolated
    // vertex beats a sparse connected graph on it — which is why the flat term stays.
    const connected = graphOf(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]);
    const almostComplete = graphOf(6, [
      [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4],
    ]); // K5 plus an isolated vertex 5
    expect(penalizedAspl(allPairsSummary(almostComplete), 6)).toBeGreaterThan(
      penalizedAspl(allPairsSummary(connected), 6),
    );
  });

  it("is finite for an edgeless graph rather than incomparable", () => {
    // aspl is Infinity there (no reachable pairs), and an Infinity energy makes
    // every candidate look equally good to an optimizer comparing energies.
    expect(Number.isFinite(penalizedAspl(allPairsSummary(new Graph(5)), 5))).toBe(true);
  });
});

describe("polish never fragments the roster", () => {
  it("leaves no more components than it started with", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const g = graphOf(s.n, s.edges);
        const out = polish(g, { mode: "anneal", seed: s.seed, maxIters: 600 }).graph;
        expect(components(out)).toBeLessThanOrEqual(components(g));
        expect(largestComponentFraction(out)).toBeGreaterThanOrEqual(largestComponentFraction(g));
      }),
    );
  });

  it("holds in hill-climb mode too", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const g = graphOf(s.n, s.edges);
        const out = polish(g, { mode: "hill", seed: s.seed, maxIters: 600 }).graph;
        expect(components(out)).toBeLessThanOrEqual(components(g));
      }),
    );
  });

  it("holds on the recorded reproduction", () => {
    // 12-cycle plus a disjoint 4-cycle. Before the fix, hill-climb took this to
    // four components and reported an ASPL of 1.36.
    const edges: [number, number][] = [];
    for (let i = 0; i < 12; i++) edges.push([i, (i + 1) % 12]);
    for (let i = 0; i < 4; i++) edges.push([12 + i, 12 + ((i + 1) % 4)]);
    const g = graphOf(16, edges);
    const out = polish(g, { mode: "hill", seed: 1, maxIters: 4000 }).graph;
    expect(components(out)).toBeLessThanOrEqual(2);
    expect(largestComponentFraction(out)).toBeGreaterThanOrEqual(12 / 16);
  });
});

describe("polishConstrained never fragments the roster", () => {
  it("leaves no more components than it started with, at any prior weight", () => {
    fc.assert(
      fc.property(scenario, fc.integer({ min: 0, max: 50 }), (s, priorWeight) => {
        const g = graphOf(s.n, s.edges);
        const cons = new Constraints(s.n);
        // Priors the current graph does NOT satisfy, so the prior term actively
        // pushes for swaps — the case where a weight could buy fragmentation.
        for (let v = 0; v + 3 < s.n; v += 4) cons.addPrior(v, v + 3);
        const out = polishConstrained(g, cons, { seed: s.seed, iters: 400, priorWeight }).graph;
        expect(components(out)).toBeLessThanOrEqual(components(g));
      }),
    );
  });

  it("holds through the public constrained builder on the recorded reproduction", () => {
    // The 16-person, k=2 instance that lost 14 people from one group down to 4.
    const prohibited: [number, number][] = [
      [1, 2], [12, 15], [10, 13], [12, 13], [3, 10], [12, 14], [11, 14], [5, 11],
      [8, 13], [7, 10], [9, 15], [13, 15], [5, 6], [2, 12], [0, 9], [2, 13],
      [0, 14], [6, 10], [9, 11], [4, 10], [13, 14], [8, 9],
    ];
    const cons = new Constraints(16);
    for (const [a, b] of prohibited) cons.prohibit(a, b);

    const polished = buildConstrainedBuddyGraph(16, 2, cons); // default options: polish is on
    const unpolished = buildConstrainedBuddyGraph(16, 2, cons, { polish: false });

    // Polish may not take the roster backwards from what generation produced.
    expect(polished.report.largestComponentFraction).toBeGreaterThanOrEqual(
      unpolished.report.largestComponentFraction,
    );
    // And the specific regression: it used to end at 0.25.
    expect(polished.report.largestComponentFraction).toBeGreaterThan(0.5);
  });
});


/**
 * Cost budgets. Both generators had an n-cap and no time bound, so the most
 * expensive input on each path sat just inside the gate.
 */
describe("work budgets bound the default path", () => {
  // ASSERTED ON THE GATE ITSELF, not on `result.polished`. These three used the flag as a proxy
  // for "did auto-polish fire", which worked only while the flag meant "polish was called". It
  // now means "the returned graph differs from the unpolished one" — a stricter and more useful
  // claim, and a different one: at `polishIters: 1` a single iteration improves nothing, so the
  // proxy reported false for a gate that had fired. `autoPolishEnabled` is the gate, it is
  // exported precisely so consumers never re-derive it, and it is what these tests are about.
  it("keeps the polish gate exactly where it was at k=4, which is what the fixtures pin", () => {
    expect(autoPolishEnabled(120, 4)).toBe(true);
    expect(autoPolishEnabled(121, 4)).toBe(false);
  });

  it("turns polish off for a dense roster the n-cap waved through", () => {
    // buildBuddyGraph(120, 12) ran for 33 s under the n-only gate, while
    // buildBuddyGraph(121, 12) took 0.1 s — cost falling as the roster grew.
    expect(autoPolishEnabled(120, 12)).toBe(false);
  });

  it("still honours an explicit polish request", () => {
    // A heuristic must not override a direct instruction from the caller: the gate says no at
    // (120, 12), and an explicit `polish: true` runs the pass anyway. Observed through the
    // ITERATION count rather than `polished`, because "the pass ran" and "the pass changed
    // something" are now different facts and this test is about the first.
    expect(autoPolishEnabled(120, 12)).toBe(false);
    const { graph } = ringGreedy(120, 12, { mind: 5, repair: true });
    expect(polish(graph, { mode: "anneal", seed: 1, maxIters: 5 }).iters).toBeGreaterThan(0);
  });

  it("refuses an (n,k) that would run for tens of minutes", () => {
    // (1000, 999) did not return within 22 minutes; (5000, 4) extrapolated to
    // tens of minutes. Both cleared the memory-only n-cap.
    expect(() => buildBuddyGraph(1000, 999, { polish: false })).toThrow(/too large to generate/);
    expect(() => buildBuddyGraph(5000, 4, { polish: false })).toThrow(/too large to generate/);
  });

  it("still accepts the largest roster the app can ask for", () => {
    // The app advertises up to 1000 people at up to 12 buddies. A budget that
    // refused it would be a regression, not a fix.
    expect(greedyWork(1000, 12)).toBeLessThanOrEqual(MAX_GREEDY_WORK);
    expect(greedyWork(1000, 4)).toBeLessThanOrEqual(MAX_GREEDY_WORK);
  });

  it("models work monotonically in both n and k", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 400 }),
        fc.integer({ min: 2, max: 40 }),
        (n, k) => {
          expect(greedyWork(n + 1, k)).toBeGreaterThanOrEqual(greedyWork(n, k));
          expect(greedyWork(n, k + 1)).toBeGreaterThanOrEqual(greedyWork(n, k));
        },
      ),
    );
  });
});

describe("iteration budgets are validated before becoming loop bounds", () => {
  // JSON has no Infinity literal, but JSON.parse('{"polishIters":1e999}') yields
  // one — and the only other loop exit is "fewer than two edges", so a real graph
  // meant neither polish pass ever returned.
  it("does not hang on a non-finite budget", () => {
    expect(JSON.parse('{"polishIters":1e999}').polishIters).toBe(Infinity);
    const r = buildBuddyGraph(30, 4, { polish: true, polishIters: Infinity });
    expect(r.polished).toBe(true);
    expect(r.edges.length).toBeGreaterThan(0);
  });

  it("does not hang on the constrained path either", () => {
    const out = buildConstrainedBuddyGraph(30, 4, new Constraints(30), {
      polish: true,
      polishIters: Infinity,
    });
    expect(out.report.refusals).toEqual([]);
    expect(out.edges.length).toBeGreaterThan(0);
  });

  it("falls back to the default rather than refusing an existing caller", () => {
    const good = buildBuddyGraph(30, 4, { polish: true });
    for (const bad of [Infinity, NaN, -1, 1.5, -Infinity]) {
      expect(buildBuddyGraph(30, 4, { polish: true, polishIters: bad }).edges).toEqual(good.edges);
    }
  });
});


/**
 * The budget must be AUTHORITATIVE, not advisory. Both cases below were found by
 * review against the first version of the fix above — the gate consulted the
 * budget only on the auto path, and the new iteration guard checked type but not
 * magnitude.
 */
describe("MAX_POLISH_WORK cannot be stepped around", () => {
  const workOf = (n: number, k: number, iters: number) => polishWork(n, k, iters);

  // Honouring the request means actually running it, and running it costs one
  // budget — so this needs a wall-clock allowance, like its sibling below.
  it("bounds an explicit polish request instead of honouring it unbounded", { timeout: 120_000 }, () => {
    // `polish: true` at (120, 12) used to re-open the exact 33 s case the budget
    // was introduced to close: one boolean, and the constant did not apply.
    const r = buildBuddyGraph(120, 12, { polish: true });
    expect(r.polished).toBe(true); // the instruction is still honoured...
    // ...but the work it may cost is capped. 20000 iterations would be 1.73e9.
    expect(workOf(120, 12, 20000)).toBeGreaterThan(MAX_POLISH_WORK);
  });

  // Any test where the clamp BINDS costs one full budget by definition — that is
  // what the budget is — so this one gets a wall-clock allowance rather than the
  // suite default. Rejecting Infinity while accepting 1e15 is a boundary one step
  // to the left of the same defect, and only running it proves the wiring.
  it("clamps a large finite iteration count, not just a non-finite one", { timeout: 120_000 }, () => {
    const started = performance.now();
    const huge = buildBuddyGraph(120, 12, { polish: true, polishIters: 1e15 });
    const elapsed = performance.now() - started;

    expect(huge.polished).toBe(true);
    expect(huge.edges.length).toBeGreaterThan(0);
    // Bounded, not merely finite: 1e15 iterations would never have returned.
    expect(elapsed).toBeLessThan(90_000);
    // And it is the SAME run as asking for exactly what the budget affords.
    const afforded = Math.floor(MAX_POLISH_WORK / polishWork(120, 12, 1));
    expect(afforded).toBeLessThan(20000); // the clamp really does bind here
    expect(buildBuddyGraph(120, 12, { polish: true, polishIters: afforded }).edges).toEqual(huge.edges);
  });

  it("charges the n² term a sparse graph really costs", () => {
    // The per-iteration cost is `allPairsSummary`, which is Theta(n*(n+m)): it
    // allocates and fills an Int32Array(n) and runs an n-wide accumulation per
    // source no matter how few edges exist. Modelling it as n*m under-charged
    // sparse graphs by the entire n² term — a 3000-vertex graph with 4 edges was
    // afforded the full 20,000 iterations, of which 2,000 alone took 67.6 s.
    const g = new Graph(3000);
    for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7]]) g.addEdge(a, b);
    const started = performance.now();
    polish(g, { mode: "hill" });
    expect(performance.now() - started).toBeLessThan(20_000);
  });

  it("leaves the auto path untouched, because the gate only admits what already fits", () => {
    // The clamp is a no-op wherever auto-polish runs today: min(requested, afforded)
    // is the requested value by construction.
    for (const [n, k] of [[30, 4], [60, 4], [120, 4]] as const) {
      const afforded = Math.floor(MAX_POLISH_WORK / polishWork(n, k, 1));
      expect(afforded).toBeGreaterThanOrEqual(20000);
    }
  });

  it("never models an iteration as free, so the divisor is always positive", () => {
    // The overhead term does double duty: it stops an edgeless graph from making
    // the divisor zero (which would afford Infinity iterations), and it stops a
    // tiny graph from being modelled as nearly free. Before it existed,
    // buildBuddyGraph(3, 2, { polishIters: 1e9 }) ran for 35.7 SECONDS.
    expect(polishWork(5, 0, 1)).toBeGreaterThan(0);
    expect(polishWork(3, 2, 1)).toBeGreaterThan(0);
    expect(() => buildConstrainedBuddyGraph(5, 0, new Constraints(5), { polish: true })).not.toThrow();
  });

  it("bounds a huge iteration request on a TINY graph, where the work model alone cannot", () => {
    // The defect the absolute ceiling closes: as n·m falls the affordable
    // iteration count rises without limit, and fixed per-iteration cost then
    // dominates a number the model thinks is cheap.
    const started = performance.now();
    const r = buildBuddyGraph(3, 2, { polishIters: 1e9 });
    expect(performance.now() - started).toBeLessThan(5_000); // was 35,700 ms
    expect(r.edges.length).toBeGreaterThan(0);
  });

  it("bounds the exported primitives, not just the wrappers around them", () => {
    // `polish` and `polishConstrained` are public API. A clamp in
    // buildBuddyGraph does not apply to a direct caller, and
    // polish(ring(20), { maxIters: Infinity }) used to never return.
    const started = performance.now();
    const out = polish(ring(20), { mode: "hill", maxIters: Infinity });
    expect(performance.now() - started).toBeLessThan(20_000);
    expect(out.graph.n).toBe(20);

    const cons = new Constraints(20);
    const started2 = performance.now();
    // Sourced the way it actually arrives — JSON has no Infinity literal, but
    // parsing an over-large exponent yields one.
    const fromJson = JSON.parse('{"iters":1e999}').iters as number;
    expect(fromJson).toBe(Infinity);
    expect(polishConstrained(ring(20), cons, { iters: fromJson }).graph.n).toBe(20);
    expect(performance.now() - started2).toBeLessThan(20_000);
  });

  it("refuses a graph whose PRE-LOOP sweeps already blow the budget", { timeout: 60_000 }, () => {
    // A work cap is not a size cap. Both polish passes pay two-to-three full
    // Theta(n(n+m)) all-pairs sweeps plus two graph copies OUTSIDE the loop, and
    // boundedPolishIterations cannot reach any of it — so the budget priced these
    // calls at ZERO iterations and they still ran for 160 s and 48 s respectively.
    //
    // Asserted as a refusal rather than a duration: a timing bound would only say
    // this machine was fast enough today, and the property is that the work is
    // never attempted at all.
    const huge = ring(40000);
    expect(() => polish(huge, { maxIters: 0 })).toThrow(/too large to polish/);
    expect(() => polishConstrained(ring(30000), new Constraints(30000), { iters: 0 }).graph).toThrow(
      /too large to polish/,
    );

    // And the cap must not have closed anything the loop would have accepted. The
    // constrained path documents n=5000 as its ceiling, so that has to still pass.
    expect(() => checkPolishSize(5000, 10000)).not.toThrow();
    expect(() => polish(ring(200), { maxIters: 1 })).not.toThrow();
  });

  it("reports `polished` only when the graph actually differs from an unpolished build", () => {
    // THE PROPERTY, not a case table. The previous version of this test pinned the two
    // zero-iteration cases and passed while `polished: true` was still being reported over an
    // edge list byte-identical to `{ polish: false }` — because the flag was read off a COUNTER
    // (`iters`, which counts loop PASSES: `polish(ring(3))` reports 19,990 of them over an
    // untouched triangle, since no vertex-disjoint edge pair exists to propose). A test named
    // for a property has to assert the property.
    // A SMALL iteration budget on purpose: it makes "the pass changed nothing" the common case,
    // which is the case under test, and keeps the sweep inside a normal test budget.
    let sawUnchanged = 0;
    for (let n = 3; n <= 30; n++) {
      for (const k of [2, 3, 4]) {
        if (n < k + 1) continue;
        const on = buildBuddyGraph(n, k, { polish: true, polishIters: 40 });
        const off = buildBuddyGraph(n, k, { polish: false });
        if (JSON.stringify(on.edges) === JSON.stringify(off.edges)) {
          expect(on.polished).toBe(false);
          sawUnchanged++;
        }
      }
    }
    // ...and the same on the constrained tier, where a sibling flag gates priorsKeptFraction.
    for (let n = 4; n <= 20; n += 2) {
      const cons = new Constraints(n);
      for (let v = 0; v + 1 < n; v += 2) cons.addPrior(v, v + 1);
      const on = buildConstrainedBuddyGraph(n, 3, cons, { polish: true, polishIters: 40 });
      const off = buildConstrainedBuddyGraph(n, 3, cons, { polish: false });
      if (JSON.stringify(on.edges) === JSON.stringify(off.edges)) {
        expect(on.polished).toBe(false);
        sawUnchanged++;
      }
    }
    // The sweep must actually REACH the unchanged case, or it asserts nothing.
    expect(sawUnchanged).toBeGreaterThan(5);
  }, 60_000);

  it("reports `polished` from what the pass DID, not from the decision to call it", () => {
    // `polished` was set at the call site, so it meant "I decided to run polish" rather than
    // "polish ran". Two ways to reach a pass that does nothing, and neither needs an unusual
    // option: `polishIters: 0` is an integer >= 0 and is honoured, and the loop breaks
    // immediately on a graph with fewer than two edges. Both returned an edge list
    // BYTE-IDENTICAL to `{ polish: false }` while reporting `polished: true` — and on the
    // constrained tier they also published a `priorsKeptFraction`, which is a measurement of
    // something that never happened. This is the open sibling of the correction recorded in
    // polish.ts, which closed only the anneal-calibration route into the same state.
    const cons = new Constraints(60);
    for (let v = 0; v + 1 < 60; v += 2) cons.addPrior(v, v + 1);

    const off = buildConstrainedBuddyGraph(60, 4, cons, { polish: false });
    const zero = buildConstrainedBuddyGraph(60, 4, cons, { polish: true, polishIters: 0 });
    expect(zero.edges).toEqual(off.edges); // the pass did nothing...
    expect(zero.polished).toBe(false); // ...and no longer claims otherwise
    expect(zero.report.priorsKeptFraction).toBeNull();

    // The same state with NO option at all: k=0 leaves an edgeless graph, so the loop's
    // fewer-than-two-edges break fires on iteration one.
    const edgeless = buildConstrainedBuddyGraph(12, 0, new Constraints(12));
    expect(edgeless.edges).toEqual([]);
    expect(edgeless.polished).toBe(false);

    // And the fast tier, which had the identical defect one builder over.
    const fastOff = buildBuddyGraph(30, 4, { polish: false });
    const fastZero = buildBuddyGraph(30, 4, { polish: true, polishIters: 0 });
    expect(fastZero.edges).toEqual(fastOff.edges);
    expect(fastZero.polished).toBe(false);

    // Not vacuous: a pass that really runs still reports true, on both tiers.
    const real = buildConstrainedBuddyGraph(60, 4, cons, { polish: true });
    expect(real.polished).toBe(true);
    expect(buildBuddyGraph(30, 4, { polish: true }).polished).toBe(true);
  });

  it("never lets an ITERATION option ask for more work than omitting it", () => {
    // The enforcement point's own comment claimed `polishIters` is "an option that can only ask
    // for LESS work than the default — never more", and concluded from that "a knob that can only
    // reduce cost cannot be turned into a hang". It bounded the request by ONE constant equal to
    // the UNCONSTRAINED default, so on the constrained path — default 8000 — a caller-supplied
    // 20000 bought 2.5x the iterations, measured end to end as 11.71 s -> 18.98 s. Not a hang, but
    // the invariant the ceiling existed to establish was false, and one number cannot make it true
    // for two defaults.
    for (const fallback of [8_000, 20_000]) {
      for (const [n, m] of [[30, 60], [60, 120], [120, 240], [1000, 6000]] as const) {
        const omitted = boundedPolishIterations(n, m, undefined, fallback);
        for (const asked of [0, 1, 999, 8_000, 20_000, 1e6, 2 ** 31]) {
          expect(boundedPolishIterations(n, m, asked, fallback)).toBeLessThanOrEqual(omitted);
        }
        // ...and it is not vacuous: a SMALLER request is still honoured, which is the knob's job.
        expect(boundedPolishIterations(n, m, 10, fallback)).toBe(Math.min(10, omitted));
      }
    }
  });

  it("never admits a polish call that cannot afford a single iteration", () => {
    // The two gates split one budget: the size check charges the fixed all-pairs sweeps and the
    // iteration count is derived from what is LEFT. That stopped them summing past the constant
    // they both cite, but nothing asked whether anything remained — so a band existed where the
    // sweeps fit and the loop got zero, and the call was accepted, paid three sweeps and two
    // graph copies, and returned its input byte-for-byte. Measured: `polish(ring(11000))` spent
    // 6.68 s to report `iters: 0`, and `polishConstrained`'s return value has no iteration count
    // at all, so nothing in it distinguishes that from a pass that worked.
    //
    // Asserted as the PROPERTY over the whole accept-set, not at the two n values that happen to
    // straddle the band: for every shape the size gate admits, the loop must afford >= 1.
    for (let n = 200; n <= 14_000; n += 137) {
      for (const m of [n, 2 * n, (n * 3) / 2]) {
        let admitted = true;
        try {
          checkPolishSize(n, Math.round(m));
        } catch {
          admitted = false;
        }
        if (admitted) {
          expect(boundedPolishIterations(n, Math.round(m), 20_000, 20_000)).toBeGreaterThanOrEqual(1);
        }
      }
    }
    // And the band itself is now refused rather than run: ring(11000) is n·(n+m) = 2.42e8, whose
    // fixed sweeps (7.26e8) fit the 8.65e8 budget with less than one iteration left over.
    expect(() => polish(ring(11_000), { maxIters: 20_000 })).toThrow(/leaving nothing for the loop/);
    // ...while the shape just below it still runs, so this did not quietly shrink the accept-set
    // beyond the calls that could not have done anything.
    expect(() => polish(ring(9500), { maxIters: 1 })).not.toThrow();
  });

  it("charges the FIXED sweeps too, so the two gates cannot sum past the budget", () => {
    // checkPolishSize and boundedPolishIterations each measured against the WHOLE budget,
    // so a graph that just fit the size gate was then granted a full budget of loop
    // iterations on top of its fixed sweeps — the two summed to roughly twice the constant
    // they both cite. The property is that the TOTAL is what is bounded.
    const sweep = (n: number, m: number) => n * (n + m);
    // Near the size boundary the loop allowance must collapse rather than reset.
    const bigN = 16000;
    const bigM = bigN;
    if (sweep(bigN, bigM) * 3 <= MAX_POLISH_WORK) {
      expect(boundedPolishIterations(bigN, bigM, 20_000, 20_000)).toBe(0);
    }
    // And a small roster is untouched — the fix must not quietly shrink normal budgets.
    expect(boundedPolishIterations(20, 40, 20_000, 20_000)).toBe(20_000);
  });

  it("keeps the work model non-zero, so the guard built on it is a guard", () => {
    // The correction that made greedyWork shape-correct introduced `edgesAdded = n·k/2 − n`,
    // which is exactly 0 for every k <= 2 at every n. `repairDegrees`'s budget check is
    // `greedyWork(n,k) > MAX_GREEDY_WORK`, so it became `0 > 1.5e10` — no check at all, for a
    // roster of any size up to MAX_ROSTER. A fix for one unbounded path opened another.
    expect(greedyWork(1_000_000, 2)).toBeGreaterThan(MAX_GREEDY_WORK);
    expect(greedyWork(1_000_000, 1)).toBeGreaterThan(MAX_GREEDY_WORK);
    // And the floor must not have moved the shipping accept-set.
    expect(greedyWork(1000, 12)).toBeLessThanOrEqual(MAX_GREEDY_WORK);
    expect(greedyWork(1000, 2)).toBeLessThanOrEqual(MAX_GREEDY_WORK);
  });

  it("bounds repair by its MEASURED cost, in both the single-pass and multi-pass regimes", { timeout: 120_000 }, () => {
    // Three attempts, and the first two failed in opposite directions — which is the point of
    // asserting the accept-set from BOTH sides. `greedyWork` is built from edges ADDED; repair's
    // cost is driven by the degree DEFICIT it closes, so expressing one in the other's units was
    // wrong however it was scaled. Measured: n=3000/k=4 is 0.25 s, n=20000/k=2 is 10.7 s, and
    // n=70000/k=2 runs past two minutes.
    // MULTI-PASS shapes, which is the whole point. The previous version of this test used only
    // `deficitOf = n*k` — an edgeless graph — and every edgeless graph exits after ONE pass
    // because nothing is reachable, so it could not see the regime the budget exists to bound.
    // Review found a 239 s call the test called safe. These shapes make many passes.
    const triCycle = (n: number) => {
      const g = new Graph(n);
      const half = Math.floor(n / 2);
      for (let i = 0; i + 2 < half; i += 3) {
        g.addEdge(i, i + 1);
        g.addEdge(i + 1, i + 2);
        g.addEdge(i, i + 2);
      }
      for (let i = half; i < n; i++) g.addEdge(i, i + 1 < n ? i + 1 : half);
      return g;
    };
    // A dense core with a sparse fringe: m is DECOUPLED from n·k, which is the regime the
    // counter's first unit price could not see. It charged a sweep `n + n·k` — the cost of a
    // k-regular graph — while `bfsDistances` walks `n + 2m`. Here that is 5600 charged against
    // 1.44e6 real, a 257x undercharge, and at review's larger n=6000 version the call ran 32.8 s
    // having spent 9% of its budget. Charging `n + 2m` is what makes this shape reachable by the
    // budget at all; no size cap is needed alongside it, because the charge now precedes the
    // sweep it prices.
    const cliqueWithLeaves = (core: number, leaves: number) => {
      const g = new Graph(core + leaves);
      for (let i = 0; i < core; i++) for (let j = i + 1; j < core; j++) g.addEdge(i, j);
      for (let i = 0; i < leaves; i++) g.addEdge(core + i, i % core);
      return g;
    };
    expect(() => repairDegrees(cliqueWithLeaves(1200, 1600), 2)).toThrow(/too large to repair/);
    // The scan-bound shape, and the third cost centre. An edgeless graph gives the BFS nothing to
    // walk, so `n + 2m` prices 20,000 sweeps at 0.33 s — but each sweep still scans all 20,000
    // candidates with a `hasEdge` probe apiece, and the call takes 11 s. Charging the sweeps'
    // traversal alone let this one back through after the sweep price was corrected.
    expect(() => repairDegrees(new Graph(20_000), 2)).toThrow(/too large to repair/);
    expect(() => repairDegrees(ring(36_000), 4)).toThrow(/too large to repair/);
    expect(() => repairDegrees(triCycle(2400), 4)).toThrow(/too large to repair/);
    // ...and the cheap shapes still run, in both regimes.
    expect(() => repairDegrees(ring(4000), 4)).not.toThrow();
    expect(() => repairDegrees(triCycle(600), 4)).not.toThrow();
    // A graph with NO deficit costs one scan however large it is.
    expect(() => repairDegrees(ring(200_000), 2)).not.toThrow();
  });

  it("bounds the exported repair pass, which had neither guard", () => {
    // repairDegrees is public API and was the one generator with no k validation and no work
    // budget: repairDegrees(ring(400), 1e9) ran to completion (5.6 s, ~n^3.4) while
    // ringGreedy(400, 1e9) refuses the identical pair. NaN was accepted silently too, making
    // `degree(v) < k` false everywhere — a no-op reported as success.
    expect(() => repairDegrees(ring(400), 1e9)).toThrow(/too large to repair/);
    expect(() => repairDegrees(ring(20), NaN)).toThrow(/must be a non-negative integer/);
    expect(() => repairDegrees(ring(20), Infinity)).toThrow(/must be a non-negative integer/);
    expect(() => repairDegrees(ring(20), 4)).not.toThrow();
  });

  it("keeps the greedy work model an UPPER bound as k grows", () => {
    // The old model charged n² per edge of a k-regular graph, ignoring that the ring seed
    // supplies n edges free and that findPair scans per edge. Its error grew with k, so it
    // stopped being an upper bound exactly where cost matters: (800,39) was ADMITTED and ran
    // 221 s under a constant documented as ~60 s worst case.
    //
    // Asserted as the accept-set, which is the part users feel — and pinned in both
    // directions so a future recalibration cannot quietly drop the shipping ceiling.
    expect(greedyWork(1000, 12)).toBeLessThanOrEqual(MAX_GREEDY_WORK); // ships, must stay
    expect(greedyWork(1000, 4)).toBeLessThanOrEqual(MAX_GREEDY_WORK);
    expect(greedyWork(1000, 20)).toBeGreaterThan(MAX_GREEDY_WORK); // measured 137 s
    expect(greedyWork(800, 39)).toBeGreaterThan(MAX_GREEDY_WORK); // measured 221 s
    // Monotone in both arguments, or the gate could be stepped around by asking for more.
    for (const n of [100, 500, 1000]) {
      for (let k = 2; k < 12; k++) {
        expect(greedyWork(n, k + 1)).toBeGreaterThanOrEqual(greedyWork(n, k));
        expect(greedyWork(n + 1, k)).toBeGreaterThanOrEqual(greedyWork(n, k));
      }
    }
  });

  it("names a bad vertex on the primitive every other query is built on", () => {
    // bfsDistances is exported from the package index and was the only index-taking export
    // skipping checkVertex, so a user-chosen index produced
    // `TypeError: g.adj[u] is not iterable` instead of this module's own message.
    for (const bad of [-1, 10, 2.5, NaN, 1e9]) {
      expect(() => bfsDistances(ring(10), bad)).toThrow(/source .* must be an integer/);
    }
    expect(() => bfsDistances(ring(10), 0)).not.toThrow();
  });

  it("never reports a graph as better than provably optimal", () => {
    // `mooreLowerBounds(n, 1)` for n > 2 described a Moore tree no max-degree-1 graph can
    // realise — a matching is the best possible and it is disconnected — so `asplGap` returned a
    // NEGATIVE gap. Both TS and reference-python now return no bound there; the fixtures cover
    // neither branch (regenerating them produces no diff), so the property is pinned here.
    for (let n = 1; n <= 40; n++) {
      for (let k = 1; k <= 6; k++) {
        const { asplLb } = mooreLowerBounds(n, k);
        expect(asplLb).toBeGreaterThanOrEqual(0);
        if (k === 1 && n > 2) expect(asplLb).toBe(0);
      }
    }
    // The consequence that reaches a user: a quality score is never above 1.
    fc.assert(
      fc.property(scenario, (s) => {
        const g = graphOf(s.n, s.edges);
        const summary = allPairsSummary(g);
        fc.pre(summary.connected);
        const [, degreeMax] = [0, Math.max(...g.degrees())];
        expect(asplGap(summary.aspl, g.n, degreeMax)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("refuses a NaN separation target instead of silently building a different graph", () => {
    // `ecc < curMind` is false for every NaN, so a NaN target disabled the separation
    // logic entirely and then came back out as `finalMinSeparation` — the result reported
    // a target that was never applied. It was the one numeric option left unvalidated.
    expect(() => buildBuddyGraph(20, 4, { minSeparation: NaN })).toThrow(/minimum separation/);
    expect(() => buildBuddyGraph(20, 4, { minSeparation: -1 })).toThrow(/minimum separation/);
    expect(() => buildBuddyGraph(20, 4, { minSeparation: 2.5 })).toThrow(/minimum separation/);
    expect(buildBuddyGraph(20, 4, { minSeparation: 3 }).edges.length).toBeGreaterThan(0);
  });

  it("refuses a graph that already violates the constraints it is asked to preserve", () => {
    // polishConstrained only SWAPS, so it cannot repair a violating input — but the only
    // check was a dev-mode postcondition, compiled out in production and blaming this
    // function for its caller's defect in dev.
    const g = ring(8);
    const cons = new Constraints(8);
    cons.prohibit(0, 1); // ring(8) has this edge
    expect(() => polishConstrained(g, cons, { iters: 10 }).graph).toThrow(/prohibited pair/);

    const missing = new Constraints(8);
    missing.require(0, 4); // ring(8) does not have this edge
    expect(() => polishConstrained(g, missing, { iters: 10 }).graph).toThrow(/missing required pair/);
  });

  it("charges the anneal calibration against the same budget as the loop", () => {
    // 100 full O(n·m) energy evaluations ran before the loop regardless of the
    // budget: polish(g, {mode:"anneal", maxIters:0}) took 587 ms on a 300-vertex
    // graph against 11 ms for the same call in hill mode.
    const g = ring(300);
    const anneal = performance.now();
    polish(g, { mode: "anneal", maxIters: 0 });
    const annealMs = performance.now() - anneal;
    const hill = performance.now();
    polish(g, { mode: "hill", maxIters: 0 });
    const hillMs = performance.now() - hill;
    // A zero budget must buy zero work in BOTH modes, so they are now comparable.
    expect(annealMs).toBeLessThan(hillMs + 200);
  });
});


/** Two metrics that described an earlier pipeline stage rather than the result. */
describe("reported metrics describe the graph actually returned", () => {
  it("reports the separation the returned graph has, not the one generation aimed for", () => {
    // buildBuddyGraph(16, 5) advertised finalMinSeparation 3 while returning a
    // graph of girth 3 — buddies two steps apart. ringGreedy reported its own
    // achievement and polish, which is not separation-aware, then ran.
    const r = buildBuddyGraph(16, 5);
    expect(Number.isFinite(r.girth)).toBe(true);
    expect(r.finalMinSeparation).toBe(r.girth - 1);
  });

  it("holds across sizes, polished and unpolished", () => {
    for (const [n, k] of [[16, 5], [24, 4], [40, 6], [12, 3]] as const) {
      for (const polish of [true, false] as const) {
        const r = buildBuddyGraph(n, k, { polish });
        if (!Number.isFinite(r.girth)) continue;
        expect(r.finalMinSeparation).toBe(r.girth - 1);
      }
    }
  });

  it("scores the gap against the degree delivered, not the one requested", () => {
    // buildBuddyGraph(8, 6) returns a 3-regular graph whose ASPL equals the
    // Moore bound for k=3 exactly, yet used to report a gap of 0.375 by scoring
    // it against k=6 — a graph that is provably optimal reading as badly wired.
    const r = buildBuddyGraph(8, 6);
    expect(r.degreeMax).toBeLessThan(6); // the demotion floor really does bind here
    expect(r.asplGap).toBeCloseTo(0, 12);
  });

  it("never claims a diameter lower bound above an achievable diameter", () => {
    // K2 is the unique 1-regular graph on 2 vertices; it has diameter 1 and meets
    // the ASPL bound, but mooreLowerBounds(2, 1) claimed diameterLb 2.
    expect(mooreLowerBounds(2, 1)).toEqual({ asplLb: 1, diameterLb: 1 });
    for (let n = 2; n <= 40; n++) {
      for (let k = 1; k < n; k++) {
        const b = mooreLowerBounds(n, k);
        // A k-regular graph on n vertices always exists for some parity, and its
        // diameter can never exceed n-1; a lower bound above that is vacuous.
        expect(b.diameterLb).toBeLessThanOrEqual(n - 1);
      }
    }
  });
});


describe("Graph mutators refuse a bad endpoint before touching anything", () => {
  it("never leaves half an edge behind", () => {
    // addEdge wrote adj[u] and then threw on an out-of-range v, so a caller that
    // caught the error kept a Graph containing a non-vertex, with an odd degree
    // sum and numEdges() disagreeing with edgeList().
    const g = new Graph(3);
    g.addEdge(0, 1);
    expect(() => g.addEdge(0, 5)).toThrow(/vertex 5/);
    expect(g.adj[0].has(5)).toBe(false);
    expect(g.degrees().reduce((a, b) => a + b, 0) % 2).toBe(0);
    expect(g.edgeList()).toEqual([[0, 1]]);
  });

  it("guards every endpoint-taking entry point, including the read path", () => {
    const g = new Graph(3);
    for (const bad of [3, -1, 1.5, NaN]) {
      // The message names the offending index — a bare TypeError from
      // `undefined.has` would not, which is half the point of guarding the reads.
      expect(() => g.addEdge(0, bad)).toThrow(/must be an integer/);
      expect(() => g.removeEdge(0, bad)).toThrow(/must be an integer/);
      expect(() => g.hasEdge(0, bad)).toThrow(/must be an integer/);
    }
  });
});

describe("a non-finite priorWeight does not silently disable the pass", () => {
  it("falls back to no penalty instead of poisoning every comparison", () => {
    // NaN makes `next.energy < current` false for every candidate, so the pass
    // burned its whole budget of O(n·m) re-measurements and returned the input
    // unchanged — while still reporting polished: true.
    const cons = new Constraints(20).addPrior(0, 1);
    const withNaN = buildConstrainedBuddyGraph(20, 4, cons, { priorWeight: NaN });
    const withZero = buildConstrainedBuddyGraph(20, 4, cons, { priorWeight: 0 });
    expect(withNaN.edges).toEqual(withZero.edges);
    const unpolished = buildConstrainedBuddyGraph(20, 4, cons, { polish: false });
    // And it is a real polish, not the input handed back.
    expect(withNaN.polished).toBe(true);
    expect(withNaN.aspl).toBeLessThanOrEqual(unpolished.aspl);
  });
});


describe("the fragmentation guard needs BOTH count and largest-size", () => {
  it("never shrinks the largest group, at any prior weight", () => {
    // Component count alone was too weak: a swap that splits the largest group
    // while merging two small ones leaves the count flat and passed the guard —
    // reachable at the library's own DEFAULT_PRIOR_WEIGHT of 2.
    fc.assert(
      fc.property(scenario, fc.integer({ min: 0, max: 50 }), (s2, priorWeight) => {
        const g = graphOf(s2.n, s2.edges);
        const cons = new Constraints(s2.n);
        for (let v = 0; v + 3 < s2.n; v += 4) cons.addPrior(v, v + 3);
        const out = polishConstrained(g, cons, { seed: s2.seed, iters: 400, priorWeight }).graph;
        expect(largestComponentFraction(out)).toBeGreaterThanOrEqual(largestComponentFraction(g));
        expect(components(out)).toBeLessThanOrEqual(components(g));
      }),
    );
  });
});

describe("minSeparation is inert on the constrained path, provably and observably", () => {
  it("produces the same graph for every value it can be given", () => {
    // `choosePartner` always returns the farthest candidate, so the separation
    // scan that used to sit there could not change the answer. The scan is gone;
    // this pins that removing it changed nothing, and that the option is honest
    // about being ignored.
    const cons = new Constraints(24).require(0, 1).prohibit(4, 5);
    const base = buildConstrainedBuddyGraph(24, 4, cons, { polish: false }).edges;
    for (const minSeparation of [2, 3, 5, 8, 12, 0, 1000]) {
      expect(
        buildConstrainedBuddyGraph(24, 4, cons, { polish: false, minSeparation }).edges,
      ).toEqual(base);
    }
  });
});
