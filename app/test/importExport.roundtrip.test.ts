import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { DEFAULT_SETTINGS, viewFromResult, type Settings } from "../src/model";
import { exportGraph, exportGraphJson } from "../src/io/exportGraph";
import { importGraph } from "../src/io/importGraph";

function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Person ${i}`);
}

describe("export -> import round-trip (F6)", () => {
  it("reproduces identical graph and metrics", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, buddies: 4 };
    const roster = names(30);
    const result = buildBuddyGraph(roster.length, settings.buddies, { seed: settings.seed });
    const view = viewFromResult(roster, settings, result);

    // Serialize through JSON (the real boundary) and back.
    const roundTripped = importGraph(JSON.parse(exportGraphJson(view)));

    expect(roundTripped.names).toEqual(view.names);
    expect(roundTripped.edges).toEqual(view.edges);
    expect(roundTripped.buddies).toEqual(view.buddies);
    expect(roundTripped.metrics).toEqual(view.metrics);
  });

  it("exports canonical (u<v), sorted edges", () => {
    const settings = { ...DEFAULT_SETTINGS };
    const roster = names(20);
    const result = buildBuddyGraph(roster.length, settings.buddies, { seed: settings.seed });
    const file = exportGraph(viewFromResult(roster, settings, result));
    for (const [a, b] of file.edges) expect(a).toBeLessThan(b);
    const flat = file.edges.map(([a, b]) => a * 1000 + b);
    expect(flat).toEqual([...flat].sort((x, y) => x - y));
  });

  it("rejects a malformed file with a plain-language error", () => {
    expect(() => importGraph({ version: 2 })).toThrow(/version/i);
    expect(() => importGraph({ version: 1, people: [] })).toThrow(/no people/i);
    expect(() =>
      importGraph({ version: 1, people: [{ id: 0, name: "A" }], edges: [[0, 5]] }),
    ).toThrow(/outside/i);
  });
});
