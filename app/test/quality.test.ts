import { describe, it, expect } from "vitest";
import { asplGap, buildBuddyGraph } from "ringweave";
import { generateResult } from "./helpers";
import {
  connectionSummary, constraintSummary, qualityPercent, isOptimal, quality, viewFromResult, DEFAULT_SETTINGS, degreeLabel,
  buddiesLabel, buddiesEachLabel, peopleNoun, separationShortfall, SEPARATION_DEFAULT,
  targetShortfall, type Metrics, type GraphView,
} from "../src/model";

function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `P${i}`);
}

function metrics(over: Partial<Metrics>): Metrics {
  return {
    aspl: 2,
    diameter: 3,
    girth: 5,
    quality: 0.9,
    connected: true,
    largestComponentFraction: 1,
    regular: true,
    degreeMin: 4,
    degreeMax: 4,
    ...over,
  };
}

describe("quality score (F5)", () => {
  it("is clamp01(1 - asplGap) and matches BuddyResult", () => {
    const r = buildBuddyGraph(30, 4, { seed: 12345 });
    const q = quality(r.aspl, 30, 4);
    expect(q).toBeGreaterThanOrEqual(0);
    expect(q).toBeLessThanOrEqual(1);
    expect(q).toBeCloseTo(Math.max(0, Math.min(1, 1 - r.asplGap)), 12);
  });

  it("the SHIPPED quality (via assembleMetrics/viewFromResult) is scored at degreeMax, regular AND irregular", () => {
    for (const [n, k] of [[24, 4], [25, 3], [15, 3]] as const) {
      const r = generateResult(n, k, { seed: 1 });
      const v = viewFromResult(names(n), DEFAULT_SETTINGS, [], [], r);
      const expected = Math.max(0, Math.min(1, 1 - asplGap(r.aspl, n, r.degreeMax)));
      expect(v.metrics.quality).toBeCloseTo(expected, 12);
    }
  });
});

describe("connectionSummary caption never contradicts the gauge", () => {
  it("disconnected never says 'well-linked', and the % is floored below 100", () => {
    expect(connectionSummary(metrics({ connected: false, largestComponentFraction: 0.995, quality: 0 }))).toMatch(/99% are in the largest/);
    expect(connectionSummary(metrics({ connected: false, largestComponentFraction: 0.5 }))).not.toMatch(/well-linked/);
  });

  it("a roster too small to score says so, not 'well-linked'", () => {
    expect(connectionSummary(metrics({ connected: true, aspl: null, quality: 0 }))).toMatch(/not enough people/i);
  });

  it("connected but low quality reads 'loosely linked', not 'well-linked'", () => {
    const s = connectionSummary(metrics({ connected: true, aspl: 1.99, quality: 0.05 }));
    expect(s).toMatch(/loosely linked/);
    expect(s).not.toMatch(/well-linked/);
  });

  it("connected and high quality reads 'well-linked'", () => {
    expect(connectionSummary(metrics({ connected: true, quality: 0.96 }))).toMatch(/well-linked/);
  });

  it("gauge percent and caption agree in tier across the 0.5 boundary", () => {
    for (const q of [0, 0.49, 0.494, 0.495, 0.499, 0.5, 0.501, 0.504, 0.505, 0.51, 0.9, 1]) {
      const m = metrics({ connected: true, aspl: 2, quality: q });
      const pct = qualityPercent(m);
      const caption = connectionSummary(m);
      if (pct >= 50) expect(caption).toMatch(/well-linked/);
      else expect(caption).toMatch(/loosely linked/);
    }
  });

  it("isOptimal is exact (quality === 1), not gauge-rounded to 100", () => {
    expect(isOptimal(metrics({ quality: 1 }))).toBe(true);
    for (const q of [0.996, 0.999, 0.9999]) {
      const m = metrics({ quality: q });
      expect(qualityPercent(m)).toBe(100); // gauge shows 100...
      expect(isOptimal(m)).toBe(false); // ...but it is NOT claimed optimal
    }
    expect(isOptimal(metrics({ quality: 0.5 }))).toBe(false);
  });
});

describe("the delivered graph vs the graph that was asked for", () => {
  const viewWith = (asked: number, got: number) =>
    ({
      names: ["a", "b", "c"],
      edges: [] as [number, number][],
      buddies: [] as number[][],
      settings: { ...DEFAULT_SETTINGS, buddies: asked },
      constraints: [],
      report: null,
      metrics: {
        aspl: 1, diameter: 1, girth: 3, quality: 1, connected: true,
        largestComponentFraction: 1, regular: true, degreeMin: got, degreeMax: got,
      },
    }) as unknown as GraphView;

  it("reports the shortfall when the roster cannot give what was asked", () => {
    expect(targetShortfall(viewWith(4, 3))).toEqual({ asked: 4, got: 3 });
  });

  it("stays silent when the target was met or beaten", () => {
    expect(targetShortfall(viewWith(4, 4))).toBeNull();
    expect(targetShortfall(viewWith(3, 4))).toBeNull();
  });

  it("can be optimal AND short of target at the same time", () => {
    const v = viewWith(4, 3);
    expect(isOptimal(v.metrics)).toBe(true);
    expect(targetShortfall(v)).not.toBeNull();
  });
});

