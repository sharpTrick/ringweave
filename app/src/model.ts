import { asplGap, DEFAULT_MIN_SEPARATION, type BuddyResult } from "ringweave";

/** Generation settings surfaced in the UI (mirrors the core's BuddyOptions + k). */
export interface Settings {
  buddies: number; // k — the generation target (used by generate/reroll)
  minSeparation?: number;
  polish: boolean | "auto";
  seed: number;
}

/** Default polish RNG seed — matches the core's default; the single source so the app's
    generate default and the import fallback can't drift apart. */
export const DEFAULT_SEED = 12345;

export const DEFAULT_SETTINGS: Settings = {
  buddies: 4,
  polish: "auto",
  seed: DEFAULT_SEED,
};

/** Buddies-per-person range the UI supports — the single source of truth for the
    settings stepper AND the import clamp, so they can't diverge. */
export const BUDDY_MIN = 2;
export const BUDDY_MAX = 12;

/** Minimum-separation range the UI supports. A DISTINCT concept from buddy count (it
    happens to share bounds today), kept separate so the two knobs evolve independently. */
export const SEPARATION_MIN = 2;
export const SEPARATION_MAX = 12;

/** The default minimum separation, surfaced when the field is unset and used as the fallback
    for an invalid imported value — mirrors the core's `DEFAULT_MIN_SEPARATION` so both Settings
    producers (the settings panel and import) agree on one default instead of drifting (the
    panel showing 5 while an invalid import silently fell back to SEPARATION_MIN). It is an
    IN-RANGE fallback, so it's clamped to [SEPARATION_MIN, SEPARATION_MAX]: if the core ever moves
    its default outside the UI range, this stays a value the stepper can express (guarded by a
    model invariant test) rather than silently feeding an out-of-range value to a reroll. */
export const SEPARATION_DEFAULT = Math.max(SEPARATION_MIN, Math.min(SEPARATION_MAX, DEFAULT_MIN_SEPARATION));

/** Largest roster the app will GENERATE. Unconstrained generation is ~O(n²·k); past this it
    runs tens of seconds even off-thread, so the roster parser truncates and feasibility refuses
    above it. Import is capped to the SAME ceiling (MAX_IMPORT_N = MAX_ROSTER_N in importGraph.ts),
    because import re-measures synchronously on the main thread — allowing more would reintroduce
    an O(n²) freeze on load. */
export const MAX_ROSTER_N = 1000;

/** Roster size above which the core auto-disables polish (mirrors `resolveWantPolish` in
    lib/src/core/index.ts). Polish is the ONLY seed-dependent stage, and it is O(n·m)/iter,
    so above this the app (a) never forces polish=on — that would run for tens of seconds —
    and (b) knows a seed-bump reroll can't vary the RNG-free greedy output. If the core's
    threshold moves, update this. */
export const POLISH_MAX_N = 120;

/** Seeds are clamped to [0, SEED_MAX] so a `seed + 1` reroll always advances at float
    precision (integers past 2^53 don't). */
export const SEED_MAX = 2 ** 31 - 1;

/** The next reroll seed, kept within the declared [0, SEED_MAX] range — advance by one, or wrap
    to 0 at the ceiling. The single source of the reroll increment so the stored seed can never
    drift past the range the import path also clamps to. */
export function nextRerollSeed(seed: number): number {
  return seed >= SEED_MAX ? 0 : seed + 1;
}

/**
 * Display metrics. `aspl`/`diameter` are averaged/maxed over REACHABLE pairs only, so
 * they are meaningful for the whole roster only when it is connected — they are `null`
 * when the graph is disconnected (some pairs never meet) or trivial (n<=1). `girth` is
 * `null` for a forest.
 */
export interface Metrics {
  aspl: number | null;
  diameter: number | null;
  girth: number | null;
  quality: number; // 0..1; 0 when disconnected (there is no whole-group closeness to score)
  connected: boolean;
  largestComponentFraction: number; // 1 when connected; else the largest group's share
  regular: boolean;
  degreeMin: number;
  degreeMax: number;
}

/** Clamp an ASPL gap to a 0..1 quality score (1 = provably optimal). */
function clampQuality(gap: number): number {
  return Math.max(0, Math.min(1, 1 - gap));
}

/**
 * quality = clamp01(1 - asplGap): the core's Moore-gap. THE single scorer — `assembleMetrics`
 * calls this, so there is one implementation behind the displayed number. A non-finite ASPL
 * (no reachable pairs: edgeless / n<=1) scores 0, not "optimal" — otherwise `asplGap`'s "no
 * valid Moore bound => gap 0" would collapse to quality 1. This alone does not catch a
 * disconnected-but-edged graph (finite reachable-pairs mean); `assembleMetrics` gates that
 * on `connected`.
 */
export function quality(aspl: number, n: number, k: number): number {
  return Number.isFinite(aspl) ? clampQuality(asplGap(aspl, n, k)) : 0;
}

/** Normalize a non-finite metric to null (Infinity for no reachable pairs). */
function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

