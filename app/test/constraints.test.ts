/**
 * The app's constraint model, and specifically the roster-edit hazard it exists
 * to close.
 *
 * Pairs are stored positionally everywhere they are persisted (view, file format,
 * worker protocol) and the roster is editable, so a naive implementation
 * re-points every rule at different humans when a person is removed. The editor
 * therefore holds names and converts at the boundary; these tests pin that
 * conversion, including that a rule lost to a removed person is *counted*, not
 * silently dropped.
 */
import { describe, it, expect } from "vitest";
import { validateDetailed } from "ringweave";
import {
  MAX_CONSTRAINT_PAIRS,
  joinPairs,
  pairKey,
  resolveNamedPairs,
  resolvePerson,
  splitPairs,
  toConstraints,
  toNamedPairs,
  type ConstraintPair,
  type NamedPair,
} from "../src/constraints";

const ROSTER = ["Alice", "Ben", "Chloe", "Dev"];

describe("splitPairs / joinPairs", () => {
  it("round-trips through the two-list file shape", () => {
    const pairs: ConstraintPair[] = [
      { a: 0, b: 1, kind: "required" },
      { a: 2, b: 3, kind: "prohibited" },
      { a: 0, b: 3, kind: "required" },
    ];
    const split = splitPairs(pairs);
    expect(split).toEqual({ required: [[0, 1], [0, 3]], prohibited: [[2, 3]] });
    // joinPairs groups by kind, so compare as sets of keys rather than by order.
    expect(joinPairs(split.required, split.prohibited).map(pairKey).sort()).toEqual(
      pairs.map(pairKey).sort(),
    );
  });

  it("treats (a,b) and (b,a) of one kind as the same rule, and the two kinds as different", () => {
    expect(pairKey({ a: 3, b: 1, kind: "required" })).toBe(pairKey({ a: 1, b: 3, kind: "required" }));
    expect(pairKey({ a: 1, b: 3, kind: "required" })).not.toBe(
      pairKey({ a: 1, b: 3, kind: "prohibited" }),
    );
  });
});

describe("toNamedPairs", () => {
  it("names both ends", () => {
    expect(toNamedPairs([{ a: 0, b: 2, kind: "prohibited" }], ROSTER)).toEqual([
      { a: "Alice", b: "Chloe", kind: "prohibited" },
    ]);
  });

  it("drops a pair pointing past the roster rather than rendering undefined", () => {
    expect(toNamedPairs([{ a: 0, b: 9, kind: "required" }], ROSTER)).toEqual([]);
  });
});

describe("resolveNamedPairs — the roster-edit hazard", () => {
  const rules: NamedPair[] = [
    { a: "Alice", b: "Dev", kind: "required" },
    { a: "Ben", b: "Chloe", kind: "prohibited" },
  ];

  it("follows people to their new positions when the roster is reordered", () => {
    // Positionally, "Alice & Dev" was {0,3}. After the reorder it must be {3,0} —
    // i.e. still Alice and Dev, not whoever now sits at 0 and 3.
    const reordered = ["Dev", "Ben", "Chloe", "Alice"];
    const { pairs, dropped } = resolveNamedPairs(rules, reordered);
    expect(dropped).toBe(0);
    expect(toNamedPairs(pairs, reordered)).toEqual([
      { a: "Alice", b: "Dev", kind: "required" },
      { a: "Ben", b: "Chloe", kind: "prohibited" },
    ]);
  });

  it("re-points nobody when someone is removed — it drops the rule and says so", () => {
    // This is the failure being prevented: with positional pairs, deleting Ben
    // would leave {0,3} pointing at Alice and a person who used to be someone else.
    const shorter = ["Alice", "Chloe", "Dev"];
    const { pairs, dropped } = resolveNamedPairs(rules, shorter);
    expect(dropped).toBe(1);
    expect(toNamedPairs(pairs, shorter)).toEqual([
      { a: "Alice", b: "Dev", kind: "required" },
    ]);
  });

  it("matches case-insensitively, as the roster parser de-duplicates", () => {
    const recased = ["alice", "ben", "chloe", "dev"];
    expect(resolveNamedPairs(rules, recased).dropped).toBe(0);
  });

  it("ignores surrounding whitespace from a half-typed row", () => {
    expect(resolveNamedPairs([{ a: "  Alice ", b: "Ben", kind: "required" }], ROSTER).pairs).toEqual([
      { a: 0, b: 1, kind: "required" },
    ]);
  });

  it("drops an incomplete row without counting it as a real rule loss", () => {
    // A blank row is a row the user is still filling in, not a lost rule — but it
    // is still reported, because the alternative is a rule that silently isn't applied.
    const { pairs, dropped } = resolveNamedPairs([{ a: "Alice", b: "", kind: "required" }], ROSTER);
    expect(pairs).toEqual([]);
    expect(dropped).toBe(1);
  });

  it("drops a self-pair", () => {
    expect(resolveNamedPairs([{ a: "Ben", b: "ben", kind: "required" }], ROSTER).pairs).toEqual([]);
  });

  it("de-duplicates, counting the collapse", () => {
    const dupes: NamedPair[] = [
      { a: "Alice", b: "Ben", kind: "required" },
      { a: "Ben", b: "Alice", kind: "required" },
    ];
    const { pairs, dropped } = resolveNamedPairs(dupes, ROSTER);
    expect(pairs).toHaveLength(1);
    expect(dropped).toBe(1);
  });
});

