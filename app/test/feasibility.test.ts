import { describe, it, expect } from "vitest";
import { feasibility } from "../src/io/feasibility";

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
