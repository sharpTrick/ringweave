import {
  asplGap,
  autoPolishEnabled,
  DEFAULT_MIN_SEPARATION,
  type ConstraintReport,
} from "ringweave";
import type { ConstraintPair, NamedPair } from "./constraints";
import type { GraphResult } from "./worker/protocol";
import { clamp, clampList } from "./io/clamp";

/** Generation settings surfaced in the UI (mirrors the core's BuddyOptions + k). */
export interface Settings {
  buddies: number; // the core's `k`
  minSeparation?: number;
  polish: boolean | "auto";
  seed: number;
}

/** Default polish RNG seed — matches the core's default. */
export const DEFAULT_SEED = 12345;

export const DEFAULT_SETTINGS: Settings = {
  buddies: 4,
  polish: "auto",
  seed: DEFAULT_SEED,
};

/** Buddies-per-person range the UI supports — shared by the settings stepper and the import
    clamp, so they can't diverge. */
export const BUDDY_MIN = 2;
export const BUDDY_MAX = 12;

/** Minimum-separation range. Shares bounds with the buddy range by coincidence, not by rule. */
export const SEPARATION_MIN = 2;
export const SEPARATION_MAX = 12;

/** The default minimum separation, mirroring the core's. Clamped into the UI range so a core
    default outside it stays a value the stepper can express rather than reaching a reroll. */
export const SEPARATION_DEFAULT = clamp(DEFAULT_MIN_SEPARATION, SEPARATION_MIN, SEPARATION_MAX);

/** Largest roster the app will GENERATE. Import is capped to the SAME ceiling
    (MAX_IMPORT_N in importGraph.ts), because import re-measures synchronously on the main
    thread. */
export const MAX_ROSTER_N = 1000;

/** Whether a seed bump can vary this configuration — asked of the CORE. The gate is k-dependent
    and differs per builder, so a mirrored constant here is wrong away from one k. */
function seedCanVary(n: number, settings: Settings, constrained: boolean): boolean {
  return autoPolishEnabled(n, settings.buddies, { constrained });
}

/** Seeds are clamped to [0, SEED_MAX] so a `seed + 1` reroll always advances at float
    precision (integers past 2^53 don't). */
export const SEED_MAX = 2 ** 31 - 1;

export function nextRerollSeed(seed: number): number {
  return seed >= SEED_MAX ? 0 : seed + 1;
}

/**
 * The graph's measured metrics. `aspl`/`diameter` are averaged/maxed over REACHABLE pairs only,
 * so they are `null` when the graph is disconnected or trivial (n<=1).
 */
export interface Metrics {
  aspl: number | null;
  diameter: number | null;
  girth: number | null; // null for a forest; `separationShortfall` derives the displayed separation from it
  quality: number; // 0..1; 0 when disconnected
  connected: boolean;
  largestComponentFraction: number; // 1 when connected; else the largest group's share
  regular: boolean;
  degreeMin: number;
  degreeMax: number;
}

function clampQuality(gap: number): number {
  return clamp(1 - gap, 0, 1);
}

/**
 * quality = clamp01(1 - asplGap). A non-finite ASPL (no reachable pairs) scores 0, not
 * "optimal" — otherwise `asplGap`'s "no valid Moore bound => gap 0" would collapse to quality 1.
 * Does not catch a disconnected-but-edged graph; `assembleMetrics` gates that on `connected`.
 */
export function quality(aspl: number, n: number, k: number): number {
  return Number.isFinite(aspl) ? clampQuality(asplGap(aspl, n, k)) : 0;
}

function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

/** Min and max of a degree sequence, loop-based so a roster-sized array can't hit the
    argument-spread limit. */
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

/** THE displayed quality number. Both the gauge and the connection caption must derive from this
    ONE rounded value, or a score can straddle rounding and threshold and render "50" with two
    different captions. */
export function qualityPercent(m: Metrics): number {
  return Math.round(m.quality * 100);
}

/** Whether the graph is PROVABLY optimal. The exact score, NOT `qualityPercent(m) === 100`: a
    99.6% graph rounds to a gauge of 100 but a reroll could still improve it. */
export function isOptimal(m: Metrics): boolean {
  return m.quality === 1;
}

/**
 * Whether the graph on screen meets EVERY target the quality panel discloses — the question the
 * identical-reroll toast is really asking.
 *
 * Named here rather than spelled out at the call site so the toast and the panel cannot answer it
 * with different predicates: `isOptimal` alone once said "already optimal" over a panel reading
 * "Buddies are 3 steps apart, not the 5 in Settings".
 */
export function meetsEverySetting(view: GraphView): boolean {
  return isOptimal(view.metrics) && targetShortfall(view) === null && separationShortfall(view) === null;
}

/**
 * The buddy-rule outcome line, or null when there are no rules to report on.
 *
 * A null report means NOT MEASURED, never "satisfied" — import rehydrates edges without
 * regenerating, so an imported constrained file has no report.
 */
