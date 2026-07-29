import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";

// jsdom cannot host a module worker, so the payload — the core call the worker wraps — is tested
// directly: determinism and structured-clone-safe output are what the worker relies on.
describe("buildBuddyGraph (worker payload)", () => {
  it("is deterministic for identical inputs", () => {
    const a = buildBuddyGraph(30, 4, { seed: 12345 });
    const b = buildBuddyGraph(30, 4, { seed: 12345 });
    expect(b.edges).toEqual(a.edges);
    expect(b.buddies).toEqual(a.buddies);
    expect(b.aspl).toEqual(a.aspl);
  });

  it("returns plain, structured-clone-safe data (no Sets)", () => {
    const r = buildBuddyGraph(24, 4, {});
    expect(Array.isArray(r.edges)).toBe(true);
    expect(Array.isArray(r.buddies)).toBe(true);
    expect(r.buddies.every((row) => Array.isArray(row))).toBe(true);
    expect(Number.isFinite(r.aspl)).toBe(true);
  });

  it("throws on k<2 (surfaced over the worker error channel)", () => {
    // Assert the contract, not merely "something threw" — a bare .toThrow() would also pass on a
    // TypeError from a mistyped call, hiding whether the k<2 guard actually fired.
    expect(() => buildBuddyGraph(10, 1, {})).toThrow(/k >= 2/);
  });
});