describe("every displayed buddy count comes from one seam", () => {
  it("a non-regular graph never has two panels claiming different counts", () => {
    const m: Metrics = {
      aspl: 2, diameter: 3, girth: 4, quality: 0.9, connected: true,
      largestComponentFraction: 1, regular: false, degreeMin: 3, degreeMax: 4,
    };
    const label = degreeLabel(m);
    expect(label).toBe("3–4");
    // Must BE the label, not merely contain it: "3–4 buddies each" contains "4 buddies each",
    // so a negative substring match would be meaningless.
    const stated = /for (.+?) buddies each/.exec(connectionSummary(m))?.[1];
    expect(stated).toBe(label);
    expect(stated).not.toBe(String(m.degreeMax));
  });
});

describe("every displayed count phrase agrees about its noun, too", () => {
  const oneEach: Metrics = {
    aspl: 1, diameter: 1, girth: Infinity as unknown as number, quality: 1, connected: true,
    largestComponentFraction: 1, regular: true, degreeMin: 1, degreeMax: 1,
  };
  const fourEach: Metrics = { ...oneEach, degreeMin: 4, degreeMax: 4 };
  const range: Metrics = { ...oneEach, regular: false, degreeMin: 3, degreeMax: 4 };

  it("uses the singular exactly when the count it qualifies is 1", () => {
    expect(buddiesLabel(oneEach)).toBe("1 buddy");
    expect(buddiesLabel(fourEach)).toBe("4 buddies");
    expect(buddiesLabel(range)).toBe("3–4 buddies");
    expect(peopleNoun(1)).toBe("person");
    expect(peopleNoun(0)).toBe("people");
    expect(peopleNoun(2)).toBe("people");
  });

  it("the caption and the rail render the same phrase for the same graph", () => {
    // Both go through the seam, so this cannot be satisfied by two strings that happen to agree.
    for (const m of [oneEach, fourEach, range]) {
      expect(connectionSummary(m)).toContain(buddiesEachLabel(m));
    }
  });
});

describe("a Settings value shown as delivered is disclosed when it was not", () => {
  const viewAt = (n: number, k: number, asked?: number): GraphView =>
    viewFromResult(
      Array.from({ length: n }, (_, i) => `P${i}`),
      { ...DEFAULT_SETTINGS, buddies: k, minSeparation: asked, polish: false },
      [],
      [],
      generateResult(n, k, { seed: 12345, polish: false, minSeparation: asked }),
    );

  it("names the delivered separation whenever it falls short of the request", () => {
    let disclosed = 0;
    for (const n of [12, 20, 30]) {
      const view = viewAt(n, 4);
      const short = separationShortfall(view);
      // Derived from girth, which is what the core's own postcondition ties separation to.
      expect(view.metrics.girth).not.toBeNull();
      expect(short).not.toBeNull();
      expect(short!.asked).toBe(SEPARATION_DEFAULT);
      expect(short!.got).toBe(view.metrics.girth! - 1);
      expect(short!.got).toBeLessThan(short!.asked);
      disclosed++;
    }
    expect(disclosed).toBe(3);
  });

  it("says nothing when the request was met", () => {
    // A disclosure that always fires is not a disclosure.
    const view = viewAt(20, 4, 2);
    expect(separationShortfall(view)).toBeNull();
  });
});

describe("constraintSummary", () => {
  const RULES = [{ a: 0, b: 1, kind: "required" as const }];
  const view = (report: GraphView["report"], constraints = RULES): GraphView => ({
    ...viewFromResult(names(8), DEFAULT_SETTINGS, constraints, [], generateResult(8, 4)),
    report,
  });

  it("never says satisfied when nothing measured the rules", () => {
    // The disconnected-reads-as-optimal class, one field over: import rehydrates edges without
    // running a builder, so `report` is null and the only honest answer is that nobody checked.
    expect(constraintSummary(view(null))).not.toMatch(/satisfied/);
    expect(constraintSummary(view(null))).toMatch(/not re-checked/);
  });

  it("says satisfied only when the report says zero violations", () => {
    const clean = { reqViolations: 0, prohViolations: 0, connected: true, largestComponentFraction: 1, refusals: [], priorsKeptFraction: null };
    expect(constraintSummary(view(clean))).toMatch(/satisfied/);
    for (const broken of [{ ...clean, reqViolations: 1 }, { ...clean, prohViolations: 1 }]) {
      const text = constraintSummary(view(broken)) ?? "";
      expect(text).not.toMatch(/satisfied/);
      expect(text).toMatch(/couldn.t be met/);
    }
  });

  it("says nothing at all when there are no rules to report on", () => {
    expect(constraintSummary(view(null, []))).toBeNull();
  });
});
