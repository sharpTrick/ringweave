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
    // The charged mean alone ranks a clique plus an isolate above a sparse connected graph, so
    // this fixture is what pins the flat term.
    const connected = graphOf(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]);
    const almostComplete = graphOf(6, [
      [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4],
    ]); // K5 plus an isolated vertex 5
    expect(penalizedAspl(allPairsSummary(almostComplete), 6)).toBeGreaterThan(
      penalizedAspl(allPairsSummary(connected), 6),
    );
  });

  it("is finite for an edgeless graph rather than incomparable", () => {
    // aspl is Infinity there (no reachable pairs), and an Infinity energy makes every candidate
    // look equally good to an optimizer comparing energies.
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

  it("leaves no more components than it started with in hill-climb mode too", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const g = graphOf(s.n, s.edges);
        const out = polish(g, { mode: "hill", seed: s.seed, maxIters: 600 }).graph;
        expect(components(out)).toBeLessThanOrEqual(components(g));
      }),
    );
  });

  it("keeps a 12-cycle plus a disjoint 4-cycle at no more than two components", () => {
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
        // Priors the graph does NOT satisfy, so the prior term actively pushes for swaps —
        // without that, no weight could buy fragmentation and the property is trivial.
        for (let v = 0; v + 3 < s.n; v += 4) cons.addPrior(v, v + 3);
        const out = polishConstrained(g, cons, { seed: s.seed, iters: 400, priorWeight }).graph;
        expect(components(out)).toBeLessThanOrEqual(components(g));
      }),
    );
  });

  it("leaves the constrained builder's largest group no smaller than generation produced", () => {
    const prohibited: [number, number][] = [
      [1, 2], [12, 15], [10, 13], [12, 13], [3, 10], [12, 14], [11, 14], [5, 11],
      [8, 13], [7, 10], [9, 15], [13, 15], [5, 6], [2, 12], [0, 9], [2, 13],
      [0, 14], [6, 10], [9, 11], [4, 10], [13, 14], [8, 9],
    ];
    const cons = new Constraints(16);
    for (const [a, b] of prohibited) cons.prohibit(a, b);

    const polished = buildConstrainedBuddyGraph(16, 2, cons); // default options: polish is on
    const unpolished = buildConstrainedBuddyGraph(16, 2, cons, { polish: false });

    expect(polished.report.largestComponentFraction).toBeGreaterThanOrEqual(
      unpolished.report.largestComponentFraction,
    );
    expect(polished.report.largestComponentFraction).toBeGreaterThan(0.5);
  });
});


