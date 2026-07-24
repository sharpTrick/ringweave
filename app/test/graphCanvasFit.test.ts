import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { computeFit } from "../src/graph/GraphCanvas";
import { ringLayout, forceLayout } from "../src/graph/layout";

// Class: the graph is framed to the UNION of every layout so a toggle pans within a fixed
// viewBox rather than rescaling. GraphCanvas keeps that union frame stable across ring<->force
// toggles by caching the force settle (so ring mode after a force view still frames the union).
// These pin the framing math the cache relies on.
describe("computeFit frames the union of ring + force", () => {
  const r = buildBuddyGraph(40, 4, { seed: 7, polish: false });
  const ring = ringLayout(40);
  const force = forceLayout(40, r.edges);

  it("is pure (same points -> same fit)", () => {
    expect(computeFit(ring)).toEqual(computeFit(ring));
  });

  it("the union frame is never tighter than either single layout (so neither clips)", () => {
    const union = computeFit([...ring, ...force]);
    // Adding a layout's points can only hold or loosen the scale, never zoom in past a subset.
    expect(union.s).toBeLessThanOrEqual(computeFit(ring).s + 1e-9);
    expect(union.s).toBeLessThanOrEqual(computeFit(force).s + 1e-9);
  });

  it("order-independent: framing the union doesn't depend on which layout comes first", () => {
    expect(computeFit([...ring, ...force])).toEqual(computeFit([...force, ...ring]));
  });
});
