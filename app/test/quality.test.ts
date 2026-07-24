import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { quality, viewFromResult, DEFAULT_SETTINGS } from "../src/model";

describe("quality score (F5)", () => {
  it("is clamp01(1 - asplGap) and matches BuddyResult", () => {
    const r = buildBuddyGraph(30, 4, { seed: 12345 });
    const q = quality(r.aspl, 30, 4);
    expect(q).toBeGreaterThanOrEqual(0);
    expect(q).toBeLessThanOrEqual(1);
    // 1 - asplGap, clamped: with the core's own asplGap field.
    expect(q).toBeCloseTo(Math.max(0, Math.min(1, 1 - r.asplGap)), 12);
  });

  it("viewFromResult surfaces core metrics unchanged", () => {
    const r = buildBuddyGraph(24, 4, {});
    const view = viewFromResult(["a"], DEFAULT_SETTINGS, r); // names length irrelevant to these fields
    expect(view.metrics.aspl).toBe(r.aspl);
    expect(view.metrics.diameter).toBe(r.diameter);
    expect(view.metrics.degreeMin).toBe(r.degreeMin);
    expect(view.metrics.degreeMax).toBe(r.degreeMax);
  });
});
