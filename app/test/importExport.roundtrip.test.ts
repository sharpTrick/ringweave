import { describe, it, expect } from "vitest";
import { buildBuddyGraph } from "ringweave";
import { DEFAULT_SETTINGS, viewFromResult, type Settings } from "../src/model";
import { exportGraph, exportGraphJson } from "../src/io/exportGraph";
import { importGraph, MAX_IMPORT_N } from "../src/io/importGraph";
import { parseRoster } from "../src/io/parseRoster";
import { degreeLabel, quality, BUDDY_MIN, BUDDY_MAX, SEPARATION_MIN, SEPARATION_MAX, SEED_MAX } from "../src/model";

function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Person ${i}`);
}

function peopleOf(n: number): { id: number; name: string }[] {
  return names(n).map((name, id) => ({ id, name }));
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

  it("rejects a DENSE graph (avg degree beyond a buddy graph) before layout/render", () => {
    // A near-complete graph passes the node cap but would freeze force layout + SVG render
    // (one <line> per edge). The density cap rejects it arithmetically, before building.
    const n = 430;
    const edges: [number, number][] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push([i, j]); // K430, ~92k edges
    const start = performance.now();
    expect(() => importGraph({ version: 1, people: people(n).map((p) => ({ name: p.name })), edges })).toThrow(/denser|too many edges/i);
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

  // Class: an imported graph whose real degree differs from a declared settings.buddies
  // must be scored and labeled from the ACTUAL graph, never from the declared target.
  it("scores quality and labels degree from the actual graph, not settings.buddies", () => {
    const cycle6: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]];
    const v = importGraph({ version: 1, people: people(6), edges: cycle6, settings: { buddies: 4, seed: 1, polish: "auto" } });
    expect(v.metrics.degreeMax).toBe(2); // a 6-cycle is 2-regular
    expect(v.settings.buddies).toBe(4); // the declared target is preserved for reroll
    expect(degreeLabel(v.metrics)).toBe("2"); // but the shown count is the real degree
    expect(v.metrics.quality).toBeCloseTo(quality(v.metrics.aspl!, 6, 2), 12); // scored at k=2, not 4
  });

  it("imports provably-optimal graphs at 100% regardless of declared buddies", () => {
    const c4 = importGraph({ version: 1, people: people(4), edges: [[0, 1], [1, 2], [2, 3], [3, 0]] });
    expect(c4.metrics.degreeMax).toBe(2);
    expect(c4.metrics.quality).toBeCloseTo(1, 12); // 2-regular C4 is Moore-optimal
    const k4 = importGraph({ version: 1, people: people(4), edges: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] });
    expect(k4.metrics.degreeMax).toBe(3);
    expect(k4.metrics.quality).toBeCloseTo(1, 12); // K4 has aspl 1 = its Moore bound
  });
});

// Class: a disconnected or degenerate imported graph must never read as optimal or
// "everyone's well-linked". aspl/diameter are undefined over unreachable pairs (null),
// quality is 0, and connectivity is surfaced honestly.
describe("import: disconnected / degenerate graphs are scored honestly", () => {
  const disconnected: Array<{ why: string; n: number; edges: [number, number][]; lcf: number }> = [
    { why: "two disjoint triangles (regular)", n: 6, edges: [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3]], lcf: 0.5 },
    { why: "two disjoint K4s (regular)", n: 8, edges: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3], [4, 5], [4, 6], [4, 7], [5, 6], [5, 7], [6, 7]], lcf: 0.5 },
    { why: "triangle + isolated vertex (irregular, degMin 0)", n: 4, edges: [[0, 1], [1, 2], [2, 0]], lcf: 0.75 },
    { why: "a perfect matching (n=6, three pairs)", n: 6, edges: [[0, 1], [2, 3], [4, 5]], lcf: 2 / 6 },
  ];

  for (const c of disconnected) {
    it(c.why + " -> connected:false, quality:0, aspl:null", () => {
      const v = importGraph({ version: 1, people: peopleOf(c.n), edges: c.edges });
      expect(v.metrics.connected).toBe(false);
      expect(v.metrics.quality).toBe(0);
      expect(v.metrics.aspl).toBeNull();
      expect(v.metrics.diameter).toBeNull();
      expect(v.metrics.largestComponentFraction).toBeCloseTo(c.lcf, 10);
    });
  }

  it("an edgeless roster is not scored as optimal", () => {
    for (const n of [4, 50]) {
      const v = importGraph({ version: 1, people: peopleOf(n), edges: [] });
      expect(v.metrics.connected).toBe(false);
      expect(v.metrics.quality).toBe(0);
      expect(v.metrics.aspl).toBeNull();
    }
  });

  it("invariant: quality > 0 implies a finite, connected ASPL", () => {
    const cases: [number, [number, number][]][] = [
      [4, []],
      [6, [[0, 1], [2, 3]]],
      [6, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3]]],
      [4, [[0, 1], [1, 2], [2, 3], [3, 0]]], // connected -> quality 1
    ];
    for (const [n, edges] of cases) {
      const m = importGraph({ version: 1, people: peopleOf(n), edges }).metrics;
      if (m.quality > 0) {
        expect(m.connected).toBe(true);
        expect(m.aspl).not.toBeNull();
      }
    }
  });
});

// Class: untrusted file fields must not flow unclamped into generation cost — a crafted
// high-degree import must not let a later reroll inject k up to n-1 and hang the worker.
describe("import: untrusted settings are clamped to the UI range", () => {
  const star = (n: number): [number, number][] => Array.from({ length: n - 1 }, (_, i) => [0, i + 1]);

  it("a star graph's degree-(n-1) fallback is clamped to BUDDY_MAX", () => {
    const n = 200;
    const v = importGraph({ version: 1, people: peopleOf(n), edges: star(n) }); // no settings block
    expect(v.settings.buddies).toBe(BUDDY_MAX); // clamped from degree 199
    expect(v.settings.buddies).toBeGreaterThanOrEqual(BUDDY_MIN);
  });

  it("a declared oversized buddies is clamped to BUDDY_MAX", () => {
    for (const declared of [13, 100, 199, 1_000_000]) {
      const v = importGraph({ version: 1, people: peopleOf(50), edges: [[0, 1], [1, 2], [2, 0]], settings: { buddies: declared, seed: 1, polish: "auto" } });
      expect(v.settings.buddies).toBe(BUDDY_MAX);
    }
  });

  it("an out-of-range minSeparation is clamped to its OWN range (SEPARATION_*, not BUDDY_*)", () => {
    for (const [decl, exp] of [[999999999, SEPARATION_MAX], [1, SEPARATION_MIN], [7, 7]] as const) {
      const v = importGraph({ version: 1, people: peopleOf(6), edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]], settings: { buddies: 2, minSeparation: decl, seed: 1, polish: "auto" } });
      expect(v.settings.minSeparation).toBe(exp);
    }
  });
});

describe("import: lossless round-trip and defaults", () => {
  const cycle = (nm: string[]): [number, number][] => nm.map((_, i) => [i, (i + 1) % nm.length]);

  // Class: import must only ACCEPT names that survive the comma/newline roster editor, so an
  // Edit→regenerate can't drop/split/merge people. Anything that wouldn't round-trip is refused.
  it("refuses names that wouldn't survive the roster editor", () => {
    const badRosters: string[][] = [
      ["Alice", "   ", "Bob"],       // whitespace-only -> dropped
      ["Alice", "", "Bob"],          // empty -> dropped
      ["Alice", "alice"],            // case-insensitive duplicate -> merged
      ["Alice", "Alice"],            // exact duplicate -> merged
      [" Alice ", "Bob"],            // leading/trailing space -> trimmed (not stable)
      ["Doe, Jane", "Bob", "Cara"],  // comma -> split
      ["line\nbreak", "Bob", "Cara"], // newline -> split
    ];
    for (const nm of badRosters) {
      const people = nm.map((name, id) => ({ id, name }));
      expect(() => importGraph({ version: 1, people, edges: cycle(nm) })).toThrow();
    }
  });

  it("accepted names round-trip through the roster editor unchanged", () => {
    const roster = ["Alice Nguyen", "Bob Carter", "Chloe Diaz"];
    const view = importGraph({ version: 1, people: roster.map((name, id) => ({ id, name })), edges: cycle(roster) });
    expect(parseRoster(view.names.join("\n")).names).toEqual(view.names);
  });

  // Class: an otherwise-valid but collectively over-long roster gets a SIZE reason, not the
  // misleading commas/uniqueness message — the length check runs before the round-trip check.
  it("refuses an over-long roster with a size reason, not a commas/uniqueness one", () => {
    const long = Array.from({ length: 900 }, (_, i) => "x".repeat(600) + i);
    const people = long.map((name, id) => ({ id, name }));
    const edges = long.map((_, i) => [i, (i + 1) % long.length] as [number, number]);
    expect(() => importGraph({ version: 1, people, edges })).toThrow(/too long/i);
  });

  it("a file with no settings.seed falls back to the shared DEFAULT_SEED", () => {
    const v = importGraph({ version: 1, people: peopleOf(4), edges: [[0, 1], [1, 2], [2, 3], [3, 0]] });
    expect(v.settings.seed).toBe(DEFAULT_SETTINGS.seed);
  });

  it("clamps an out-of-safe-range seed so seed+1 always advances", () => {
    const v = importGraph({ version: 1, people: peopleOf(4), edges: [[0, 1], [1, 2], [2, 3], [3, 0]], settings: { buddies: 2, seed: 2 ** 53, polish: "auto" } });
    expect(v.settings.seed).toBeLessThanOrEqual(SEED_MAX);
    expect(v.settings.seed).toBeGreaterThanOrEqual(0);
    expect(v.settings.seed + 1).toBeGreaterThan(v.settings.seed); // advances at float precision
  });
});

describe("file schema stays in sync with Metrics", () => {
  it("meta.metrics has exactly the keys of a produced Metrics object", () => {
    const r = buildBuddyGraph(20, 4, { seed: 1 });
    const view = viewFromResult(names(20), DEFAULT_SETTINGS, r);
    const file = exportGraph(view);
    expect(Object.keys(file.meta.metrics).sort()).toEqual(Object.keys(view.metrics).sort());
  });
});

describe("import: validation & sanitization", () => {
  const square: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]];

  it("sanitizes a malformed settings.buddies so quality is never NaN or falsely 1.0", () => {
    // A 4-cycle is k=2; a hand-edited file declaring buddies:"7" (or 0) must not read as optimal.
    for (const buddies of ["7", 0, -1, 1.5, NaN] as unknown[]) {
      const v = importGraph({ version: 1, people: peopleOf(4), edges: square, settings: { buddies } });
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
        people: peopleOf(4),
        edges: square,
        constraints: { required: [[0, 1]], prohibited: [] },
      }),
    ).toThrow(/constraint/i);
  });

  it("rejects people whose id disagrees with their position", () => {
    const reordered = [{ id: 3, name: "D" }, { id: 1, name: "B" }, { id: 2, name: "C" }, { id: 0, name: "A" }];
    expect(() => importGraph({ version: 1, people: reordered, edges: square })).toThrow(/position/i);
  });
});