describe("work budgets bound the default path", () => {
  it("keeps the polish gate exactly where it was at k=4, which is what the fixtures pin", () => {
    expect(autoPolishEnabled(120, 4)).toBe(true);
    expect(autoPolishEnabled(121, 4)).toBe(false);
  });

  it("turns polish off for a dense roster the n-cap waved through", () => {
    expect(autoPolishEnabled(120, 12)).toBe(false);
  });

  it("still honours an explicit polish request the gate says no to", () => {
    // Observed through the ITERATION count, not `polished`: "the pass ran" and "the pass changed
    // something" are different facts and this test is about the first.
    expect(autoPolishEnabled(120, 12)).toBe(false);
    const { graph } = ringGreedy(120, 12, { mind: 5, repair: true });
    expect(polish(graph, { mode: "anneal", seed: 1, maxIters: 5 }).iters).toBeGreaterThan(0);
  });

  it("refuses an (n,k) that would run for tens of minutes", () => {
    expect(() => buildBuddyGraph(1000, 999, { polish: false })).toThrow(/too large to generate/);
    expect(() => buildBuddyGraph(5000, 4, { polish: false })).toThrow(/too large to generate/);
  });

  it("still accepts the largest roster the app can ask for", () => {
    // 1000 people at 12 buddies is what the app advertises, so a budget that refused it would be
    // a regression rather than a fix.
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


describe("MAX_POLISH_WORK cannot be stepped around", () => {
  const workOf = (n: number, k: number, iters: number) => polishWork(n, k, 0, iters);

  // Honouring the request means running it, and running it costs one budget — hence the
  // wall-clock allowance, here and in its sibling below.
  it("bounds an explicit polish request instead of honouring it unbounded", { timeout: 120_000 }, () => {
    const r = buildBuddyGraph(120, 12, { polish: true });
    expect(r.polished).toBe(true);
    expect(workOf(120, 12, 20000)).toBeGreaterThan(MAX_POLISH_WORK);
  });

  it("clamps a large finite iteration count, not just a non-finite one", { timeout: 120_000 }, () => {
    const started = performance.now();
    const huge = buildBuddyGraph(120, 12, { polish: true, polishIters: 1e15 });
    const elapsed = performance.now() - started;

    expect(huge.polished).toBe(true);
    expect(huge.edges.length).toBeGreaterThan(0);
    // Bounded, not merely finite: 1e15 iterations would never have returned.
    expect(elapsed).toBeLessThan(90_000);
    const afforded = Math.floor(MAX_POLISH_WORK / polishWork(120, 12, 0, 1));
    expect(afforded).toBeLessThan(20000); // the clamp really does bind here
    expect(buildBuddyGraph(120, 12, { polish: true, polishIters: afforded }).edges).toEqual(huge.edges);
  });

  it("charges the n² term a sparse graph really costs", () => {
    // Huge n with almost no edges on purpose: `allPairsSummary` is Theta(n(n+m)), so this is
    // exactly where an n·m model under-charges by the whole n² term.
    const g = new Graph(3000);
    for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7]]) g.addEdge(a, b);
    const started = performance.now();
    polish(g, { mode: "hill" });
    expect(performance.now() - started).toBeLessThan(20_000);
  });

  it("leaves the auto path untouched, because the gate only admits what already fits", () => {
    for (const [n, k] of [[30, 4], [60, 4], [120, 4]] as const) {
      const afforded = Math.floor(MAX_POLISH_WORK / polishWork(n, k, 0, 1));
      expect(afforded).toBeGreaterThanOrEqual(20000);
    }
  });

  it("never models an iteration as free, so the divisor is always positive", () => {
    // A zero divisor would afford Infinity iterations, so the overhead term must survive both an
    // edgeless graph and a tiny one.
    expect(polishWork(5, 0, 0, 1)).toBeGreaterThan(0);
    expect(polishWork(3, 2, 0, 1)).toBeGreaterThan(0);
    expect(() => buildConstrainedBuddyGraph(5, 0, new Constraints(5), { polish: true })).not.toThrow();
  });

  it("bounds a huge iteration request on a TINY graph, where the work model alone cannot", () => {
    const started = performance.now();
    const r = buildBuddyGraph(3, 2, { polishIters: 1e9 });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(r.edges.length).toBeGreaterThan(0);
  });

  it("bounds the exported primitives, not just the wrappers around them", () => {
    const started = performance.now();
    const out = polish(ring(20), { mode: "hill", maxIters: Infinity });
    expect(performance.now() - started).toBeLessThan(20_000);
    expect(out.graph.n).toBe(20);

    const cons = new Constraints(20);
    const started2 = performance.now();
    // JSON has no Infinity literal, so an over-large exponent is how the value actually arrives.
    const fromJson = JSON.parse('{"iters":1e999}').iters as number;
    expect(fromJson).toBe(Infinity);
    expect(polishConstrained(ring(20), cons, { iters: fromJson }).graph.n).toBe(20);
    expect(performance.now() - started2).toBeLessThan(20_000);
  });

  it("refuses a graph whose PRE-LOOP sweeps already blow the budget", { timeout: 60_000 }, () => {
    const huge = ring(40000);
    expect(() => polish(huge, { maxIters: 0 })).toThrow(/too large to polish/);
    expect(() => polishConstrained(ring(30000), new Constraints(30000), { iters: 0 }).graph).toThrow(
      /too large to polish/,
    );

    // n=5000 is the constrained path's documented ceiling, so the cap must not have closed it.
    expect(() => checkPolishSize(5000, 10000, 0)).not.toThrow();
    expect(() => polish(ring(200), { maxIters: 1 })).not.toThrow();
  });

  it("reports `polished` only when the graph actually differs from an unpolished build", () => {
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
    // Non-vacuity: the sweep must actually REACH the unchanged case, or it asserts nothing.
    expect(sawUnchanged).toBeGreaterThan(5);
  }, 60_000);

  it("reports `polished` from what the pass DID, not from the decision to call it", () => {
    const cons = new Constraints(60);
    for (let v = 0; v + 1 < 60; v += 2) cons.addPrior(v, v + 1);

    const off = buildConstrainedBuddyGraph(60, 4, cons, { polish: false });
    const zero = buildConstrainedBuddyGraph(60, 4, cons, { polish: true, polishIters: 0 });
    expect(zero.edges).toEqual(off.edges);
    expect(zero.polished).toBe(false);
    expect(zero.report.priorsKeptFraction).toBeNull();

    // k=0 leaves an edgeless graph, so the loop's fewer-than-two-edges break fires on iteration
    // one — the same do-nothing state reached with no option at all.
    const edgeless = buildConstrainedBuddyGraph(12, 0, new Constraints(12));
    expect(edgeless.edges).toEqual([]);
    expect(edgeless.polished).toBe(false);

    const fastOff = buildBuddyGraph(30, 4, { polish: false });
    const fastZero = buildBuddyGraph(30, 4, { polish: true, polishIters: 0 });
    expect(fastZero.edges).toEqual(fastOff.edges);
    expect(fastZero.polished).toBe(false);

    // Non-vacuity: a pass that really runs still reports true, on both tiers.
    const real = buildConstrainedBuddyGraph(60, 4, cons, { polish: true });
    expect(real.polished).toBe(true);
    expect(buildBuddyGraph(30, 4, { polish: true }).polished).toBe(true);
  });

  it("never lets an ITERATION option ask for more work than omitting it", () => {
    // Both defaults, because one constant cannot bound a request made against two of them.
    for (const fallback of [8_000, 20_000]) {
      for (const [n, m] of [[30, 60], [60, 120], [120, 240], [1000, 6000]] as const) {
        const omitted = boundedPolishIterations(n, m, 0, undefined, fallback);
        for (const asked of [0, 1, 999, 8_000, 20_000, 1e6, 2 ** 31]) {
          expect(boundedPolishIterations(n, m, 0, asked, fallback)).toBeLessThanOrEqual(omitted);
        }
        // Non-vacuity: a SMALLER request is still honoured, which is the knob's job.
        expect(boundedPolishIterations(n, m, 0, 10, fallback)).toBe(Math.min(10, omitted));
      }
    }
  });

  it("never admits a polish call that cannot afford a single iteration", () => {
    // Over the whole accept-set, not at the two n values that happen to straddle the band: for
    // every shape the size gate admits, the loop must afford >= 1.
    for (let n = 200; n <= 14_000; n += 137) {
      for (const m of [n, 2 * n, (n * 3) / 2]) {
        let admitted = true;
        try {
          checkPolishSize(n, Math.round(m), 0);
        } catch {
          admitted = false;
        }
        if (admitted) {
          expect(boundedPolishIterations(n, Math.round(m), 0, 20_000, 20_000)).toBeGreaterThanOrEqual(1);
        }
      }
    }
    // ring(11000) is the shape whose fixed sweeps fit the budget with less than one iteration
    // left over — the band itself.
    expect(() => polish(ring(11_000), { maxIters: 20_000 })).toThrow(/leaving nothing for the loop/);
    // Non-vacuity: the shape just below it still runs, so the accept-set did not quietly shrink.
    expect(() => polish(ring(9500), { maxIters: 1 })).not.toThrow();
  });

  it("charges the FIXED sweeps too, so the two gates cannot sum past the budget", () => {
    const sweep = (n: number, m: number) => n * (n + m);
    const bigN = 16000;
    const bigM = bigN;
    if (sweep(bigN, bigM) * 3 <= MAX_POLISH_WORK) {
      expect(boundedPolishIterations(bigN, bigM, 0, 20_000, 20_000)).toBe(0);
    }
    // Non-vacuity: a small roster is untouched, so normal budgets did not quietly shrink.
    expect(boundedPolishIterations(20, 40, 0, 20_000, 20_000)).toBe(20_000);
  });

  it("charges the PRIOR probes, the third per-iteration cost centre", { timeout: 120_000 }, () => {
    // n=268, k=1 is the densest shape the auto-polish gate admits, which is why it is the shape
    // here; 35,778 is every pair of that roster.
    const n = 268;
    for (const priors of [0, 1_000, 9_034, 35_778]) {
      expect(polishWork(n, 1, priors, 8_000)).toBeGreaterThanOrEqual(polishWork(n, 1, 0, 8_000));
      expect(boundedPolishIterations(n, 134, priors, 8_000, 8_000)).toBeLessThanOrEqual(
        boundedPolishIterations(n, 134, 0, 8_000, 8_000),
      );
    }
    // Strictly, not merely weakly: a dimension charged at zero is a dimension still missing.
    expect(polishWork(n, 1, 1, 8_000)).toBeGreaterThan(polishWork(n, 1, 0, 8_000));
    expect(boundedPolishIterations(n, 134, 35_778, 8_000, 8_000)).toBeLessThan(
      boundedPolishIterations(n, 134, 0, 8_000, 8_000),
    );
    // At weight 0 the penalty is never built and the probes never happen, so a configuration that
    // costs nothing must not be refused — otherwise the fix for an overrun becomes a false refusal.
    const cons = new Constraints(n);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) cons.addPrior(a, b);
    const off = buildConstrainedBuddyGraph(n, 1, cons, { priorWeight: 0 });
    expect(off.report.refusals).toEqual([]);
    const started = performance.now();
    const on = buildConstrainedBuddyGraph(n, 1, cons, { polish: true });
    expect(on.report.refusals).toEqual([]);
    expect(performance.now() - started).toBeLessThan(30_000);
  });

  it("keeps the work model non-zero, so the guard built on it is a guard", () => {
    // k <= 2 is where an edges-added model is exactly zero, so it is where the guard would vanish.
    expect(greedyWork(1_000_000, 2)).toBeGreaterThan(MAX_GREEDY_WORK);
    expect(greedyWork(1_000_000, 1)).toBeGreaterThan(MAX_GREEDY_WORK);
    // Non-vacuity: the floor must not have moved the shipping accept-set.
    expect(greedyWork(1000, 12)).toBeLessThanOrEqual(MAX_GREEDY_WORK);
    expect(greedyWork(1000, 2)).toBeLessThanOrEqual(MAX_GREEDY_WORK);
  });

  it("bounds repair by its MEASURED cost, in both the single-pass and multi-pass regimes", { timeout: 120_000 }, () => {
    // An edgeless graph exits after ONE pass, nothing being reachable, so these shapes exist to
    // reach the multi-pass regime the budget is there to bound.
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
    // A dense core with a sparse fringe: m is DECOUPLED from n·k, the regime a sweep priced at
    // `n + n·k` — the cost of a k-regular graph — cannot see, while `bfsDistances` walks `n + 2m`.
    const cliqueWithLeaves = (core: number, leaves: number) => {
      const g = new Graph(core + leaves);
      for (let i = 0; i < core; i++) for (let j = i + 1; j < core; j++) g.addEdge(i, j);
      for (let i = 0; i < leaves; i++) g.addEdge(core + i, i % core);
      return g;
    };
    expect(() => repairDegrees(cliqueWithLeaves(1200, 1600), 2)).toThrow(/too large to repair/);
    // Scan-bound, the third cost centre: an edgeless graph gives the BFS nothing to walk, but
    // each sweep still probes all n candidates, so pricing the traversal alone lets it through.
    expect(() => repairDegrees(new Graph(20_000), 2)).toThrow(/too large to repair/);
    expect(() => repairDegrees(ring(36_000), 4)).toThrow(/too large to repair/);
    expect(() => repairDegrees(triCycle(2400), 4)).toThrow(/too large to repair/);
    // Non-vacuity: the cheap shapes still run, in both regimes.
    expect(() => repairDegrees(ring(4000), 4)).not.toThrow();
    expect(() => repairDegrees(triCycle(600), 4)).not.toThrow();
    // A graph with NO deficit costs one scan however large it is.
    expect(() => repairDegrees(ring(200_000), 2)).not.toThrow();
  });

  it("bounds the exported repair pass and refuses a k it cannot honour", () => {
    // NaN makes `degree(v) < k` false everywhere, so accepting it is a no-op reported as success.
    expect(() => repairDegrees(ring(400), 1e9)).toThrow(/too large to repair/);
    expect(() => repairDegrees(ring(20), NaN)).toThrow(/must be a non-negative integer/);
    expect(() => repairDegrees(ring(20), Infinity)).toThrow(/must be a non-negative integer/);
    expect(() => repairDegrees(ring(20), 4)).not.toThrow();
  });

  it("keeps the greedy work model an UPPER bound as k grows", () => {
    // Pinned in both directions, so a future recalibration cannot quietly drop the shipping
    // ceiling while closing the dense corner.
    expect(greedyWork(1000, 12)).toBeLessThanOrEqual(MAX_GREEDY_WORK);
    expect(greedyWork(1000, 4)).toBeLessThanOrEqual(MAX_GREEDY_WORK);
    expect(greedyWork(1000, 20)).toBeGreaterThan(MAX_GREEDY_WORK);
    expect(greedyWork(800, 39)).toBeGreaterThan(MAX_GREEDY_WORK);
    // Monotone in both arguments, or the gate could be stepped around by asking for more.
    for (const n of [100, 500, 1000]) {
      for (let k = 2; k < 12; k++) {
        expect(greedyWork(n, k + 1)).toBeGreaterThanOrEqual(greedyWork(n, k));
        expect(greedyWork(n + 1, k)).toBeGreaterThanOrEqual(greedyWork(n, k));
      }
    }
  });

  it("names a bad vertex on the primitive every other query is built on", () => {
    for (const bad of [-1, 10, 2.5, NaN, 1e9]) {
      expect(() => bfsDistances(ring(10), bad)).toThrow(/source .* must be an integer/);
    }
    expect(() => bfsDistances(ring(10), 0)).not.toThrow();
  });

  it("never reports a graph as better than provably optimal", () => {
    // At k=1, n>2 no max-degree-1 graph realises a Moore tree — a matching is the best possible
    // and it is disconnected — so there is no bound to report rather than a negative one.
    for (let n = 1; n <= 40; n++) {
      for (let k = 1; k <= 6; k++) {
        const { asplLb } = mooreLowerBounds(n, k);
        expect(asplLb).toBeGreaterThanOrEqual(0);
        if (k === 1 && n > 2) expect(asplLb).toBe(0);
      }
    }
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
    expect(() => buildBuddyGraph(20, 4, { minSeparation: NaN })).toThrow(/minimum separation/);
    expect(() => buildBuddyGraph(20, 4, { minSeparation: -1 })).toThrow(/minimum separation/);
    expect(() => buildBuddyGraph(20, 4, { minSeparation: 2.5 })).toThrow(/minimum separation/);
    expect(buildBuddyGraph(20, 4, { minSeparation: 3 }).edges.length).toBeGreaterThan(0);
  });

  it("refuses a graph that already violates the constraints it is asked to preserve", () => {
    // polishConstrained only SWAPS, so it cannot repair a violating input.
    const g = ring(8);
    const cons = new Constraints(8);
    cons.prohibit(0, 1); // ring(8) has this edge
    expect(() => polishConstrained(g, cons, { iters: 10 }).graph).toThrow(/prohibited pair/);

    const missing = new Constraints(8);
    missing.require(0, 4); // ring(8) does not have this edge
    expect(() => polishConstrained(g, missing, { iters: 10 }).graph).toThrow(/missing required pair/);
  });

  it("charges the anneal calibration against the same budget as the loop", () => {
    const g = ring(300);
    const anneal = performance.now();
    polish(g, { mode: "anneal", maxIters: 0 });
    const annealMs = performance.now() - anneal;
    const hill = performance.now();
    polish(g, { mode: "hill", maxIters: 0 });
    const hillMs = performance.now() - hill;
    // A zero budget must buy zero work in BOTH modes, which is what makes the two comparable.
    expect(annealMs).toBeLessThan(hillMs + 200);
  });
});


