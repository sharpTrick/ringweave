/**
 * The worker's request→response mapping. A module worker cannot be instantiated under jsdom,
 * so the protocol is exercised through `runGeneration` rather than through the worker itself.
 */
import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { runGeneration } from "../src/worker/generate";
import type { GenerateOptions, GenerateRequest } from "../src/worker/protocol";

/** An unconstrained request; the constrained path has its own describe block. */
function req(id: number, n: number, k: number, options: GenerateOptions = {}): GenerateRequest {
  return { id, n, k, options, constraints: { required: [], prohibited: [] } };
}

describe("runGeneration", () => {
  it("returns the built graph, echoing the correlation id", () => {
    const res = runGeneration(req(7, 10, 3, { polish: false }));
    expect(res.id).toBe(7);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.result.edges.length).toBeGreaterThan(0);
    expect(res.result.buddies).toHaveLength(10);
  });

  it("passes options through rather than substituting defaults", () => {
    const direct = buildBuddyGraph(24, 4, { seed: 99, minSeparation: 4, polish: false });
    const viaWorker = runGeneration(req(1, 24, 4, { seed: 99, minSeparation: 4, polish: false }));
    expect(viaWorker.kind).toBe("ok");
    if (viaWorker.kind !== "ok") return;
    expect(viaWorker.result.edges).toEqual(direct.edges);
    expect(viaWorker.result.polished).toBe(false);
  });

  it("reports connectivity from the result instead of assuming it", () => {
    const res = runGeneration(req(2, 12, 3, { polish: false }));
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.result.connected).toBe(true);
    expect(res.result.largestComponentFraction).toBe(1);
  });

  it("turns a throwing build into an error response, not an unhandled throw", () => {
    // k < 2 throws in the core: the ring seed floors every degree at 2.
    const res = runGeneration(req(3, 10, 1));
    expect(res.id).toBe(3);
    expect(res.kind).toBe("error");
    if (res.kind !== "error") return;
    expect(res.error).toMatch(/\S/);
  });

  it("reports a malformed roster size over the error channel too", () => {
    const res = runGeneration(req(4, -5, 3));
    expect(res.kind).toBe("error");
    if (res.kind !== "error") return;
    expect(res.error).toMatch(/\S/);
  });
});

describe("runGeneration with buddy rules", () => {
  const withRules = (
    n: number,
    k: number,
    constraints: GenerateRequest["constraints"],
  ): GenerateRequest => ({ id: 9, n, k, options: { polish: false }, constraints });

  it("honours every rule it accepts — the acceptance criterion, not a sample", () => {
    const required: [number, number][] = [[0, 5], [2, 9]];
    const prohibited: [number, number][] = [[1, 3], [4, 6]];
    const res = runGeneration(withRules(14, 4, { required, prohibited }));
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;

    const has = (a: number, b: number) =>
      res.result.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    for (const [a, b] of required) expect(has(a, b)).toBe(true);
    for (const [a, b] of prohibited) expect(has(a, b)).toBe(false);
    expect(res.result.report).not.toBeNull();
    expect(res.result.report?.reqViolations).toBe(0);
    expect(res.result.report?.prohViolations).toBe(0);
  });

  it("measures girth for the constrained path, which the core omits", () => {
    const res = runGeneration(withRules(12, 4, { required: [[0, 1]], prohibited: [] }));
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(typeof res.result.girth).toBe("number");
    expect(res.result.girth).toBeGreaterThanOrEqual(3);
  });

  it("refuses an impossible rule set instead of returning a silent partial", () => {
    // Six required buddies for one person with k=4: no graph satisfies it.
    const required: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]];
    const res = runGeneration(withRules(10, 4, { required, prohibited: [] }));
    expect(res.kind).toBe("refused");
    if (res.kind !== "refused") return;
    expect(res.refusals.length).toBeGreaterThan(0);
    expect(res.refusals.some((r) => r.code === "required-degree-exceeds-k")).toBe(true);
  });

  it("refuses a directly contradictory pair", () => {
    const res = runGeneration(withRules(8, 4, { required: [[1, 2]], prohibited: [[1, 2]] }));
    expect(res.kind).toBe("refused");
    if (res.kind !== "refused") return;
    expect(res.refusals.some((r) => r.code === "required-and-prohibited")).toBe(true);
  });

  it("reports connectivity from the constraint report, not from an assumption", () => {
    const res = runGeneration(withRules(12, 4, { required: [[0, 1]], prohibited: [[2, 3]] }));
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.result.connected).toBe(res.result.report?.connected);
    expect(res.result.largestComponentFraction).toBe(res.result.report?.largestComponentFraction);
  });

  it("leaves the unconstrained path untouched when the rule lists are empty", () => {
    // Routing everything through the constrained builder would change every
    // existing output — a different algorithm with different guarantees.
    const plain = runGeneration(req(1, 20, 4, { seed: 5, polish: false }));
    const empty = runGeneration(withRules(20, 4, { required: [], prohibited: [] }));
    expect(plain.kind).toBe("ok");
    expect(empty.kind).toBe("ok");
    if (plain.kind !== "ok" || empty.kind !== "ok") return;
    expect(empty.result.report).toBeNull();
    expect(plain.result.report).toBeNull();
  });
});
