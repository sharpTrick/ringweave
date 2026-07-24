import { describe, it, expect } from "vitest";
import { parseRoster, MAX_NAMES } from "../src/io/parseRoster";

const hasControlChar = (s: string): boolean =>
  [...s].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);

describe("parseRoster", () => {
  it("splits on newlines and commas, trims, drops blanks", () => {
    const { names } = parseRoster("  Alice \n Bob,Carol\n\n , Dev ");
    expect(names).toEqual(["Alice", "Bob", "Carol", "Dev"]);
  });

  it("flags duplicates instead of silently dropping them (case-insensitive)", () => {
    const { names, warnings } = parseRoster("Alice\nBob\nalice\nAlice");
    expect(names).toEqual(["Alice", "Bob"]); // first occurrence kept once
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/2 duplicate/);
    expect(warnings[0]).toMatch(/alice|Alice/);
  });

  // Class: same person in mixed casing with multiple extra copies must be reported as ONE
  // de-duplicated person (by the kept casing), with the count = total extra copies dropped.
  it("lists each case-variant person once in the dedupe warning, by the kept casing", () => {
    const { names, warnings } = parseRoster("Alice\nalice\nALICE\nBob\nBOB");
    expect(names).toEqual(["Alice", "Bob"]); // first-seen casing kept
    const w = warnings.join(" ");
    expect(w).toMatch(/Removed 3 duplicate entries/); // 2 extra Alices + 1 extra Bob
    // each distinct person appears once in the parenthetical, by kept casing
    const list = w.match(/\(([^)]*)\)/)![1];
    expect(list.split(", ").sort()).toEqual(["Alice", "Bob"]);
  });

  it("no warnings when there are no duplicates", () => {
    const { names, warnings } = parseRoster("A\nB\nC");
    expect(names).toEqual(["A", "B", "C"]);
    expect(warnings).toEqual([]);
  });

  it("30 pasted names -> 30 names (F1 acceptance)", () => {
    const raw = Array.from({ length: 30 }, (_, i) => `Person ${i}`).join("\n");
    expect(parseRoster(raw).names).toHaveLength(30);
  });

  // Class: a name must never carry an embedded cell/row delimiter into a spreadsheet-bound
  // sink (buddy list / CSV / clipboard). Control chars (tab, CR, other C0/DEL) are normalized
  // to spaces so a pasted line can't split into a field that begins a live formula.
  it("normalizes embedded control chars (tab/CR) to spaces, keeping one name per line", () => {
    const bell = String.fromCharCode(7);
    const raw = "foo\t=cmd\nbar\rbaz\nqux" + bell + "end";
    const { names } = parseRoster(raw);
    expect(names).toEqual(["foo =cmd", "bar baz", "qux end"]); // one name each, control -> space
    for (const nm of names) expect(hasControlChar(nm)).toBe(false);
  });

  it("caps the number of names and warns (no unbounded parse)", () => {
    const raw = Array.from({ length: MAX_NAMES + 500 }, (_, i) => `P${i}`).join("\n");
    const { names, warnings } = parseRoster(raw);
    expect(names).toHaveLength(MAX_NAMES);
    expect(warnings.join(" ")).toMatch(/maximum/i);
  });

  // Class: the truncation warning must fire only when a DISTINCT name is actually dropped by
  // the cap — not when the overflow past MAX_NAMES was just blanks or duplicates (nothing lost).
  describe("cap warning tracks real loss, not raw token count past the cap", () => {
    const uniques = Array.from({ length: MAX_NAMES }, (_, i) => `U${i}`);
    const capWarned = (raw: string) => parseRoster(raw).warnings.join(" ").match(/maximum/i) != null;

    it("exactly MAX_NAMES uniques -> kept all, no cap warning", () => {
      const { names } = parseRoster(uniques.join("\n"));
      expect(names).toHaveLength(MAX_NAMES);
      expect(capWarned(uniques.join("\n"))).toBe(false);
    });

    it("MAX_NAMES uniques + trailing duplicates/blanks -> no cap warning (nothing lost)", () => {
      expect(capWarned([...uniques, uniques[0]].join("\n"))).toBe(false);       // trailing dup
      expect(capWarned([...uniques, "   ", ""].join("\n"))).toBe(false);         // trailing blanks
      expect(capWarned([...uniques, uniques[3], "  "].join("\n"))).toBe(false);  // dup + blank
    });

    it("MAX_NAMES uniques + a trailing NEW name -> cap warning (a distinct name was dropped)", () => {
      const { names } = parseRoster([...uniques, "OneMore"].join("\n"));
      expect(names).toHaveLength(MAX_NAMES);
      expect(capWarned([...uniques, "OneMore"].join("\n"))).toBe(true);
    });
  });

  it("truncates a pathologically long paste fast, with a warning", () => {
    const raw = "name,".repeat(1_100_000); // ~5.5M chars, well over MAX_PARSE_CHARS
    const start = performance.now();
    const { warnings } = parseRoster(raw);
    expect(performance.now() - start).toBeLessThan(500);
    expect(warnings.join(" ")).toMatch(/characters/i);
  });
});
