import { Graph, allPairsSummary, girth, largestComponentFraction } from "ringweave";
import {
  assembleMetrics, degreeExtent,
  BUDDY_MAX, BUDDY_MIN, DEFAULT_SEED, MAX_ROSTER_N, SEED_MAX, SEPARATION_DEFAULT, SEPARATION_MAX, SEPARATION_MIN,
  type GraphView, type Settings,
} from "../model";
import { MAX_NAME_CHARS, MAX_PARSE_CHARS, NAME_HOSTILE_CHARS, parseRoster } from "./parseRoster";
import {
  MAX_CONSTRAINT_PAIRS, joinPairs, pairKey,
  type ConstraintPair,
} from "../constraints";
import type { BuddyGraphFile } from "./schema";

/** Thrown with a plain-language reason when a file can't be imported. */
export class ImportError extends Error {}

/** C0 control chars + DEL — illegal inside a name (non-global so .test() is stateless). */
// The shared class, from parseRoster — see NAME_HOSTILE_CHARS for why it is defined once.
// A fresh RegExp because the shared one carries the `g` flag, and `test` on a global regex
// advances lastIndex between calls, so every other name in a roster would be skipped.
const CONTROL_CHARS_TEST = new RegExp(NAME_HOSTILE_CHARS.source, "u");

/**
 * Import bounds. The core's pure metric functions (`allPairsSummary`/`girth`) are UNCAPPED
 * and re-measure the file on the main thread, and the graph view also LAYS OUT and RENDERS
 * every edge synchronously. So both node count AND density must be bounded:
 * - `MAX_IMPORT_N` caps the O(n^2) metric baseline.
 * - the density cap (avg degree <= BUDDY_MAX) keeps edge-scaling work in check — the force
 *   layout is O(m)/tick and the SVG renders one <line> per edge, so a near-complete graph
 *   (K430 ≈ 92k edges) would freeze layout+render even though its BFS cost is modest.
 * A buddy graph has at most BUDDY_MAX buddies each, so `2·m <= BUDDY_MAX·n` is the natural
 * ceiling; anything denser isn't a buddy graph and is refused with a plain-language error.
 * A rejected file costs an arithmetic check (the oversized *file* is stopped earlier by the
 * byte-size gate in readFileText, before it is parsed).
 *
 * The node cap equals the generation ceiling (a re-rollable import shouldn't display more
 * than the app can generate), which also holds the worst-case synchronous re-measure
 * (`allPairsSummary`+`girth`) to a few hundred ms rather than over a second.
 */
export const MAX_IMPORT_N = MAX_ROSTER_N;

function sanitizeInt(value: unknown, lo: number, hi: number, fallback: number): number {
  return Number.isInteger(value) ? Math.max(lo, Math.min(hi, value as number)) : fallback;
}

/** Sanitize the settings block: values come from arbitrary JSON. `buddies` and
    `minSeparation` are STORED on the view and handed to the core by any later reroll — the
    import itself rehydrates edges and never generates, so they are not used now, which is
    exactly why they have to be bounded now. Both are
    CLAMPED to the UI range [BUDDY_MIN, BUDDY_MAX] — an untrusted file must not inject a value
    the stepper can't express (a star import's near-n degree fallback — up to MAX_IMPORT_N-1,
    e.g. 999 — or a declared minSeparation of 1e9) and drive generation out of range. */
function sanitizeSettings(s: BuddyGraphFile["settings"] | undefined, fallbackBuddies: number): Settings {
  const declared = s && Number.isInteger(s.buddies) && s.buddies >= BUDDY_MIN ? s.buddies : fallbackBuddies;
  return {
    buddies: Math.max(BUDDY_MIN, Math.min(BUDDY_MAX, declared)),
    minSeparation: s && s.minSeparation !== undefined ? sanitizeInt(s.minSeparation, SEPARATION_MIN, SEPARATION_MAX, SEPARATION_DEFAULT) : undefined,
    seed: sanitizeInt(s?.seed, 0, SEED_MAX, DEFAULT_SEED),
    polish: s && (s.polish === true || s.polish === false || s.polish === "auto") ? s.polish : "auto",
  };
}

/**
 * Validate and rehydrate the constraint block.
 *
 * Refuses rather than skipping bad pairs. Every other malformed input in this file
 * throws, and switching constraints alone to lenient accept-with-skips would be
 * inconsistent inside one function — worse, it would silently change the rules a
 * user gets back from the rules they saved, which is the same silent-partial
 * failure the constraints feature exists to avoid.
 *
 * A pair that is both required and prohibited is refused here too. It is a
 * semantic contradiction the core would refuse at generation time anyway, and an
 * imported graph that renders fine but can never be regenerated is a worse place
 * to discover it. The app cannot produce such a file: a view only ever carries the
 * rules a successful generation ran under.
 */
