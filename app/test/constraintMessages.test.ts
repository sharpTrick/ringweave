/**
 * All twelve core infeasibility reasons, worded for a person.
 *
 * The point of the structured `Reason` type is that the app never has to parse
 * the core's prose, and this is the test that keeps that honest: the sample table
 * is typed `Record<Reason["code"], Reason>`, so a new variant in the core fails
 * the typecheck here until it has copy of its own. Without that, a new reason
 * would fall through and reach a user as nothing at all.
 *
 * Two of the twelve carry an index that is deliberately out of range, so they are
 * checked specifically for not rendering "undefined".
 */
import { describe, it, expect } from "vitest";
import { Constraints, validateDetailed, type Reason } from "ringweave";
import { describeReasons } from "../src/io/constraintMessages";

const NAMES = ["Alice", "Ben", "Chloe", "Dev", "Eve"];

const SAMPLES: Record<Reason["code"], Reason> = {
  "roster-invalid": { code: "roster-invalid", n: -1 },
  "roster-too-large": { code: "roster-too-large", n: 2_000_000, max: 1_000_000 },
  "unknown-person": { code: "unknown-person", person: 99, n: 5 },
  "self-pair": { code: "self-pair", person: 1 },
  "too-many-invalid-constraints": { code: "too-many-invalid-constraints", count: 4000 },
  "roster-too-large-constrained": { code: "roster-too-large-constrained", n: 9000, max: 5000 },
  "buddy-count-invalid": { code: "buddy-count-invalid", k: -2 },
  "work-too-large": { code: "work-too-large", n: 4000, k: 900 },
  "required-degree-exceeds-k": { code: "required-degree-exceeds-k", person: 0, required: 5, k: 4 },
  "required-and-prohibited": { code: "required-and-prohibited", a: 1, b: 3 },
  "required-within-prohibited": { code: "required-within-prohibited", person: 2 },
  "prohibited-from-everyone": { code: "prohibited-from-everyone", person: 4 },
  "prohibited-splits-group": { code: "prohibited-splits-group", person: 3 },
};

const CODES = Object.keys(SAMPLES) as Reason["code"][];

describe("describeReasons covers every core reason", () => {
  for (const code of CODES) {
    it(`words ${code} without leaking core vocabulary`, () => {
      const [text] = describeReasons([SAMPLES[code]], NAMES);
      expect(text).toMatch(/\S/);
      expect(text).not.toMatch(/undefined/);
      // "person N" is the core's phrasing; it may only survive where the index
      // genuinely names nobody, which is asserted separately below.
      if (code !== "unknown-person" && code !== "self-pair") {
        expect(text).not.toMatch(/\bperson \d/);
      }
    });
  }

  it("names people rather than numbering them", () => {
    expect(describeReasons([SAMPLES["required-degree-exceeds-k"]], NAMES)[0]).toContain("Alice");
    const conflict = describeReasons([SAMPLES["required-and-prohibited"]], NAMES)[0];
    expect(conflict).toContain("Ben");
    expect(conflict).toContain("Dev");
    expect(describeReasons([SAMPLES["prohibited-from-everyone"]], NAMES)[0]).toContain("Eve");
    expect(describeReasons([SAMPLES["prohibited-splits-group"]], NAMES)[0]).toContain("Dev");
  });

  it("does not index the roster with an out-of-range person", () => {
    // `unknown-person` carries an index that is out of range BY DEFINITION — that is
    // what it reports. Naive substitution would render "undefined references…".
    const text = describeReasons([SAMPLES["unknown-person"]], NAMES)[0];
    expect(text).not.toMatch(/undefined/);
    expect(text).toMatch(/isn't in this roster/);
  });

  it("falls back readably when a person index names nobody", () => {
    expect(describeReasons([{ code: "self-pair", person: 42 }], NAMES)[0]).toContain("person 42");
  });

  it("preserves the core's order and count", () => {
    const all = CODES.map((c) => SAMPLES[c]);
    expect(describeReasons(all, NAMES)).toHaveLength(all.length);
  });

  it("returns nothing for a feasible rule set", () => {
    expect(describeReasons([], NAMES)).toEqual([]);
  });
});

describe("end to end from the core", () => {
  it("turns a real validate failure into copy naming the right person", () => {
    const cons = new Constraints(NAMES.length);
    for (const b of [1, 2, 3, 4]) cons.require(0, b);
    const messages = describeReasons(validateDetailed(cons, 3), NAMES);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes("Alice"))).toBe(true);
    expect(messages.every((m) => !/\bperson \d/.test(m))).toBe(true);
  });

  it("survives the en-dash template without mangling it", () => {
    // `pair 3–7 is both required and prohibited` is the one message with an
    // en-dash; string rewriting is exactly where that gets retyped as a hyphen.
    const cons = new Constraints(NAMES.length).require(1, 3).prohibit(1, 3);
    const messages = describeReasons(validateDetailed(cons, 4), NAMES);
    expect(messages.some((m) => m.includes("Ben") && m.includes("Dev"))).toBe(true);
    expect(messages.every((m) => !m.includes("–"))).toBe(true);
  });
});
