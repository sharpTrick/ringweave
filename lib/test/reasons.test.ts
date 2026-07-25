/**
 * `validateDetailed` / `formatReason`: the structured form of `validate`.
 *
 * Two things are pinned here. First, the exact wording of all twelve messages —
 * `validate` is `validateDetailed` mapped through `formatReason`, so these strings
 * are the message contract the Python reference mirrors, and a typo would
 * otherwise only surface as a diff in one unrelated assertion. Second, that every
 * reason code is reachable and carries the roster indices a UI needs to name
 * people instead of printing "person 4".
 *
 * The `Record<Reason["code"], ...>` sample table is the mechanical part: adding a
 * variant to `Reason` without adding a sample fails the typecheck, so the
 * exhaustiveness of this file cannot silently rot.
 */
import { describe, it, expect } from "vitest";
import {
  Constraints,
  validate,
  validateDetailed,
  formatReason,
  MAX_ROSTER,
  MAX_CONSTRAINED_N,
  type Reason,
} from "../src/core/index.js";

const SAMPLES: Record<Reason["code"], { reason: Reason; text: string }> = {
  "roster-invalid": {
    reason: { code: "roster-invalid", n: -1 },
    text: "roster size -1 is not a valid count",
  },
  "roster-too-large": {
    reason: { code: "roster-too-large", n: 2_000_000, max: MAX_ROSTER },
    text: "roster size 2000000 exceeds the maximum of 1000000",
  },
  "unknown-person": {
    reason: { code: "unknown-person", person: 9, n: 4 },
    text: "constraint references unknown person 9 (roster has 4)",
  },
  "self-pair": {
    reason: { code: "self-pair", person: 2 },
    text: "person 2 cannot be paired with themselves",
  },
  "roster-too-large-constrained": {
    reason: { code: "roster-too-large-constrained", n: 9000, max: MAX_CONSTRAINED_N },
    text: "roster size 9000 exceeds the constrained maximum of 5000 (generation is O(n²))",
  },
  "buddy-count-invalid": {
    reason: { code: "buddy-count-invalid", k: -3 },
    text: "buddy count -3 must be a non-negative whole number",
  },
  "work-too-large": {
    reason: { code: "work-too-large", n: 4000, k: 900 },
    text:
      "roster size 4000 with 900 buddies each is too large to generate in reasonable time" +
      " — reduce the roster size or the buddy count",
  },
  "required-degree-exceeds-k": {
    reason: { code: "required-degree-exceeds-k", person: 4, required: 5, k: 4 },
    text: "person 4 has 5 required buddies but each person gets 4",
  },
  "required-and-prohibited": {
    // The en-dash here is the reason a UI must not do string substitution on
    // these messages: it is easy to retype as a hyphen and impossible to see.
    reason: { code: "required-and-prohibited", a: 3, b: 7 },
    text: "pair 3–7 is both required and prohibited",
  },
  "required-within-prohibited": {
    reason: { code: "required-within-prohibited", person: 1 },
    text: "person 1 cannot meet required buddies within their prohibited set",
  },
  "prohibited-from-everyone": {
    reason: { code: "prohibited-from-everyone", person: 0 },
    text: "person 0 is prohibited from everyone — they'd have no buddies",
  },
  "prohibited-splits-group": {
    reason: { code: "prohibited-splits-group", person: 2 },
    text: "prohibited pairs split the group — person 2 can never be connected to everyone",
  },
};

describe("formatReason", () => {
  for (const [code, sample] of Object.entries(SAMPLES)) {
    it(`renders ${code} verbatim`, () => {
      expect(formatReason(sample.reason)).toBe(sample.text);
    });
  }
});

/** The codes produced by `validateDetailed` for a scenario, in its own order. */
function codesFor(cons: Constraints, k: number): string[] {
  return validateDetailed(cons, k).map((r) => r.code);
}

