import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, viewFromResult, type Settings } from "../src/model";
import { MAX_CONSTRAINT_PAIRS } from "../src/constraints";
import { generateResult } from "./helpers";
import { exportGraph, exportGraphJson } from "../src/io/exportGraph";
import { importGraph, ImportError, MAX_IMPORT_N } from "../src/io/importGraph";
import { MAX_NAME_CHARS, parseRoster } from "../src/io/parseRoster";
import { clampText } from "../src/io/clamp";
import { degreeLabel, quality, BUDDY_MIN, BUDDY_MAX, MAX_ROSTER_N, SEPARATION_MIN, SEPARATION_MAX, SEPARATION_DEFAULT, SEED_MAX } from "../src/model";

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
    const result = generateResult(roster.length, settings.buddies, { seed: settings.seed, polish: false });
    const view = viewFromResult(roster, settings, [], result);

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
    const result = generateResult(roster.length, settings.buddies, { seed: settings.seed, polish: false });
    const file = exportGraph(viewFromResult(roster, settings, [], result));
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

  // Invariant: import is capped to the SAME ceiling as generation because it re-measures
  // synchronously on the main thread — raising MAX_IMPORT_N above MAX_ROSTER_N would reintroduce
  // an O(n^2) freeze on load. Guard the equality so the two can't silently drift apart.
  it("caps import at exactly the generation ceiling (MAX_IMPORT_N === MAX_ROSTER_N)", () => {
    expect(MAX_IMPORT_N).toBe(MAX_ROSTER_N);
    // and the boundary is enforced: n = ceiling accepted, n = ceiling + 1 refused
    expect(() => importGraph({ version: 1, people: people(MAX_IMPORT_N + 1).map((p) => ({ name: p.name })), edges: [] })).toThrow(/limit/i);
  });

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

  it("refuses a star graph outright rather than clamping its settings", () => {
    // This used to be ACCEPTED with its derived `buddies` clamped to BUDDY_MAX, which
    // treated a per-vertex degree of 199 as a settings problem. It is a payload problem:
    // the density gate compares only the AVERAGE (2m <= BUDDY_MAX*n), which a star passes
    // trivially, and the hub then becomes the buddy label of every leaf — 480 MB of DOM
    // text from a 512 KB file. `neighborhood.ts` already asserted in prose that degree is
    // capped at BUDDY_MAX; on this path that was false.
    const n = 200;
    expect(() => importGraph({ version: 1, people: peopleOf(n), edges: star(n) })).toThrow(
      /more than the 12 a buddy graph allows/,
    );
    // Still accepted at the boundary, so the gate refuses hubs and not buddy graphs.
    const legal = importGraph({
      version: 1,
      people: peopleOf(n),
      edges: Array.from({ length: BUDDY_MAX }, (_, i) => [0, i + 1] as [number, number]),
    });
    expect(legal.settings.buddies).toBe(BUDDY_MAX);
    expect(legal.settings.buddies).toBeGreaterThanOrEqual(BUDDY_MIN);
  });

  it("bounds the text every buddy-label sink has to materialize", () => {
    // The invariant behind both import gates, stated as the product the old gates left
    // unbounded: (one name's length) x (how many people it labels).
    const n = 300;
    const hugeName = "x".repeat(500);
    expect(() =>
      importGraph({
        version: 1,
        people: [{ id: 0, name: hugeName }, ...peopleOf(n).slice(1)],
        edges: [[0, 1]],
      }),
    ).toThrow(/A name is too long/);
    // And an unbounded value can no longer become an unbounded message.
    expect(() => importGraph({ version: 1, people: peopleOf(3), edges: [] })).not.toThrow();
    try {
      importGraph({ version: "A".repeat(100_000) });
      throw new Error("expected a refusal");
    } catch (err) {
      expect((err as Error).message.length).toBeLessThan(200);
    }
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

  // Class: an INVALID (non-integer) minSeparation must fall back to the one canonical default
  // both Settings producers agree on (SEPARATION_DEFAULT), not to SEPARATION_MIN — otherwise a
  // later reroll of the import would generate with a different separation than the panel shows.
  it("an invalid minSeparation falls back to SEPARATION_DEFAULT (single source with the panel)", () => {
    for (const decl of [2.5, Number.NaN, "5" as unknown as number]) {
      const v = importGraph({ version: 1, people: peopleOf(6), edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]], settings: { buddies: 2, minSeparation: decl, seed: 1, polish: "auto" } });
      expect(v.settings.minSeparation).toBe(SEPARATION_DEFAULT);
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
      // Assert the TYPE, not merely "something threw": a bare .toThrow() also passes when the
      // test itself throws a TypeError, which would hide the case it means to cover.
      expect(() => importGraph({ version: 1, people, edges: cycle(nm) })).toThrow(ImportError);
    }
  });

  // Class: a name with an embedded control char (tab/CR/…) is a spreadsheet-injection vector —
  // it isn't a comma/newline here, so it would survive into the buddy list/CSV/clipboard and
  // split a pasted line into a live-formula cell/row. Import refuses it at the authority.
  it("refuses a name containing a tab, CR, or other control character", () => {
    const hostile = [
      "foo\t=cmd(1)",             // tab -> a tab-delimited paste splits off `=cmd(1)...`
      "foo\r=cmd(1)",             // CR  -> starts a new row with a formula
      "foo" + String.fromCharCode(0) + "bar", // NUL
    ];
    for (const bad of hostile) {
      const nm = [bad, "Bob", "Cara"];
      const people = nm.map((name, id) => ({ id, name }));
      expect(() => importGraph({ version: 1, people, edges: cycle(nm) })).toThrow(/control character/i);
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

  // Class: the app has two authorities on how long a name may be, and they must count in the
  // same unit. `parseRoster` truncates by CODE POINT (it says so, and it fixed a lone-surrogate
  // bug to get there); `importGraph` refused by UTF-16 length. So a roster of emoji-bearing
  // names passed the parser untouched, exported, and was refused on re-import by the same app
  // that wrote the file — with the docblock claiming it "round-trips identically".
  it("never refuses a file whose people are exactly what parseRoster emitted", () => {
    // Swept across the boundary rather than asserted at one length: the two units differ by a
    // factor of two for astral characters, so a single case can sit on either side by luck.
    for (let points = MAX_NAME_CHARS - 3; points <= MAX_NAME_CHARS + 3; points++) {
      const parsed = parseRoster(["\u{1F600}".repeat(points), "Ana", "Ben", "Chen"].join("\n"));
      const people = parsed.names.map((name, id) => ({ id, name }));
      expect(() => importGraph({ version: 1, people, edges: [[0, 1], [1, 2], [2, 3], [3, 0]] }))
        .not.toThrow();
      // ...and the gate is live, not vacuous: one code point past the limit is still refused.
      const over = "\u{1F600}".repeat(MAX_NAME_CHARS + 1);
      expect(() =>
        importGraph({ version: 1, people: [{ id: 0, name: over }, ...peopleOf(3).slice(1)], edges: [] }),
      ).toThrow(/A name is too long/);
    }
  });

  it("clamps display text without splitting a surrogate pair", () => {
    // The same unit confusion at the other end of the pipe. `clampText` owns all four truncation
    // sinks, and `slice` cut between the halves of a pair — emitting a lone surrogate, which is
    // ill-formed but is not in Cc/Cf/Zl/Zp, so every downstream gate accepts it and it reaches
    // the DOM, the CSV and the clipboard as U+FFFD. Reachable by typing 31 emoji into the search
    // box, whose no-match echo is a live region.
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (let max = 1; max <= 12; max++) {
      for (const text of ["\u{1F600}".repeat(20), `Ana\u{1F600}${"\u{1F1EF}\u{1F1F5}".repeat(8)}`]) {
        const out = clampText(text, max);
        expect(out).not.toMatch(lone);
        // ...and it still truncates: the fix must not have turned the clamp into a pass-through.
        expect(Array.from(out).length).toBeLessThanOrEqual(max + 1); // + the ellipsis
      }
    }
    expect(clampText("short", 10)).toBe("short");
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
    const r = generateResult(20, 4, { seed: 1, polish: false });
    const view = viewFromResult(names(20), DEFAULT_SETTINGS, [], r);
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

  it("round-trips buddy rules instead of dropping them", () => {
    const view = importGraph({
      version: 1,
      people: peopleOf(4),
      edges: square,
      constraints: { required: [[0, 1]], prohibited: [[0, 2]] },
    });
    expect(view.constraints).toEqual([
      { a: 0, b: 1, kind: "required" },
      { a: 0, b: 2, kind: "prohibited" },
    ]);
    // Import rehydrates edges rather than regenerating, so nothing measured the rules.
    // Null must read as "not measured", never as "all satisfied".
    expect(view.report).toBeNull();
    expect(exportGraph(view).constraints).toEqual({ required: [[0, 1]], prohibited: [[0, 2]] });
  });

  it("refuses malformed buddy rules rather than skipping them", () => {
    const withRules = (constraints: unknown) => () =>
      importGraph({ version: 1, people: peopleOf(4), edges: square, constraints });

    expect(withRules({ required: [[0, 9]], prohibited: [] })).toThrow(/outside 0\.\.3/);
    expect(withRules({ required: [[0, 0]], prohibited: [] })).toThrow(/themselves/i);
    expect(withRules({ required: [[0, 1], [1, 0]], prohibited: [] })).toThrow(/twice/i);
    expect(withRules({ required: [[0, 1]], prohibited: [[1, 0]] })).toThrow(/both/i);
    expect(withRules({ required: [[0]], prohibited: [] })).toThrow(/\[a, b\] pair/);
    expect(withRules({ required: "nope", prohibited: [] })).toThrow(/aren't a list/);
    expect(withRules({ required: [[0.5, 1]], prohibited: [] })).toThrow(/outside 0\.\.3/);
  });

  it("caps the number of buddy rules before doing any per-pair work", () => {
    const many = Array.from({ length: MAX_CONSTRAINT_PAIRS + 1 }, () => [0, 1]);
    expect(() =>
      importGraph({
        version: 1,
        people: peopleOf(4),
        edges: square,
        constraints: { required: many, prohibited: [] },
      }),
    ).toThrow(/the limit is 200/);
  });

  it("rejects people whose id disagrees with their position", () => {
    const reordered = [{ id: 3, name: "D" }, { id: 1, name: "B" }, { id: 2, name: "C" }, { id: 0, name: "A" }];
    expect(() => importGraph({ version: 1, people: reordered, edges: square })).toThrow(/position/i);
  });
});
