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
import {
  Constraints,
  polishConstrained,
  buildBuddyGraph,
  buildConstrainedBuddyGraph,
} from "../src/core/index.js";
import { MAX_GREEDY_WORK, greedyWork } from "../src/core/graph.js";

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
        const out = polishConstrained(g, cons, { seed: s.seed, iters: 400, priorWeight });
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
  it("keeps the polish gate exactly where it was at k=4, which is what the fixtures pin", () => {
    expect(buildBuddyGraph(120, 4, { polishIters: 1 }).polished).toBe(true);
    expect(buildBuddyGraph(121, 4, { polishIters: 1 }).polished).toBe(false);
  });

  it("turns polish off for a dense roster the n-cap waved through", () => {
    // buildBuddyGraph(120, 12) ran for 33 s under the n-only gate, while
    // buildBuddyGraph(121, 12) took 0.1 s — cost falling as the roster grew.
    expect(buildBuddyGraph(120, 12, { polishIters: 1 }).polished).toBe(false);
  });

  it("still honours an explicit polish request", () => {
    // A heuristic must not override a direct instruction from the caller.
    expect(buildBuddyGraph(120, 12, { polish: true, polishIters: 1 }).polished).toBe(true);
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