function readConstraints(
  block: BuddyGraphFile["constraints"] | undefined,
  n: number,
): ConstraintPair[] {
  if (block === undefined) return [];
  if (typeof block !== "object" || block === null) {
    throw new ImportError("That file's buddy rules aren't in the expected shape.");
  }
  const read = (value: unknown, label: string): [number, number][] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw new ImportError(`That file's ${label} buddy rules aren't a list.`);
    }
    return value.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new ImportError(`A ${label} buddy rule isn't a [a, b] pair.`);
      }
      const [a, b] = pair as [unknown, unknown];
      if (!Number.isInteger(a) || !Number.isInteger(b) ||
          (a as number) < 0 || (b as number) < 0 ||
          (a as number) >= n || (b as number) >= n) {
        throw new ImportError(`A ${label} buddy rule refers to someone outside 0..${n - 1}.`);
      }
      if (a === b) {
        throw new ImportError("A buddy rule pairs someone with themselves.");
      }
      return [a as number, b as number];
    });
  };

  const pairs = joinPairs(read(block.required, "must-be"), read(block.prohibited, "never-be"));

  const seen = new Set<string>();
  for (const p of pairs) {
    if (seen.has(pairKey(p))) throw new ImportError("That file lists the same buddy rule twice.");
    seen.add(pairKey(p));
  }
  // Same two people under both kinds: the keys differ (kind is part of the key), so
  // this needs its own pass over the un-kinded pair.
  const unkinded = new Set<string>();
  for (const p of pairs) {
    const key = p.a <= p.b ? `${p.a},${p.b}` : `${p.b},${p.a}`;
    if (unkinded.has(key)) {
      throw new ImportError("That file sets the same pair to both be and never be buddies.");
    }
    unkinded.add(key);
  }
  return pairs;
}

/**
 * Rehydrate a GraphView from a file WITHOUT regenerating — the edges are in the file.
 * A `Graph` is rebuilt and metrics are recomputed with the core's own functions
 * (`allPairsSummary`/`girth`/`largestComponentFraction`), so imported (incl. hand-edited)
 * files are honestly re-measured — quality reflects the ACTUAL degree and connectivity, not
 * the declared `settings`. Round-trips identically with `exportGraph`. Dimensions and density
 * are bounded up front so an oversized/dense file fails fast instead of freezing the tab.
 */
/**
 * Every interpolation of untrusted file content goes through this.
 *
 * `ImportError.message` is rendered straight into the DOM as the sole child of the
 * toast, so an unbounded interpolation turns the whole 8 MB file budget into one text
 * node: `{"version":"AAAA…"}` with a 7.9-million-character version string produced a
 * 7.9-million-character toast. Bounding it at the SINK (useNotice) as well is belt and
 * braces; bounding it here is what keeps the message readable.
 */
