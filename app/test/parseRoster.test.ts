import { describe, it, expect } from "vitest";
import {
  parseRoster, charCapNotice, MAX_NAMES, MAX_PARSE_CHARS, MAX_NAME_CHARS,
} from "../src/io/parseRoster";

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

  it("lists each case-variant person once in the dedupe warning, by the kept casing", () => {
    const { names, warnings } = parseRoster("Alice\nalice\nALICE\nBob\nBOB");
    expect(names).toEqual(["Alice", "Bob"]); // first-seen casing kept
    const w = warnings.join(" ");
    expect(w).toMatch(/Removed 3 duplicate entries/); // 2 extra Alices + 1 extra Bob
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

  // A name must never carry a cell/row delimiter into a spreadsheet-bound sink (buddy list, CSV,
  // clipboard), where a pasted line could split into a field that begins a live formula.
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

  it("the char-cap warning is exactly charCapNotice (single source with the UI)", () => {
    const { warnings } = parseRoster("x".repeat(MAX_PARSE_CHARS + 1));
    expect(warnings).toContain(charCapNotice());
  });
});

describe("what the parser emits, it must be able to re-parse", () => {
  // importGraph refuses any file whose names parseRoster would not reproduce exactly, so a name
  // this parser emits but would itself change is a file the app can no longer re-import.
  const long = (suffix: string) => "x".repeat(MAX_NAME_CHARS - 1) + " " + suffix;

  it("never emits a name it would itself change on a second pass", () => {
    const { names } = parseRoster([long("alpha"), long("beta"), "Ada"].join("\n"));
    for (const n of names) {
      expect(n).toBe(n.trim());
      expect(n.length).toBeLessThanOrEqual(MAX_NAME_CHARS);
    }
    expect(parseRoster(names.join("\n")).names).toEqual(names);
  });

  it("never emits two names that collide case-insensitively after truncation", () => {
    const { names } = parseRoster([long("alpha"), long("beta")].join("\n"));
    const keys = names.map((n) => n.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// `String.prototype.isWellFormed` is ES2024 and this package targets earlier, so the property is
// spelled out: a surrogate code unit must be half of a pair, in the right order.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("bulk truncation cuts where names are cut: by code point", () => {
  it("never emits a name that is not well-formed UTF-16", () => {
    const filler = "ab\n".repeat(Math.ceil(MAX_PARSE_CHARS / 3));
    const text = `${filler.slice(0, MAX_PARSE_CHARS - 1)}\u{1F600}tail`;
    const { names } = parseRoster(text);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).not.toMatch(LONE_SURROGATE);
  });

  it("normalises a lone surrogate that arrived in the input itself", () => {
    // parseRoster is the tolerant authority and replaces it; importGraph refuses it.
    const { names } = parseRoster("Ana\uD83D\nBen");
    for (const name of names) expect(name).not.toMatch(LONE_SURROGATE);
    expect(names).toContain("Ben");
  });
});
