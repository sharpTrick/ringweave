import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { computeFit, FIT_MODES, LAYOUT_MODES } from "../src/graph/GraphCanvas";
import { ringLayout, forceLayout } from "../src/graph/layout";

describe("computeFit frames the union of ring + force", () => {
  const r = buildBuddyGraph(40, 4, { seed: 7, polish: false });
  const ring = ringLayout(40);
  const force = forceLayout(40, r.edges);

  it("is pure (same points -> same fit)", () => {
    expect(computeFit(ring)).toEqual(computeFit(ring));
  });

  it("the union frame is never tighter than either single layout (so neither clips)", () => {
    const union = computeFit([...ring, ...force]);
    expect(union.s).toBeLessThanOrEqual(computeFit(ring).s + 1e-9);
    expect(union.s).toBeLessThanOrEqual(computeFit(force).s + 1e-9);
  });

  it("order-independent: framing the union doesn't depend on which layout comes first", () => {
    expect(computeFit([...ring, ...force])).toEqual(computeFit([...force, ...ring]));
  });

  // Only POSITION-STABLE layouts may define the fixed frame: folding a selection-dependent
  // mode's points into the union would rescale the viewBox on every hover or click.
  it("FIT_MODES is exactly the position-stable layouts and is a subset of LAYOUT_MODES", () => {
    expect(FIT_MODES).toEqual(["ring", "force"]);
    for (const m of FIT_MODES) expect(LAYOUT_MODES).toContain(m);
  });
});
