import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { rerollWouldVary, POLISH_MAX_N, DEFAULT_SETTINGS } from "../src/model";

// Class: "Different arrangement" (seed++) must only claim to vary the graph when it actually
// can — i.e. when polish (the sole seed-dependent stage) runs. Guards against reintroducing a
// silent no-op if the polish cap ever shifts.
describe("reroll variability", () => {
  it("rerollWouldVary iff polish would run (n<=POLISH_MAX_N and polish not off)", () => {
    expect(rerollWouldVary(60, { ...DEFAULT_SETTINGS, polish: "auto" })).toBe(true);
    expect(rerollWouldVary(POLISH_MAX_N, { ...DEFAULT_SETTINGS })).toBe(true);
    expect(rerollWouldVary(POLISH_MAX_N + 1, { ...DEFAULT_SETTINGS })).toBe(false);
    expect(rerollWouldVary(60, { ...DEFAULT_SETTINGS, polish: false })).toBe(false);
  });

  it("mirrors the core: a seed bump changes edges iff the graph was polished", () => {
    // At/below the cap the graph is polished, so different seeds give different edges.
    // (small n + short polish keeps the test fast while staying seed-dependent.)
    const a = buildBuddyGraph(30, 4, { seed: 1, polishIters: 2000 });
    const b = buildBuddyGraph(30, 4, { seed: 2, polishIters: 2000 });
    expect(a.polished).toBe(true);
    expect(b.edges).not.toEqual(a.edges);
    // Above the cap polish is off and greedy is RNG-free — identical regardless of seed.
    const c = buildBuddyGraph(POLISH_MAX_N + 80, 4, { seed: 1 });
    const d = buildBuddyGraph(POLISH_MAX_N + 80, 4, { seed: 99999 });
    expect(c.polished).toBe(false);
    expect(d.edges).toEqual(c.edges);
  }, 20000);
});