describe("reported metrics describe the graph actually returned", () => {
  it("reports the separation the returned graph has, not the one generation aimed for", () => {
    const r = buildBuddyGraph(16, 5);
    expect(Number.isFinite(r.girth)).toBe(true);
    expect(r.finalMinSeparation).toBe(r.girth - 1);
  });

  it("reports the returned graph's separation across sizes, polished and unpolished", () => {
    for (const [n, k] of [[16, 5], [24, 4], [40, 6], [12, 3]] as const) {
      for (const polish of [true, false] as const) {
        const r = buildBuddyGraph(n, k, { polish });
        if (!Number.isFinite(r.girth)) continue;
        expect(r.finalMinSeparation).toBe(r.girth - 1);
      }
    }
  });

  it("scores the gap against the degree delivered, not the one requested", () => {
    // (8, 6) returns a 3-regular graph whose ASPL exactly meets the Moore bound for k=3, which
    // is what separates scoring against the degree delivered from scoring against the request.
    const r = buildBuddyGraph(8, 6);
    expect(r.degreeMax).toBeLessThan(6); // the demotion floor really does bind here
    expect(r.asplGap).toBeCloseTo(0, 12);
  });

  it("never claims a diameter lower bound above an achievable diameter", () => {
    // K2 is the unique 1-regular graph on 2 vertices, so diameter 1 is achievable there.
    expect(mooreLowerBounds(2, 1)).toEqual({ asplLb: 1, diameterLb: 1 });
    for (let n = 2; n <= 40; n++) {
      for (let k = 1; k < n; k++) {
        const b = mooreLowerBounds(n, k);
        // No graph on n vertices has diameter above n-1, so a lower bound above it is vacuous.
        expect(b.diameterLb).toBeLessThanOrEqual(n - 1);
      }
    }
  });
});


