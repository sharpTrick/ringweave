import { describe, it, expect } from "vitest";
import { buildBuddyGraph, autoPolishEnabled } from "ringweave";
import { rerollBlockReason, nextRerollSeed, SEED_MAX, DEFAULT_SETTINGS } from "../src/model";

/** A roster size the core will NOT auto-polish at this k — found, not assumed. */
function tooLargeToVary(k: number): number {
  for (let n = 4; n <= 4000; n++) if (!autoPolishEnabled(n, k)) return n;
  throw new Error(`no non-polishing n found for k=${k}`);
}

describe("reroll gate messages (rerollBlockReason)", () => {
  it("a too-large group says so and never advises enabling already-on polish", () => {
    for (const polish of [false, "auto", true] as const) {
      const reason = rerollBlockReason(tooLargeToVary(DEFAULT_SETTINGS.buddies), {
        ...DEFAULT_SETTINGS,
        polish,
      });
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
    const big = tooLargeToVary(4) + 80;
    const c = buildBuddyGraph(big, 4, { seed: 1 });
    const d = buildBuddyGraph(big, 4, { seed: 99999 });
    expect(c.polished).toBe(false);
    expect(d.edges).toEqual(c.edges);
  });

  // The app no longer mirrors the core's cap as a literal — it calls the core's own
  // `autoPolishEnabled`. So the property to pin is no longer "120 is the boundary" but
  // "the predicate the reroll copy is derived from agrees with what the builder does",
  // AT EVERY k. The old test pinned k=4 only, which is exactly why a k-blind literal
  // survived: 120 is right at k=4 and wrong at every other k the UI offers.
  it("the predicate reroll copy is derived from agrees with the builder, at every k", () => {
    // polishIters:1 keeps it fast — we're pinning WHETHER auto-polish runs, not how much
    // it iterates; `polished` reflects that the stage executed either way.
    for (const k of [2, 3, 4, 6, 12]) {
      const boundary = tooLargeToVary(k);
      expect(autoPolishEnabled(boundary - 1, k)).toBe(true);
      expect(buildBuddyGraph(boundary - 1, k, { polish: "auto", polishIters: 1 }).polished).toBe(true);
      expect(buildBuddyGraph(boundary, k, { polish: "auto", polishIters: 1 }).polished).toBe(false);
      // And the user-facing copy follows the same predicate, so it can never claim a
      // roster is "too large to shuffle" that the builder would in fact polish.
      const settings = { ...DEFAULT_SETTINGS, buddies: k, polish: "auto" as const };
      expect(rerollBlockReason(boundary - 1, settings)).toBeNull();
      expect(rerollBlockReason(boundary, settings)).toMatch(/too large/i);
    }
  });

  it("the k-blind literal it replaced would have been wrong here", { timeout: 60_000 }, () => {
    // The regression this closes, stated as a fact about the old constant: 120 was the
    // cap, and at k=3 the core polishes well past it — so the app refused to dispatch a
    // reroll that would have worked.
    expect(autoPolishEnabled(125, 3)).toBe(true);
    // A reduced iteration count, because the claim is that the seed reaches the RNG at all —
    // not that a full budget was spent. Two default-budget builds here cost 36 s; 1500 is 3 s
    // and still diverges.
    //
    // The number is load-bearing and has moved once: at 300 the two seeds converge to the same
    // graph (the plateau this file's other tests are about), and 1000 stopped diverging when
    // the anneal calibration started being charged against the loop allowance — up to 100
    // sweeps that were previously free. That is the budget getting more honest, not a
    // regression, and the default-budget output is byte-identical either way.
    const a = buildBuddyGraph(125, 3, { seed: 1, polishIters: 1500 });
    const b = buildBuddyGraph(125, 3, { seed: 2, polishIters: 1500 });
    expect(a.polished).toBe(true);
    expect(a.edges).not.toEqual(b.edges); // a seed bump DOES vary it
    expect(rerollBlockReason(125, { ...DEFAULT_SETTINGS, buddies: 3 })).toBeNull();
  });
});