/** Min and max of a degree sequence, loop-based (avoids arg-spread limits). */
export function degreeExtent(degrees: number[]): [number, number] {
  if (degrees.length === 0) return [0, 0];
  let lo = degrees[0];
  let hi = degrees[0];
  for (const d of degrees) {
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

/** Quality below this reads as "connected but loosely linked" rather than "well-linked". */
const WELL_LINKED_QUALITY = 0.5;

/**
 * The one place that turns metrics into the connection caption, so the words can never
 * contradict the gauge: a disconnected graph never says "well-linked" (and its shown
 * largest-group % is floored below 100), a connected-but-poor graph says "loosely linked",
 * and a roster too small to score (no reachable pairs) says so instead of "well-linked".
 */
export function connectionSummary(m: Metrics): string {
  if (!m.connected) {
    const pct = Math.min(99, Math.floor(m.largestComponentFraction * 100));
    return `not everyone's connected — ${pct}% are in the largest group`;
  }
  if (m.aspl == null) return "not enough people yet to score";
  if (m.quality < WELL_LINKED_QUALITY) return "everyone's connected, but loosely linked";
  return "everyone's well-linked";
}

/** Raw numeric metrics a graph yields, before display normalization. */
export interface RawMetrics {
  aspl: number;
  diameter: number;
  girth: number;
  degreeMin: number;
  degreeMax: number;
  connected: boolean;
  largestComponentFraction: number;
}

/**
 * The single owner of the display `Metrics` shape — called by BOTH the generation and
 * import paths so they can't drift. Quality is scored against the graph's ACTUAL degree
 * (`degreeMax`), not a declared/target `k`, and ONLY when the whole roster is connected:
 * a disconnected import has a finite reachable-pairs ASPL that would otherwise beat the
 * whole-n Moore bound and read as a false 100%. When disconnected, aspl/diameter are null
 * (undefined over unreachable pairs) and quality is 0.
 */
export function assembleMetrics(n: number, raw: RawMetrics): Metrics {
  const measurable = raw.connected && Number.isFinite(raw.aspl);
  return {
    aspl: measurable ? raw.aspl : null,
    diameter: measurable ? raw.diameter : null,
    girth: finiteOrNull(raw.girth),
    quality: measurable ? quality(raw.aspl, n, raw.degreeMax) : 0, // one scorer (see quality())
    connected: raw.connected,
    largestComponentFraction: raw.largestComponentFraction,
    regular: raw.degreeMin === raw.degreeMax,
    degreeMin: raw.degreeMin,
    degreeMax: raw.degreeMax,
  };
}

/** Human label for how many buddies each person actually has: a single number when
    regular, else a min–max range. Reflects the produced graph, not the target `k`. */
export function degreeLabel(m: Metrics): string {
  return m.regular ? String(m.degreeMax) : `${m.degreeMin}–${m.degreeMax}`;
}

/**
 * Why a seed-bump "Different arrangement" CAN'T vary the graph, or null if it might.
 *
 * The seed only feeds the polish RNG and the greedy is RNG-free, so a re-roll can only vary
 * when polish runs (n <= POLISH_MAX_N and polish not off). This is a NECESSARY, not sufficient,
 * condition — a small polished graph can still converge to the same optimum, which only a
 * post-generation edge comparison (in useBuddyGraph) can detect. This function gives the cheap,
 * accurate reason for the two cases we CAN predict pre-hoc, with actionable, non-contradictory
 * copy (it never tells a user to enable polish they've already enabled).
 */
export function rerollBlockReason(n: number, settings: Settings): string | null {
  if (n > POLISH_MAX_N) {
    return "This group is too large to shuffle — a different arrangement is only possible for smaller groups.";
  }
  if (settings.polish === false) {
    return "Turn on Polish (Advanced) to see a different arrangement.";
  }
  return null; // reroll may vary — a post-generation identical-edges check handles the plateau
}

/** Person i's buddies as display names — the raw list that `buddyLabel` joins. Module-local:
    every UI sink goes through `buddyLabel`, so this has no external consumer. */
function buddyNames(view: GraphView, i: number): string[] {
  return view.buddies[i].map((j) => view.names[j]);
}

/** The one buddy-cell projection — names joined by `separator`, or an em dash when a person has
    none. Shared by the on-screen list, the printed slips, the clipboard copy, and the CSV export
    (each passing its own separator) so the empty glyph and join can't drift between sinks. */
export function buddyLabel(view: GraphView, i: number, separator = ", "): string {
  return buddyNames(view, i).join(separator) || "—";
}

/**
 * The single view model that BOTH generation and import produce, so the whole UI
 * renders from one shape regardless of origin.
 */
export interface GraphView {
  names: string[];
  edges: [number, number][];
  buddies: number[][];
  settings: Settings;
  metrics: Metrics;
}

/** Combine a worker BuddyResult with the roster + settings into a GraphView. The
    unconstrained builder seeds a ring, so its output is always connected. */
export function viewFromResult(names: string[], settings: Settings, r: BuddyResult): GraphView {
  return {
    names,
    edges: r.edges,
    buddies: r.buddies,
    settings,
    metrics: assembleMetrics(names.length, {
      aspl: r.aspl,
      diameter: r.diameter,
      girth: r.girth,
      degreeMin: r.degreeMin,
      degreeMax: r.degreeMax,
      connected: true,
      largestComponentFraction: 1,
    }),
  };
}