function quote(value: unknown, max = 80): string {
  // Bounds the INPUT, not the output. Serializing first and slicing after still pays a
  // full JSON.stringify of the untrusted value to produce 80 characters — and on a deeply
  // nested value it throws a RangeError that escapes importGraph as something other than
  // an ImportError, so the caller's "Couldn't import that file" path never runs.
  if (typeof value === "string") {
    return JSON.stringify(value.length > max ? `${value.slice(0, max)}…` : value);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `a list of ${value.length} items`;
  return typeof value === "object" ? "an object" : typeof value;
}

export function importGraph(data: unknown): GraphView {
  if (typeof data !== "object" || data === null) {
    throw new ImportError("That file isn't a BuddyGraph JSON object.");
  }
  const f = data as Partial<BuddyGraphFile>;
  if (f.version !== 1) {
    throw new ImportError(`Unsupported file version: ${quote(f.version)} (expected 1).`);
  }
  if (!Array.isArray(f.people) || f.people.length === 0) {
    throw new ImportError("That file has no people.");
  }
  if (f.people.length > MAX_IMPORT_N) {
    throw new ImportError(`That file has ${f.people.length} people — the limit is ${MAX_IMPORT_N}.`);
  }
  if (!Array.isArray(f.edges)) {
    throw new ImportError("That file has no edges list.");
  }
  // Density: a buddy graph has avg degree <= BUDDY_MAX, i.e. 2·m <= BUDDY_MAX·n. Anything
  // denser would freeze layout/render, so it's refused (not a buddy graph).
  if (2 * f.edges.length > BUDDY_MAX * f.people.length) {
    throw new ImportError(`That file has too many edges for ${f.people.length} people — it's denser than a buddy graph.`);
  }
  // Bound the pair count BEFORE any per-pair work, and before `validate`'s O(n²)
  // prohibited-pair connectivity walk could ever be reached on a later generate.
  const declaredPairs =
    (f.constraints?.required?.length ?? 0) + (f.constraints?.prohibited?.length ?? 0);
  if (declaredPairs > MAX_CONSTRAINT_PAIRS) {
    throw new ImportError(`That file has ${declaredPairs} buddy rules — the limit is ${MAX_CONSTRAINT_PAIRS}.`);
  }

  const n = f.people.length;
  const names: string[] = f.people.map((p, i) => {
    if (!p || typeof p.name !== "string") {
      throw new ImportError(`Person at position ${i} is missing a name.`);
    }
    // Per-NAME length, checked before any message can interpolate the name and before the
    // collective-length check below. The existing gates bound only totals, so one name could
    // be half a megabyte: it then becomes the buddy label of everyone adjacent to it, and
    // BuddyList, Slips and the CSV export each materialize that. A 512 KB file reached 480 MB
    // of DOM text and ~1 GB RSS. Refused rather than truncated because import refuses
    // everything else it cannot round-trip; parseRoster, the tolerant authority, truncates.
    if (p.name.length > MAX_NAME_CHARS) {
      throw new ImportError(
        `A name is too long (${p.name.length} characters, the limit is ${MAX_NAME_CHARS}).`,
      );
    }
    // Edges reference people by position; a present-but-mismatched id would mislabel them.
    if (p.id !== undefined && p.id !== i) {
      throw new ImportError(`Person ${quote(p.name)} has id ${quote(p.id)} but is at position ${i}.`);
    }
    return p.name;
  });

  // A name with an embedded control character (tab/CR/…) is a spreadsheet formula-injection
  // vector: it isn't a comma/newline delimiter here, so it survives into the buddy list/CSV/
  // clipboard and then splits a pasted line into a cell/row whose next field can be a live
  // formula. Refuse it outright at the import authority (the roster editor normalizes such
  // chars to spaces, so this also enforces round-trip stability). Checked before the length/
  // round-trip checks so the reason names the real cause.
  if (names.some((x) => CONTROL_CHARS_TEST.test(x))) {
    throw new ImportError("A name contains a tab, line break, or other control character — remove it and try again.");
  }

  // Names must survive the roster editor unchanged: `parseRoster` (comma/newline delimited)
  // trims, drops blanks, and de-dupes case-insensitively, so an empty/whitespace-only/
  // comma/newline/duplicate name would silently vanish or split on an Edit→regenerate,
  // shifting every downstream buddy label. Make the parser the authority — refuse anything
  // it wouldn't round-trip. Check total length FIRST so an over-long (but otherwise valid)
  // roster gets a size reason, not a misleading commas/uniqueness one.
  const joined = names.join("\n");
  if (joined.length > MAX_PARSE_CHARS) {
    throw new ImportError("Those names are collectively too long to import.");
  }
  const roundTrip = parseRoster(joined).names;
  if (roundTrip.length !== n || roundTrip.some((x, i) => x !== names[i])) {
    throw new ImportError("Every name must be non-empty, unique (case-insensitively), and free of commas or line breaks.");
  }

  const g = new Graph(n);
  for (const e of f.edges) {
    if (!Array.isArray(e) || e.length !== 2) {
      throw new ImportError("An edge isn't a [a, b] pair.");
    }
    const [a, b] = e;
    if (
      !Number.isInteger(a) || !Number.isInteger(b) ||
      a < 0 || b < 0 || a >= n || b >= n
    ) {
      throw new ImportError(`Edge [${a}, ${b}] refers to someone outside 0..${n - 1}.`);
    }
    g.addEdge(a, b); // ignores self-loops and de-dupes symmetric entries
  }

  // Per-VERTEX degree, not just average density. The density gate above compares
  // 2m <= BUDDY_MAX*n — an AVERAGE — so a star graph with one hub of degree n-1 passes it
  // trivially (at n=1000 that is 2*999 <= 12*1000). `neighborhood.ts` states outright that
  // "degree is capped at BUDDY_MAX = 12", which was false on this path, and the hub's name
  // becomes every leaf's buddy label. Checked before the O(n^2) allPairsSummary below.
  const [degreeMin, degreeMax] = degreeExtent(g.degrees());
  if (degreeMax > BUDDY_MAX) {
    throw new ImportError(
      `Someone in that file has ${degreeMax} buddies — more than the ${BUDDY_MAX} a buddy graph allows.`,
    );
  }

  const constraints = readConstraints(f.constraints, n);

  const summary = allPairsSummary(g);
  const buddies = g.adj.map((s) => Array.from(s).sort((x, y) => x - y));
  const settings = sanitizeSettings(f.settings, degreeMax);

  return {
    names,
    edges: g.edgeList(),
    buddies,
    settings,
    constraints,
    // Import rehydrates edges rather than regenerating, so no builder ran and there is
    // no constraint report to show. Null means "not measured" and the panel says so —
    // it must never be read as "all rules satisfied".
    report: null,
    metrics: assembleMetrics(n, {
      aspl: summary.aspl,
      diameter: summary.diameter,
      girth: girth(g),
      degreeMin,
      degreeMax,
      connected: summary.connected,
      largestComponentFraction: largestComponentFraction(g),
    }),
  };
}
