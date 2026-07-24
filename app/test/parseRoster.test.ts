import { describe, it, expect } from "vitest";
import { parseRoster, MAX_NAMES } from "../src/io/parseRoster";

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

  it("no warnings when there are no duplicates", () => {
    const { names, warnings } = parseRoster("A\nB\nC");
    expect(names).toEqual(["A", "B", "C"]);
    expect(warnings).toEqual([]);
  });

  it("30 pasted names -> 30 names (F1 acceptance)", () => {
    const raw = Array.from({ length: 30 }, (_, i) => `Person ${i}`).join("\n");
    expect(parseRoster(raw).names).toHaveLength(30);
  });

  it("caps the number of names and warns (no unbounded parse)", () => {
    const raw = Array.from({ length: MAX_NAMES + 500 }, (_, i) => `P${i}`).join("\n");
    const { names, warnings } = parseRoster(raw);
    expect(names).toHaveLength(MAX_NAMES);
    expect(warnings.join(" ")).toMatch(/maximum/i);
  });

  it("truncates a pathologically long paste fast, with a warning", () => {
    const raw = "name,".repeat(1_100_000); // ~5.5M chars, well over MAX_PARSE_CHARS
    const start = performance.now();
    const { warnings } = parseRoster(raw);
    expect(performance.now() - start).toBeLessThan(500);
    expect(warnings.join(" ")).toMatch(/characters/i);
  });
});
