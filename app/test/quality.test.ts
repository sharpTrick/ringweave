import { describe, it, expect } from "vitest";
import { asplGap, buildBuddyGraph } from "ringweave";
import { connectionSummary, qualityPercent, isOptimal, quality, viewFromResult, DEFAULT_SETTINGS, type Metrics } from "../src/model";

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
      const r = buildBuddyGraph(n, k, { seed: 1 });
      const v = viewFromResult(names(n), DEFAULT_SETTINGS, r);
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

  // Class: the gauge number (qualityPercent) and the caption must agree in tier at the rounding
  // boundary — a score can't render "50" with 'loosely' while a hair above renders "50" with
  // 'well-linked'. Both derive from qualityPercent, so tier flips exactly at gauge 50.
  it("gauge percent and caption agree in tier across the 0.5 boundary", () => {
    for (const q of [0, 0.49, 0.494, 0.495, 0.499, 0.5, 0.501, 0.504, 0.505, 0.51, 0.9, 1]) {
      const m = metrics({ connected: true, aspl: 2, quality: q });
      const pct = qualityPercent(m);
      const caption = connectionSummary(m);
      if (pct >= 50) expect(caption).toMatch(/well-linked/);
      else expect(caption).toMatch(/loosely linked/);
    }
  });

  // Class: the "already optimal" claim must fire ONLY at a provably-optimal score (quality === 1),
  // never merely because the gauge rounds to 100 — a 99.6% graph a reroll could still improve.
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
