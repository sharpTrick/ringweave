import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { rerollBlockReason, nextRerollSeed, POLISH_MAX_N, SEED_MAX, DEFAULT_SETTINGS } from "../src/model";

describe("reroll gate messages (rerollBlockReason)", () => {
  it("a too-large group says so and never advises enabling already-on polish", () => {
    for (const polish of [false, "auto", true] as const) {
      const reason = rerollBlockReason(POLISH_MAX_N + 1, { ...DEFAULT_SETTINGS, polish });
      expect(reason).toMatch(/too large/i);
      expect(reason).not.toMatch(/turn on polish/i);
    }
  });

  it("only advises enabling Polish when polish is OFF and the group is small enough", () => {
    expect(rerollBlockReason(20, { ...DEFAULT_SETTINGS, polish: false })).toMatch(/turn on polish/i);
    // small + polish would run -> no pre-hoc block (the plateau is caught post-generation)
    expect(rerollBlockReason(20, { ...DEFAULT_SETTINGS, polish: "auto" })).toBeNull();
    expect(rerollBlockReason(20, { ...DEFAULT_SETTINGS, polish: true })).toBeNull();
  });
});

describe("reroll seed stays within [0, SEED_MAX] (nextRerollSeed)", () => {
  // Class: the stored/dispatched reroll seed must always honor the range the import path also
  // clamps to — never overflow past float-safe integers, always advance to a distinct value.
  it("advances by one below the ceiling and wraps to 0 at it", () => {
    for (const seed of [0, 1, SEED_MAX - 2, SEED_MAX - 1]) {
      const next = nextRerollSeed(seed);
      expect(next).toBe(seed + 1);
      expect(Number.isInteger(next)).toBe(true);
    }
    expect(nextRerollSeed(SEED_MAX)).toBe(0); // wrap, not overflow
  });

  it("never leaves the declared range and always changes the seed, even past the ceiling", () => {
    for (const seed of [0, SEED_MAX - 1, SEED_MAX, SEED_MAX + 5, 2 ** 40]) {
      const next = nextRerollSeed(seed);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(SEED_MAX);
      expect(next).not.toBe(seed); // a reroll must actually pick a new seed
    }
  });
});

describe("core reroll behavior (why post-hoc detection is needed)", () => {
  it("a seed bump can be a no-op even below the polish cap (unique / converged graph)", () => {
    // n=5,k=4 is K5 (unique) -> identical across seeds even though polish 'runs'.
    const a = buildBuddyGraph(5, 4, { seed: 1 });
    const b = buildBuddyGraph(5, 4, { seed: 2 });
    expect(a.edges).toEqual(b.edges); // pre-hoc "polish runs" can't predict this; post-hoc must
  });

  it("above the polish cap a seed bump is always a no-op", () => {
    const c = buildBuddyGraph(POLISH_MAX_N + 80, 4, { seed: 1 });
    const d = buildBuddyGraph(POLISH_MAX_N + 80, 4, { seed: 99999 });
    expect(c.polished).toBe(false);
    expect(d.edges).toEqual(c.edges);
  });
});
