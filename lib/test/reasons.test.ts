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
  "too-many-invalid-constraints": {
    reason: { code: "too-many-invalid-constraints", count: 4000 },
    text: "4000 constraints are invalid — only some are listed",
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

describe("a number renders the same way in both languages", () => {
  // `formatReason`'s docblock claims byte-identity with reference-python's `format_reason`, and
  // raw interpolation broke it on exactly the values these reasons are documented to CARRY:
  // `${NaN}` is "NaN" in JS and "nan" in Python, `${Infinity}` is "Infinity" against "inf". A
  // 3,000-case differential fuzz matched 2,993 messages byte-for-byte and all 7 mismatches were
  // this class — invisible to the rest of this file, which only ever uses finite values.
  it("spells non-finite numbers Python's way, because the oracle is the spec", () => {
    expect(validate(new Constraints(4), NaN)).toEqual([
      "buddy count nan must be a non-negative whole number",
    ]);
    expect(validate(new Constraints(4), Infinity)).toEqual([
      "buddy count inf must be a non-negative whole number",
    ]);
    expect(validate(new Constraints(4), -Infinity)).toEqual([
      "buddy count -inf must be a non-negative whole number",
    ]);
    const c = new Constraints(4);
    c.prohibit(Infinity, 1);
    expect(validate(c, 2)).toEqual([
      "constraint references unknown person inf (roster has 4)",
    ]);
  });
});

describe("the structural reason list is bounded", () => {
  // It was unbounded in work AND output: two Reason objects per malformed pair, then a Map build
  // and a string SORT over all of them, then `validate` mapping formatReason over the survivors
  // again. A ten-person roster with a million out-of-range pairs returned 2,000,000 reasons in
  // 5.0 s and 925 MB; at four million the process died inside `validate` with a V8
  // out-of-memory — the function whose contract is that it refuses rather than throws, threw.
  it("summarises instead of listing, however many pairs are malformed", () => {
    const c = new Constraints(10);
    for (let i = 0; i < 50_000; i++) c.prohibit(1000 + 2 * i, 1001 + 2 * i);
    const reasons = validateDetailed(c, 4);
    expect(reasons.length).toBeLessThanOrEqual(20);
    const texts = validate(c, 4);
    expect(texts.some((t) => /100000 constraints are invalid/.test(t))).toBe(true);
    // The count is EXACT even though the list is not: two bad endpoints per pair.
    // And a small malformed set is still listed in full, not summarised away.
    const few = new Constraints(10);
    few.prohibit(99, 1);
    expect(validate(few, 4)).toEqual([
      "constraint references unknown person 99 (roster has 10)",
    ]);
  });

  it("lists the same reasons whatever order the constraint set was built in", () => {
    // The cap has to choose WHICH reasons survive, and choosing "the first 16 encountered" made
    // that choice a function of `Set` insertion order — so the same constraint SET, built
    // forwards or backwards, refused with different text. The Python mirror iterates its sets in
    // hash order and would have disagreed with both, which is the message parity this module is
    // held to. Selecting the alphabetically smallest distinct messages is order-free.
    const bad: [number, number][] = [];
    for (let i = 0; i < 60; i++) bad.push([200 + i, 400 + i]);

    const forward = new Constraints(10);
    for (const [a, b] of bad) forward.prohibit(a, b);
    const backward = new Constraints(10);
    for (let i = bad.length - 1; i >= 0; i--) backward.prohibit(bad[i][1], bad[i][0]);
    // A third order that interleaves the three pair kinds, since the scan reads them in sequence.
    const mixed = new Constraints(10);
    for (let i = 0; i < bad.length; i++) {
      const [a, b] = bad[(i * 37) % bad.length];
      if (i % 3 === 0) mixed.require(a, b);
      else if (i % 3 === 1) mixed.prohibit(a, b);
      else mixed.addPrior(a, b);
    }

    expect(validate(backward, 4)).toEqual(validate(forward, 4));
    expect(validate(mixed, 4)).toEqual(validate(forward, 4));
    // Non-vacuity: the cap must actually be biting, or all three agree trivially.
    expect(validate(forward, 4).length).toBe(17); // 16 listed + the exact-count summary
    // And the survivors are distinct, which "the first 16" did not guarantee: a thousand copies
    // of one fault used to fill every slot and dedupe back down to a single listed reason.
    const listed = validate(forward, 4).filter((t) => !/constraints are invalid/.test(t));
    expect(new Set(listed).size).toBe(listed.length);
  });
});
