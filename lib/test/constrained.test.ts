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
import { allPairsSummary, isConnected } from "../src/core/metrics.js";
import {
  Constraints,
  validate,
  constrainedGreedy,
  polishConstrained,
  buildConstrainedBuddyGraph,
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

describe("constrainedGreedy oracle parity vs Python", () => {
  for (const fx of ref.constrained as ConstrainedFixture[]) {
    it(`${fx.scenario} n=${fx.n} k=${fx.k}`, () => {
      const cons = consFrom(fx);
      const g = constrainedGreedy(fx.n, fx.k, cons, { minSeparation: fx.mind });

      // hard guarantees
      expect(hasNoProhibited(g, cons)).toBe(true);
      expect(hasAllRequired(g, cons)).toBe(true);
      expect(isConnected(g)).toBe(true);

      // quality parity with the reference implementation
      const { aspl, diameter } = allPairsSummary(g);
      expect(Math.abs(aspl - fx.aspl) / fx.aspl).toBeLessThan(0.1);
      expect(Math.abs(diameter - fx.diameter)).toBeLessThanOrEqual(1);

      // quality parity: degree spread matches the reference on these fixtures
      // (spread <= 1 is a quality expectation here, not a hard guarantee —
      // forceConnect can widen it on prohibition-dense inputs).
      const degs = g.degrees();
      expect(Math.max(...degs) - Math.min(...degs)).toBeLessThanOrEqual(
        fx.deg_max - fx.deg_min + 1,
      );
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
});

describe("fromTags compiles same-group to prohibited", () => {
  it("prohibits household members", () => {
    const tags = [0, 0, 1, 1, 1, null, null];
    const c = Constraints.fromTags(7, tags, "prohibit_same");
    expect(c.prohibited.has("0,1")).toBe(true); // group 0
    expect(c.prohibited.has("2,3")).toBe(true); // group 1
    expect(c.prohibited.has("2,4")).toBe(true);
    expect(c.prohibited.has("3,4")).toBe(true);
    expect(c.prohibited.has("5,6")).toBe(false); // null tags never prohibited
    expect(c.prohibited.has("0,2")).toBe(false); // different groups
  });
});

describe("polishConstrained preserves hard constraints and degrees", () => {
  it("keeps prohibited out, required in, and the degree sequence fixed", () => {
    const cons = new Constraints(40);
    cons.require(0, 1).require(2, 3);
    cons.prohibit(4, 5).prohibit(6, 7);
    const base = constrainedGreedy(40, 4, cons, { minSeparation: 5 });
    const before = base.degrees();

    const polished = polishConstrained(base, cons, { seed: 1, iters: 4000 });

    expect(hasNoProhibited(polished, cons)).toBe(true);
    expect(hasAllRequired(polished, cons)).toBe(true);
    expect(polished.degrees()).toEqual(before);
    // polish never worsens ASPL relative to its input
    expect(allPairsSummary(polished).aspl).toBeLessThanOrEqual(
      allPairsSummary(base).aspl + 1e-9,
    );
  });
});

describe("prior weight preserves churn buddies", () => {
  it("a high prior weight keeps more prior buddies than zero weight", () => {
    const n = 60;
    const k = 4;
    const base = constrainedGreedy(n, k, new Constraints(n), { minSeparation: 5 });
    const cons = new Constraints(n);
    for (const [a, b] of base.edgeList()) cons.addPrior(a, b);
    const total = cons.priors.size;

    const keptWith = (weight: number) => {
      const g = polishConstrained(base, cons, {
        seed: 7,
        iters: 6000,
        priorWeight: weight,
      });
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
});