export function constraintSummary(view: GraphView): string | null {
  const total = view.constraints.length;
  if (total === 0) return null;
  const rules = `${total} buddy rule${total === 1 ? "" : "s"}`;
  const report = view.report;
  if (report === null) return `${rules} saved with this graph — not re-checked on import.`;
  const broken = report.reqViolations + report.prohViolations;
  if (broken === 0) return `all ${rules} satisfied`;
  return `${broken} of ${rules} couldn't be met`;
}

const WELL_LINKED_PCT = 50;

/**
 * The one place that turns metrics into the connection caption, so the words can never
 * contradict the gauge. Thresholds run on the SAME rounded percent the gauge displays
 * (`qualityPercent`).
 */
export function connectionSummary(m: Metrics): string {
  if (!m.connected) {
    // Clamped at BOTH ends: 100 would read as "everyone" while disconnected, and 0 as an empty
    // largest group, which is impossible by definition.
    const pct = clamp(Math.floor(m.largestComponentFraction * 100), 1, 99);
    return `not everyone's connected — ${pct}% are in the largest group`;
  }
  if (m.aspl == null) return "not enough people yet to score";
  // Names the yardstick: `quality` is the gap to the Moore bound FOR THE DEGREE THIS GRAPH
  // ACTUALLY HAS, so a bare "well-linked" would be a claim about the group in the abstract.
  // Built from `degreeLabel` — `degreeMax` alone made this and the rail state different
  // per-person counts for one non-regular graph.
  const per = buddiesEachLabel(m);
  if (qualityPercent(m) < WELL_LINKED_PCT) return `everyone's connected, but loosely linked for ${per}`;
  return `everyone's well-linked for ${per}`;
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
 * The single owner of the display `Metrics` shape — called by BOTH the generation and import
 * paths. Quality is scored against the ACTUAL degree and ONLY when the whole roster is
 * connected: a disconnected import has a finite reachable-pairs ASPL that would otherwise beat
 * the whole-n Moore bound and read as a false 100%.
 */
export function assembleMetrics(n: number, raw: RawMetrics): Metrics {
  const measurable = raw.connected && Number.isFinite(raw.aspl);
  return {
    aspl: measurable ? raw.aspl : null,
    diameter: measurable ? raw.diameter : null,
    girth: finiteOrNull(raw.girth),
    quality: measurable ? quality(raw.aspl, n, raw.degreeMax) : 0,
    connected: raw.connected,
    largestComponentFraction: raw.largestComponentFraction,
    regular: raw.degreeMin === raw.degreeMax,
    degreeMin: raw.degreeMin,
    degreeMax: raw.degreeMax,
  };
}

/** How many buddies each person actually has. Reflects the produced graph, not the target `k`. */
export function degreeLabel(m: Metrics): string {
  return m.regular ? String(m.degreeMax) : `${m.degreeMin}–${m.degreeMax}`;
}

/** "4 buddies" / "1 buddy" — the number AND its noun from one seam, so two panels can't
    pluralise the same count differently. */
export function buddiesLabel(m: Metrics): string {
  return `${degreeLabel(m)} ${m.regular && m.degreeMax === 1 ? "buddy" : "buddies"}`;
}

/** "4 buddies each" — the phrase the rail and the connection caption both render. */
export function buddiesEachLabel(m: Metrics): string {
  return `${buddiesLabel(m)} each`;
}

export function peopleNoun(n: number): string {
  return n === 1 ? "person" : "people";
}

/**
 * Why a seed-bump "Different arrangement" CAN'T vary the graph, or null if it might.
 *
 * NECESSARY, not sufficient: a small polished graph can still converge to the same optimum,
 * which only a post-generation edge comparison (in useBuddyGraph) can detect.
 */
export function rerollBlockReason(
  n: number,
  settings: Settings,
  // Which builder will run — the two have different polish budgets.
  constrained = false,
): string | null {
  if (!seedCanVary(n, settings, constrained)) {
    return "This group is too large to shuffle — a different arrangement is only possible for smaller groups.";
  }
  if (settings.polish === false) {
    return "Turn on Polish (Advanced) to see a different arrangement.";
  }
  return null; // may vary — the plateau is caught post-hoc by an identical-edges check
}

/**
 * How far short of the requested buddy count the delivered graph fell, or null when it met it.
 *
 * Quality is scored against the DELIVERED degree, so asking for 4 and receiving 3 shows a gauge
 * of 100, `isOptimal` true and "already optimal" on reroll — all true of the graph that was
 * built, none of them saying the ask was missed.
 */
export function targetShortfall(view: GraphView): { asked: number; got: number } | null {
  const got = view.metrics.degreeMax;
  const asked = view.settings.buddies;
  return got < asked ? { asked, got } : null;
}

/**
 * How far short of the requested MINIMUM SEPARATION the delivered graph fell, or null when it
 * met it. The core routinely demotes the request and nothing else discloses it.
 *
 * DERIVED FROM `girth` rather than carrying the core's `finalMinSeparation` as a new field:
 * separation IS `girth - 1` (the core's own postcondition), so a second channel would be a
 * second thing to keep in step — and this also works on an imported graph, which has no builder
 * behind it. `girth === null` means acyclic: separation unbounded, nothing short.
 */
export function separationShortfall(view: GraphView): { asked: number; got: number } | null {
  // NOT ON THE CONSTRAINED PATH: the core documents `minSeparation` as "ACCEPTED AND IGNORED"
  // there, so reporting a shortfall would blame a knob no value of which changes the output.
  if (view.constraints.length > 0) return null;
  if (view.metrics.girth === null) return null;
  const asked = view.settings.minSeparation ?? SEPARATION_DEFAULT;
  const got = view.metrics.girth - 1;
  return got < asked ? { asked, got } : null;
}

/**
 * What a screen reader is told when a person is selected.
 *
 * The only feedback for the app's headline task: `PersonPanel` precedes both controls in DOM
 * order (deliberately — the DOM follows the visual layout), so Tab has already passed it and
 * focus is not moved into it.
 */
export function selectionStatusText(view: GraphView, index: number | null): string {
  if (index === null) return "";
  const buddies = view.buddies[index] ?? [];
  const names = buddies.map((i) => view.names[i]);
  if (names.length === 0) return `${view.names[index]} selected — no buddies yet.`;
  return `${view.names[index]} selected — ${names.length} ${
    names.length === 1 ? "buddy" : "buddies"
  }: ${clampList(names, ROUTE_NAMES_MAX)}.`;
}

/** How many people a spoken route names before it counts the rest. */
const ROUTE_NAMES_MAX = 12;

/**
 * The path finder's announcement, as plain text.
 *
 * Exists so the SPOKEN version can live in an always-mounted region while the visible panel
 * stays conditional: a live region must be in the accessibility tree BEFORE its content changes
 * for the change to count, and `PathPanel` is mounted by the same action that writes its first
 * sentence.
 */
export function pathStatusText(
  view: GraphView,
  from: number | null,
  route: number[] | null,
  unreachable: boolean,
): string {
  if (from !== null) return `Starting from ${view.names[from]} — now pick the other person.`;
  if (unreachable) return "No chain — they're in separate groups.";
  if (route !== null) {
    const steps = route.length - 1;
    // Clamped: a route's length is the graph's diameter, which an imported file controls, and
    // this goes straight into a permanently-mounted live region.
    const chain = clampList(route.map((i) => view.names[i]), ROUTE_NAMES_MAX, " → ");
    return `${chain} — ${steps} step${steps === 1 ? "" : "s"}`;
  }
  return "";
}

function buddyNames(view: GraphView, i: number): string[] {
  return view.buddies[i].map((j) => view.names[j]);
}

/** The one buddy-cell projection, shared by the on-screen list, the printed slips, the clipboard
    copy and the CSV export (each passing its own separator) so the empty glyph and the join
    can't drift between sinks. */
export function buddyLabel(view: GraphView, i: number, separator = ", "): string {
  return buddyNames(view, i).join(separator) || "—";
}

/** The single view model that BOTH generation and import produce. */
export interface GraphView {
  names: string[];
  edges: [number, number][];
  buddies: number[][];
  settings: Settings;
  metrics: Metrics;
  /** A sibling of `settings`, not part of it — the file schema models them that way. */
  constraints: ConstraintPair[];
  /**
   * The rules AS TYPED, name-keyed. Not reconstructible from `constraints`, which holds only
   * what SURVIVED resolution: rebuilding rows from indices silently deletes the unresolved rows
   * the editor contracts to keep and flag.
   */
  rows: NamedPair[];
  /**
   * How the rules turned out, or null when there were none — and also null for an IMPORTED
   * constrained graph, where no builder ran. "No report" must never render as "all satisfied".
   */
  report: ConstraintReport | null;
}

/** Combine a worker GraphResult with the roster + settings into a GraphView. Connectivity is
    read from the result, never assumed from which builder ran. */
export function viewFromResult(
  names: string[],
  settings: Settings,
  constraints: ConstraintPair[],
  rows: NamedPair[],
  r: GraphResult,
): GraphView {
  return {
    names,
    edges: r.edges,
    buddies: r.buddies,
    settings,
    constraints,
    rows,
    report: r.report,
    metrics: assembleMetrics(names.length, {
      aspl: r.aspl,
      diameter: r.diameter,
      girth: r.girth,
      degreeMin: r.degreeMin,
      degreeMax: r.degreeMax,
      connected: r.connected,
      largestComponentFraction: r.largestComponentFraction,
    }),
  };
}
