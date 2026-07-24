import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";

// The worker is a 5-line shell around buildBuddyGraph; jsdom can't host a module
// worker, so we test the payload — the core call — directly. This guards the two
// properties the worker relies on: determinism and structured-clone-safe output.
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
    expect(() => buildBuddyGraph(10, 1, {})).toThrow();
  });
});
