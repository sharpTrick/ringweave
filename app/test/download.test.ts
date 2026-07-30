import { describe, it, expect } from "vitest";
import { neutralizeCell, toCsv } from "../src/io/download";

describe("neutralizeCell (shared formula-injection guard)", () => {
  for (const c of ["=", "+", "-", "@", "\t", "\r"]) {
    it(`prefixes a value starting with ${JSON.stringify(c)} with an apostrophe`, () => {
      expect(neutralizeCell(c + "cmd")).toBe(`'${c}cmd`);
    });
  }

  it("leaves ordinary values untouched", () => {
    expect(neutralizeCell("Alice")).toBe("Alice");
    expect(neutralizeCell("O'Brien")).toBe("O'Brien");
  });
});

describe("toCsv routes every cell through neutralizeCell and still escapes RFC-4180", () => {
  it("prefixes a formula-leading cell with an apostrophe", () => {
    expect(toCsv([["=cmd"]])).toBe(`"'=cmd"`);
    expect(toCsv([["+1"]])).toBe(`"'+1"`);
    expect(toCsv([["-2"]])).toBe(`"'-2"`);
    expect(toCsv([["@SUM(A1)"]])).toBe(`"'@SUM(A1)"`);
  });

  it("leaves ordinary cells unchanged and still escapes quotes/commas", () => {
    expect(toCsv([["Alice", "Bob; Cara"]])).toBe(`"Alice","Bob; Cara"`);
    expect(toCsv([['a "quote"']])).toBe(`"a ""quote"""`);
  });
});
