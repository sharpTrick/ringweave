import { describe, it, expect } from "vitest";
import { fuzzyMatch, rankMatches } from "../src/search";

const ROSTER = [
  "Alice Nguyen",
  "Ben Carter",
  "John Smith",
  "Jo Sanders",
  "Chloe Diaz",
  "Sam Jones",
];

describe("fuzzyMatch", () => {
  it("finds a subsequence, which is the acceptance criterion", () => {
    expect(fuzzyMatch("jsmi", "John Smith")).not.toBeNull();
  });

  it("returns where each query character landed", () => {
    // "j" at 0, then "s" at 5, "m" at 6, "i" at 7 — after the space.
    expect(fuzzyMatch("jsmi", "John Smith")).toEqual([0, 5, 6, 7]);
  });

  it("requires order, not just presence", () => {
    expect(fuzzyMatch("hj", "John")).toBeNull(); // h comes after j in "John"
    expect(fuzzyMatch("jh", "John")).toEqual([0, 2]);
  });

  it("ignores case on both sides and surrounding query whitespace", () => {
    expect(fuzzyMatch("ALICE", "alice nguyen")).not.toBeNull();
    expect(fuzzyMatch("  ben ", "Ben Carter")).not.toBeNull();
  });

  it("never matches on an empty or whitespace-only query", () => {
    // An empty box means "no query", not "everyone" — the list must stay closed.
    expect(fuzzyMatch("", "Anyone")).toBeNull();
    expect(fuzzyMatch("   ", "Anyone")).toBeNull();
  });

  it("does not reuse a character to satisfy two query characters", () => {
    expect(fuzzyMatch("aa", "Alice")).toBeNull();
    expect(fuzzyMatch("aa", "Anna Adams")).not.toBeNull();
  });
});

describe("rankMatches", () => {
  it("finds John Smith from 'jsmi' and no one else", () => {
    expect(rankMatches("jsmi", ROSTER, 8).map((m) => ROSTER[m.index])).toEqual(["John Smith"]);
  });

  it("prefers an earlier match start", () => {
    // "sa": "Sam Jones" starts at 0; "Jo Sanders" matches at 3.
    expect(rankMatches("sa", ROSTER, 8).map((m) => ROSTER[m.index])).toEqual([
      "Sam Jones",
      "Jo Sanders",
    ]);
  });

  it("prefers a tighter match when both start at the same place", () => {
    const names = ["Jonathan", "J o n"];
    // Both start at 0; "Jonathan" has the contiguous run.
    expect(rankMatches("jon", names, 8).map((m) => names[m.index])).toEqual(["Jonathan", "J o n"]);
  });

  it("breaks remaining ties by roster position, so the order is total", () => {
    const names = ["Ann", "Ann", "Ann"]; // identical matches
    expect(rankMatches("an", names, 8).map((m) => m.index)).toEqual([0, 1, 2]);
  });

  it("is stable across calls — the same query always yields the same order", () => {
    const once = rankMatches("n", ROSTER, 8);
    const twice = rankMatches("n", ROSTER, 8);
    expect(once).toEqual(twice);
  });

  it("respects the limit", () => {
    expect(rankMatches("a", ROSTER, 2)).toHaveLength(2);
    expect(rankMatches("a", ROSTER, 0)).toHaveLength(0);
  });

  it("returns nothing for an empty query or an unmatched one", () => {
    expect(rankMatches("", ROSTER, 8)).toEqual([]);
    expect(rankMatches("zzz", ROSTER, 8)).toEqual([]);
  });

  it("measures scatter in the same unit it counts matches in", () => {
    // A name matched against ITSELF is the tightest match possible, so its positions must be
    // 0,1,2,… — contiguous — for every name, not only all-BMP ones.
    for (const name of ["A\u00F1o\u{1F600}b", "\u{1F600}\u{1F601}\u{1F602}", "Jos\u00E9", "John Smith"]) {
      const positions = fuzzyMatch(name, name);
      expect(positions).not.toBeNull();
      expect(positions).toEqual(positions!.map((_, i) => i));
    }
    // And the ranking consequence, end to end: the contiguous match must outrank the scattered
    // one when both start at the same offset.
    const roster = ["\u{1F600}ab", "\u{1F600}xaxb"];
    expect(rankMatches("\u{1F600}ab", roster, 8).map((m) => m.index)).toEqual([0, 1]);
  });
});
