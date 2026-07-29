import { describe, it, expect } from "vitest";
import { canGenerate as coreCanGenerate } from "ringweave";
import { feasibility } from "../src/io/feasibility";
import { BUDDY_MAX, BUDDY_MIN, MAX_ROSTER_N } from "../src/model";

describe("feasibility", () => {
  // Class: settings the core rejects/caps must be blocked in the UI, not thrown from the core.
  const cases: Array<{ n: number; k: number; canGenerate: boolean; why: string }> = [
    { n: 30, k: 4, canGenerate: true, why: "normal even product" },
    { n: 200, k: 6, canGenerate: true, why: "n far above k+1" },
    { n: 15, k: 3, canGenerate: true, why: "odd product still generates (soft note)" },
    { n: 5, k: 4, canGenerate: true, why: "n == k+1 boundary" },
    { n: 4, k: 4, canGenerate: false, why: "n < k+1 blocks" },
    { n: 10, k: 1, canGenerate: false, why: "k<2 blocks (core would throw)" },
    { n: 10, k: 0, canGenerate: false, why: "k=0 blocks" },
    { n: 10, k: -1, canGenerate: false, why: "negative k blocks" },
    { n: 10, k: 2.5, canGenerate: false, why: "non-integer k blocks" },
  ];

  for (const c of cases) {
    it(`${c.why}: (n=${c.n}, k=${c.k}) -> canGenerate=${c.canGenerate}`, () => {
      const f = feasibility(c.n, c.k);
      expect(f.canGenerate).toBe(c.canGenerate);
      if (!c.canGenerate) expect(f.messages.length).toBeGreaterThan(0);
    });
  }

  it("flags an odd person×buddy product as a soft note", () => {
    const f = feasibility(15, 3);
    expect(f.canGenerate).toBe(true);
    expect(f.messages.join(" ")).toMatch(/odd/i);
  });

  it("warns (does not block) for a large-but-allowed roster", () => {
    const f = feasibility(500, 4);
    expect(f.canGenerate).toBe(true);
    expect(f.messages.join(" ")).toMatch(/large group/i);
  });

  it("refuses a roster beyond the generation ceiling", () => {
    const f = feasibility(2000, 4);
    expect(f.canGenerate).toBe(false);
    expect(f.messages.join(" ")).toMatch(/most this tool generates/i);
  });
});

describe("the generate gate asks the core rather than mirroring its budget", () => {
  it("agrees with the core at every (n, k) the UI can express", () => {
    // The app promised `canGenerate` for its whole advertised rectangle from its own constants,
    // and that promise held only because the densest corner — n=1000, k=12 — lands on the core's
    // MAX_GREEDY_WORK by EXACTLY zero margin. Nothing tested the coincidence, and one constant
    // edit in either package would have enabled a button for a configuration the library throws
    // on. Asserted as agreement with the core's own predicate, over the whole rectangle.
    for (let n = 2; n <= MAX_ROSTER_N; n += 7) {
      for (let k = BUDDY_MIN; k <= BUDDY_MAX; k++) {
        if (n < k + 1) continue;
        expect(feasibility(n, k).canGenerate).toBe(coreCanGenerate(n, k));
      }
    }
    // ...and the corner itself, named, because it is the one with no margin.
    expect(coreCanGenerate(MAX_ROSTER_N, BUDDY_MAX)).toBe(true);
    expect(feasibility(MAX_ROSTER_N, BUDDY_MAX).canGenerate).toBe(true);
    // One person past the app's ceiling is refused by the app's own policy, in its own words.
    expect(feasibility(MAX_ROSTER_N + 1, BUDDY_MAX).canGenerate).toBe(false);
  });
});