describe("Graph mutators refuse a bad endpoint before touching anything", () => {
  it("never leaves half an edge behind", () => {
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
      // The message must name the offending index; a bare TypeError from `undefined.has` would
      // not, which is half the point of guarding the reads.
      expect(() => g.addEdge(0, bad)).toThrow(/must be an integer/);
      expect(() => g.removeEdge(0, bad)).toThrow(/must be an integer/);
      expect(() => g.hasEdge(0, bad)).toThrow(/must be an integer/);
    }
  });
});

describe("a non-finite priorWeight does not silently disable the pass", () => {
  it("falls back to no penalty instead of poisoning every comparison", () => {
    const cons = new Constraints(20).addPrior(0, 1);
    const withNaN = buildConstrainedBuddyGraph(20, 4, cons, { priorWeight: NaN });
    const withZero = buildConstrainedBuddyGraph(20, 4, cons, { priorWeight: 0 });
    expect(withNaN.edges).toEqual(withZero.edges);
    const unpolished = buildConstrainedBuddyGraph(20, 4, cons, { polish: false });
    // Non-vacuity: a real polish, not the input handed back.
    expect(withNaN.polished).toBe(true);
    expect(withNaN.aspl).toBeLessThanOrEqual(unpolished.aspl);
  });
});


describe("the fragmentation guard needs BOTH count and largest-size", () => {
  it("never shrinks the largest group, at any prior weight", () => {
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
    // `choosePartner` always returns the farthest candidate, so a separation scan could not
    // change the answer — which is why the option can be ignored rather than honoured.
    const cons = new Constraints(24).require(0, 1).prohibit(4, 5);
    const base = buildConstrainedBuddyGraph(24, 4, cons, { polish: false }).edges;
    for (const minSeparation of [2, 3, 5, 8, 12, 0, 1000]) {
      expect(
        buildConstrainedBuddyGraph(24, 4, cons, { polish: false, minSeparation }).edges,
      ).toEqual(base);
    }
  });
});
