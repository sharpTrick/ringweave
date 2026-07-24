import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { DEFAULT_SETTINGS, viewFromResult, type Settings } from "../src/model";
import { exportGraph, exportGraphJson } from "../src/io/exportGraph";
import { importGraph, MAX_IMPORT_N } from "../src/io/importGraph";

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

describe("import hardening (adversarial files)", () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i}` }));
  const square = { edges: [[0, 1], [1, 2], [2, 3], [3, 0]] as [number, number][] };

  it("rejects an oversized roster FAST, before any O(n^2) metric runs", () => {
    const file = { version: 1, people: people(MAX_IMPORT_N + 1).map((p) => ({ name: p.name })), edges: [] as [number, number][] };
    const start = performance.now();
    expect(() => importGraph(file)).toThrow(/limit/i);
    expect(performance.now() - start).toBeLessThan(100); // must reject, not compute
  });

  it("rejects a file with too many edges", () => {
    // one more than the edge cap, all self-loops so the shape is otherwise valid
    const edges = Array.from({ length: 200_001 }, () => [0, 0] as [number, number]);
    expect(() => importGraph({ version: 1, people: people(3), edges })).toThrow(/too many edges/i);
  });

  it("rejects a DENSE graph below both caps whose n·m product blows up all-pairs cost", () => {
    // n and m are each under their cap, but a real (distinct, in-range) dense graph would
    // cost ~seconds in all-pairs BFS. The work budget must reject it — arithmetically,
    // before building anything — so rejection is instant.
    const n = 5000;
    const edges: [number, number][] = [];
    for (let i = 0; i < n; i++) for (let d = 1; d <= 4; d++) edges.push([i, (i + d) % n]);
    const start = performance.now();
    expect(() => importGraph({ version: 1, people: people(n).map((p) => ({ name: p.name })), edges })).toThrow(/too large/i);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("accepts a large but sparse graph within budget", () => {
    // n=1000 ring: product 1000*(1000+1000)=2e6, well under budget; completes quickly.
    const n = 1000;
    const edges: [number, number][] = Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);
    const view = importGraph({ version: 1, people: people(n).map((p) => ({ name: p.name })), edges });
    expect(view.names).toHaveLength(n);
    expect(view.metrics.regular).toBe(true); // a ring is 2-regular
  });

  it("sanitizes a malformed settings.buddies so quality is never NaN or falsely 1.0", () => {
    // A 4-cycle is k=2; a hand-edited file declaring buddies:"7" (or 0) must not read as optimal.
    for (const buddies of ["7", 0, -1, 1.5, NaN] as unknown[]) {
      const v = importGraph({ version: 1, people: people(4), ...square, settings: { buddies } });
      expect(Number.isInteger(v.settings.buddies)).toBe(true);
      expect(v.settings.buddies).toBeGreaterThanOrEqual(2);
      expect(Number.isFinite(v.metrics.quality)).toBe(true);
      expect(v.metrics.quality).toBeGreaterThanOrEqual(0);
      expect(v.metrics.quality).toBeLessThanOrEqual(1);
    }
  });

  it("refuses a constraint-bearing file rather than silently dropping constraints", () => {
    expect(() =>
      importGraph({
        version: 1,
        people: people(4),
        ...square,
        constraints: { required: [[0, 1]], prohibited: [] },
      }),
    ).toThrow(/constraint/i);
  });

  it("rejects people whose id disagrees with their position", () => {
    const reordered = [{ id: 3, name: "D" }, { id: 1, name: "B" }, { id: 2, name: "C" }, { id: 0, name: "A" }];
    expect(() => importGraph({ version: 1, people: reordered, ...square })).toThrow(/position/i);
  });
});
