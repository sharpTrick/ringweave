import { describe, it, expect } from "vitest";
import { toCsv } from "../src/io/download";

describe("toCsv formula-injection neutralization", () => {
  it("prefixes a cell starting with =,+,-,@ with an apostrophe", () => {
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