describe("validateDetailed reachability", () => {
  it("is empty for a feasible scenario", () => {
    const cons = new Constraints(10).require(0, 1).prohibit(2, 3);
    expect(validateDetailed(cons, 4)).toEqual([]);
  });

  it("reports an out-of-range endpoint without pretending it is a person", () => {
    const reasons = validateDetailed(new Constraints(4).require(0, 9), 3);
    expect(reasons).toEqual([{ code: "unknown-person", person: 9, n: 4 }]);
    // The index is out of range on purpose — that IS the finding. A caller that
    // rendered names[9] here would print "undefined".
    expect((reasons[0] as { person: number }).person).toBeGreaterThanOrEqual(4);
  });

  it("reports a self-pair", () => {
    expect(codesFor(new Constraints(6).prohibit(2, 2), 3)).toContain("self-pair");
  });

  it("reports a required degree above the buddy count, with the numbers", () => {
    const cons = new Constraints(10);
    for (const b of [1, 2, 3, 4, 5]) cons.require(0, b);
    const reasons = validateDetailed(cons, 4);
    expect(reasons).toContainEqual({
      code: "required-degree-exceeds-k",
      person: 0,
      required: 5,
      k: 4,
    });
  });

  it("reports a pair that is both required and prohibited, naming both ends", () => {
    const cons = new Constraints(8).require(3, 7).prohibit(3, 7);
    expect(validateDetailed(cons, 4)).toContainEqual({
      code: "required-and-prohibited",
      a: 3,
      b: 7,
    });
  });

  it("reports a person prohibited from everyone", () => {
    const cons = new Constraints(4);
    for (const v of [1, 2, 3]) cons.prohibit(0, v);
    expect(codesFor(cons, 2)).toContain("prohibited-from-everyone");
  });

  it("reports a prohibited-pair split of the group", () => {
    // Isolate person 0 and person 1 from each other and from the rest, so the
    // allowed-pairs graph itself is disconnected.
    const cons = new Constraints(4);
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [0, 3],
    ] as [number, number][]) {
      cons.prohibit(a, b);
    }
    expect(codesFor(cons, 2)).toContain("prohibited-splits-group");
  });

  it("reports an invalid buddy count", () => {
    expect(validateDetailed(new Constraints(10), -1)).toEqual([
      { code: "buddy-count-invalid", k: -1 },
    ]);
  });

  it("reports a roster over the constrained cap, before any O(n²) work", () => {
    expect(validateDetailed(new Constraints(MAX_CONSTRAINED_N + 1), 4)).toEqual([
      { code: "roster-too-large-constrained", n: MAX_CONSTRAINED_N + 1, max: MAX_CONSTRAINED_N },
    ]);
  });

  it("reports an invalid roster size", () => {
    expect(validateDetailed(new Constraints(-1), 4)).toEqual([
      { code: "roster-invalid", n: -1 },
    ]);
  });
});

describe("validate is exactly validateDetailed formatted", () => {
  const scenarios: [string, Constraints, number][] = [
    ["feasible", new Constraints(10).require(0, 1), 4],
    ["conflicting pair", new Constraints(8).require(3, 7).prohibit(3, 7), 4],
    ["bad endpoint", new Constraints(4).require(0, 9), 3],
    ["invalid k", new Constraints(10), -1],
  ];
  for (const [label, cons, k] of scenarios) {
    it(`agrees on ${label}`, () => {
      expect(validate(cons, k)).toEqual(validateDetailed(cons, k).map(formatReason));
    });
  }

  it("stays sorted and deduplicated", () => {
    // Two required pairs sharing an over-subscribed person produce the same
    // message twice before dedupe.
    const cons = new Constraints(10);
    for (const b of [1, 2, 3, 4, 5]) cons.require(0, b);
    cons.prohibit(0, 6);
    const messages = validate(cons, 2);
    expect(messages).toEqual([...new Set(messages)]);
    expect(messages).toEqual([...messages].sort());
  });
});
