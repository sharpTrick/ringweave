/**
 * The worker's request→response mapping. Previously untestable: it lived inside
 * `onmessage`, and a module worker cannot be instantiated under jsdom, so the
 * error channel in particular had no coverage at all — the suite mocks the
 * generation *hook*, never the protocol.
 */
import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { runGeneration } from "../src/worker/generate";

describe("runGeneration", () => {
  it("returns the built graph, echoing the correlation id", () => {
    const res = runGeneration({ id: 7, n: 10, k: 3, options: { polish: false } });
    expect(res.id).toBe(7);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.edges.length).toBeGreaterThan(0);
    expect(res.result.buddies).toHaveLength(10);
  });

  it("passes options through rather than substituting defaults", () => {
    // Same (n, k, options) must give the same graph as calling the core directly:
    // a dropped or rewritten option would show up as a different edge set.
    const direct = buildBuddyGraph(24, 4, { seed: 99, minSeparation: 4, polish: false });
    const viaWorker = runGeneration({
      id: 1,
      n: 24,
      k: 4,
      options: { seed: 99, minSeparation: 4, polish: false },
    });
    expect(viaWorker.ok).toBe(true);
    if (!viaWorker.ok) return;
    expect(viaWorker.result.edges).toEqual(direct.edges);
    expect(viaWorker.result.polished).toBe(false);
  });

  it("reports connectivity from the result instead of assuming it", () => {
    const res = runGeneration({ id: 2, n: 12, k: 3, options: { polish: false } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.connected).toBe(true);
    expect(res.result.largestComponentFraction).toBe(1);
  });

  it("turns a throwing build into an error response, not an unhandled throw", () => {
    // k < 2 throws in the core: the ring seed floors every degree at 2. The main
    // thread would otherwise see a bare worker "error" event with no cause.
    const res = runGeneration({ id: 3, n: 10, k: 1, options: {} });
    expect(res.id).toBe(3);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/\S/);
  });

  it("reports a malformed roster size over the error channel too", () => {
    const res = runGeneration({ id: 4, n: -5, k: 3, options: {} });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/\S/);
  });
});