describe("resolvePerson", () => {
  it("finds an exact name, ignoring case and surrounding space", () => {
    expect(resolvePerson("Chloe", ROSTER)).toBe(2);
    expect(resolvePerson("  chloe  ", ROSTER)).toBe(2);
  });

  it("returns -1 for a partial or unknown name — it is not a fuzzy matcher", () => {
    expect(resolvePerson("Chl", ROSTER)).toBe(-1);
    expect(resolvePerson("Nobody", ROSTER)).toBe(-1);
    expect(resolvePerson("", ROSTER)).toBe(-1);
    expect(resolvePerson("   ", ROSTER)).toBe(-1);
  });

  it("resolves a duplicate-cased name to the first occurrence, as the parser keeps it", () => {
    expect(resolvePerson("alice", ["Alice", "ALICE"])).toBe(0);
  });
});

describe("MAX_CONSTRAINT_PAIRS", () => {
  it("is a real bound the import path can check before per-pair work", () => {
    expect(Number.isInteger(MAX_CONSTRAINT_PAIRS)).toBe(true);
    expect(MAX_CONSTRAINT_PAIRS).toBeGreaterThan(0);
  });
});

describe("the editor's pre-flight and the worker's check cannot disagree", () => {
  // `toConstraints` normalises to required-then-prohibited so the two callers — RosterModal's
  // pre-flight, which follows the user's EDIT order, and the worker, which does all requireds
  // then all prohibiteds — build the same object. The docblock says so; nothing held it. Order
  // happens not to matter today because both sets are Set-backed, and that is exactly what makes
  // the duplication comfortable: the failure would be the editor calling a rule set feasible that
  // the worker then refuses, which is a silent disagreement between the message a user reads and
  // the answer they get. Asserted mechanically rather than described.
  const shapes: ConstraintPair[][] = [
    [{ a: 0, b: 1, kind: "required" }, { a: 2, b: 3, kind: "prohibited" }, { a: 1, b: 4, kind: "required" }],
    [{ a: 5, b: 2, kind: "prohibited" }, { a: 0, b: 3, kind: "prohibited" }, { a: 4, b: 5, kind: "required" }],
    [{ a: 1, b: 2, kind: "required" }],
    [],
  ];

  const shuffles = (pairs: ConstraintPair[]): ConstraintPair[][] => [
    pairs,
    [...pairs].reverse(),
    // The worker's own order: everything required, then everything prohibited.
    joinPairs(splitPairs(pairs).required, splitPairs(pairs).prohibited),
  ];

  it("builds the same Constraints whatever order the rules arrive in", () => {
    for (const pairs of shapes) {
      const built = shuffles(pairs).map((order) => toConstraints(8, order));
      for (const c of built) {
        // `prohibitedCount` is the only count the core exposes — there is no `requiredCount`, and
        // asserting one would have compared undefined to undefined and passed while checking
        // nothing. The membership sweep below is what actually holds this.
        expect(c.prohibitedCount).toBe(built[0].prohibitedCount);
        // Membership, not just counts — a reordering that swapped two pairs' KINDS would keep
        // both counts and change the answer.
        for (let a = 0; a < 8; a++) {
          for (let b = a + 1; b < 8; b++) {
            expect(c.isRequired(a, b)).toBe(built[0].isRequired(a, b));
            expect(c.isProhibited(a, b)).toBe(built[0].isProhibited(a, b));
          }
        }
      }
    }
  });

  it("gives the same feasibility verdict from either caller's order", () => {
    for (const pairs of shapes) {
      for (const k of [2, 3, 4]) {
        const verdicts = shuffles(pairs).map((order) => validateDetailed(toConstraints(8, order), k));
        for (const v of verdicts) expect(v).toEqual(verdicts[0]);
      }
    }
  });
});
