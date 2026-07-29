import {
  asplGap,
  autoPolishEnabled,
  DEFAULT_MIN_SEPARATION,
  type ConstraintReport,
} from "ringweave";
import type { ConstraintPair } from "./constraints";
import type { GraphResult } from "./worker/protocol";
import { clamp, clampList } from "./io/clamp";

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
export const SEPARATION_DEFAULT = clamp(DEFAULT_MIN_SEPARATION, SEPARATION_MIN, SEPARATION_MAX);

/** Largest roster the app will GENERATE. Unconstrained generation is ~O(n²·k); past this it
    runs tens of seconds even off-thread, so the roster parser truncates and feasibility refuses
    above it. Import is capped to the SAME ceiling (MAX_IMPORT_N = MAX_ROSTER_N in importGraph.ts),
    because import re-measures synchronously on the main thread — allowing more would reintroduce
    an O(n²) freeze on load. */
export const MAX_ROSTER_N = 1000;

/**
 * Whether a seed bump can vary this configuration at all — asked of the CORE, not
 * predicted here.
 *
 * This used to be `POLISH_MAX_N = 120`, a literal mirroring the core's auto-polish
 * gate. The core's gate is not a flat n: it compares modelled polish work against a
 * budget, so the real cutoff is k-dependent (146 at k=2, 131 at k=3, 120 at k=4, 78
 * at k=12) and different again for the constrained builder. 120 was correct only at
 * k=4 — the one value the boundary test pinned — and it disagreed in BOTH directions
 * everywhere else. Above 120 at k<4 the app refused to dispatch at all, telling the
 * user "this group is too large to shuffle" about a roster the core would happily
 * polish into a different arrangement.
 *
 * Exporting the core's *number* would have re-created the same drift one release
 * later, so the core exports the *predicate* and this asks it.
 */
function seedCanVary(n: number, settings: Settings, constrained: boolean): boolean {
  return autoPolishEnabled(n, settings.buddies, { constrained });
}

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
 * The graph's measured metrics. Most feed the UI: `aspl`/`diameter`/`quality` in QualityPanel,
 * `regular`/`degreeMin`/`degreeMax` the rail's buddy-count label, `connected`/
 * `largestComponentFraction`/`quality` the connection caption. `aspl`/`diameter` are
 * averaged/maxed over REACHABLE pairs only, so they are `null` when the graph is disconnected or
 * trivial (n<=1). `girth` is NOT shown anywhere in the M2 UI — it is carried through only to the
 * exported file's `meta.metrics` snapshot (F6), so the schema stays a full characterization; it
 * is `null` for a forest.
 */
export interface Metrics {
  aspl: number | null;
  diameter: number | null;
  girth: number | null; // export-only (meta.metrics); not displayed in M2
  quality: number; // 0..1; 0 when disconnected (there is no whole-group closeness to score)
  connected: boolean;
  largestComponentFraction: number; // 1 when connected; else the largest group's share
  regular: boolean;
  degreeMin: number;
  degreeMax: number;
}

/** Clamp an ASPL gap to a 0..1 quality score (1 = provably optimal). */
function clampQuality(gap: number): number {
  return clamp(1 - gap, 0, 1);
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

/** THE displayed quality number — the integer percentage the gauge shows. Both the gauge and the
    connection caption derive from this ONE rounded value, so a score can't render (say) "50" with
    "loosely linked" while a hair above renders "50" with "well-linked" (a rounding-vs-threshold
    straddle). */
export function qualityPercent(m: Metrics): number {
  return Math.round(m.quality * 100);
}

/** Whether the graph is PROVABLY optimal (quality exactly 1 = zero Moore gap). Deliberately the
    exact score, NOT `qualityPercent(m) === 100`: a 99.6% graph rounds to a gauge of 100 but a
    reroll could still improve it, so the "already optimal" copy must not fire there. The single
    seam for the optimality claim, beside qualityPercent, so all quality-derived copy agrees. */
export function isOptimal(m: Metrics): boolean {
  return m.quality === 1;
}

/**
 * The buddy-rule outcome line, or null when there are no rules to report on.
 *
 * Deliberately distinct from `connectionSummary`: connectivity and rule
 * satisfaction are different claims, and folding them together is how "the graph
 * is split into three groups" ends up rendering as a clean tick.
 *
 * A null report means NOT MEASURED, never "satisfied". Import rehydrates edges
 * without regenerating, so an imported constrained file has no report — and
 * showing it as satisfied would be exactly the disconnected-reads-as-optimal
 * class this app already guards elsewhere.
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

/** Gauge percentage at/above which a connected graph reads as "well-linked" rather than "loosely". */
const WELL_LINKED_PCT = 50;

/**
 * The one place that turns metrics into the connection caption, so the words can never
 * contradict the gauge: a disconnected graph never says "well-linked" (and its shown
 * largest-group % is floored below 100), a connected-but-poor graph says "loosely linked",
 * and a roster too small to score (no reachable pairs) says so instead of "well-linked".
 * Thresholds on the SAME rounded percent the gauge displays (qualityPercent).
 */
export function connectionSummary(m: Metrics): string {
  if (!m.connected) {
    // Clamped at BOTH ends. The Math.min(99, …) guard stopped a nearly-whole graph
    // reading as "100% are in the largest group" while disconnected; the floor had the
    // mirror-image problem, reporting "0% are in the largest group" for a badly shattered
    // roster whose largest group is non-empty by definition. Same one-line symmetry.
    const pct = clamp(Math.floor(m.largestComponentFraction * 100), 1, 99);
    return `not everyone's connected — ${pct}% are in the largest group`;
  }
  if (m.aspl == null) return "not enough people yet to score";
  // NAMES THE YARDSTICK. `quality` is the gap to the Moore bound FOR THE DEGREE THIS GRAPH
  // ACTUALLY HAS — deliberately so, since a 3-regular graph can be exactly optimal for 3
  // buddies and scoring it against a 12-buddy bound would call it bad for succeeding. But a
  // bare "everyone's well-linked" reads as a claim about the group in the abstract, and two
  // rosters with different buddy counts then sit next to different hop counts with captions
  // that do not explain why. Saying what the score is relative to costs one clause and makes
  // the sentence true as written.
  // Built from `degreeLabel`, the same function the rail uses one panel away. Naming the
  // yardstick with `degreeMax` alone meant the two panels stated different per-person buddy
  // counts for one graph whenever it was not regular — and the prose one was the count only
  // the best-connected person actually had.
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
 * "4 buddies" / "1 buddy" — the number AND its noun, from one seam.
 *
 * `degreeLabel` made the NUMBER single-sourced after two panels disagreed about it; the noun
 * beside it stayed copy-pasted, and the rail then hardcoded the plural while the connection
 * caption and the shortfall line both pluralised correctly. A 2-person, 1-edge import read
 * "2 people · 1 buddies each" next to "everyone's well-linked for 1 buddy each" — one graph,
 * two panels, disagreeing about the same count. A seam for the number and none for the noun
 * is half a seam.
 */
export function buddiesLabel(m: Metrics): string {
  return `${degreeLabel(m)} ${m.regular && m.degreeMax === 1 ? "buddy" : "buddies"}`;
}

/** "4 buddies each" — the phrase the rail and the connection caption both render. */
export function buddiesEachLabel(m: Metrics): string {
  return `${buddiesLabel(m)} each`;
}

/** "person" / "people". The other noun the rail got wrong ("1 people"). */
export function peopleNoun(n: number): string {
  return n === 1 ? "person" : "people";
}

/**
 * Why a seed-bump "Different arrangement" CAN'T vary the graph, or null if it might.
 *
 * The seed only feeds the polish RNG and the greedy is RNG-free, so a re-roll can only vary
 * when polish runs (the core's own gate says so, and polish is not off). NECESSARY, not sufficient —
 * condition — a small polished graph can still converge to the same optimum, which only a
 * post-generation edge comparison (in useBuddyGraph) can detect. This function gives the cheap,
 * accurate reason for the two cases we CAN predict pre-hoc, with actionable, non-contradictory
 * copy (it never tells a user to enable polish they've already enabled).
 */
export function rerollBlockReason(
  n: number,
  settings: Settings,
  // Which builder will run, because the two have different polish budgets. Defaults
  // to the unconstrained path, which is what a caller with no rules is asking about.
  constrained = false,
): string | null {
  if (!seedCanVary(n, settings, constrained)) {
    return "This group is too large to shuffle — a different arrangement is only possible for smaller groups.";
  }
  if (settings.polish === false) {
    return "Turn on Polish (Advanced) to see a different arrangement.";
  }
  return null; // reroll may vary — a post-generation identical-edges check handles the plateau
}

/**
 * How far short of the requested buddy count the delivered graph fell, or null when it met it.
 *
 * The app holds both numbers and never compared them. Quality is scored against the DELIVERED
 * degree — right, since a 3-regular graph can be exactly optimal for 3 buddies — but the
 * consequence is that asking for 4 and receiving 3 shows a gauge of 100, `isOptimal` true, and
 * a re-roll that answers "That's already an optimal arrangement". Every one of those statements
 * is true about the graph that was built and none of them tells the user they did not get what
 * they asked for. It is routine at small n, where the default minimum separation forces the
 * demotion floor.
 */
export function targetShortfall(view: GraphView): { asked: number; got: number } | null {
  const got = view.metrics.degreeMax;
  const asked = view.settings.buddies;
  return got < asked ? { asked, got } : null;
}

/**
 * How far short of the requested MINIMUM SEPARATION the delivered graph fell, or null when it
 * met it — the sibling of `targetShortfall`, and the same gap one setting over.
 *
 * The Advanced panel showed the number the user ASKED for while the core routinely demotes it,
 * and nothing disclosed the difference: at k=4 the default request of 5 is delivered as 3 at
 * n=12, 20 and 30, and `{minSeparation: 12}` and `{minSeparation: 5}` produce the identical
 * graph — so the control looked inert and the export recorded a target the graph does not meet.
 *
 * DERIVED FROM `girth`, which already crosses the worker boundary, rather than carrying the
 * core's `finalMinSeparation` across as a new field: separation IS `girth - 1` (the core's own
 * postcondition, and the property its tests pin), so a second channel for the same fact would be
 * a second thing to keep in step. It also works on the constrained path, whose builder ignores
 * the option entirely and reports no target at all, and on an imported graph, which has no
 * builder behind it.
 *
 * `girth === null` means acyclic — no cycle to measure, separation unbounded, nothing short.
 */
export function separationShortfall(view: GraphView): { asked: number; got: number } | null {
  if (view.metrics.girth === null) return null;
  const asked = view.settings.minSeparation ?? SEPARATION_DEFAULT;
  const got = view.metrics.girth - 1;
  return got < asked ? { asked, got } : null;
}

/**
 * What a screen reader is told when a person is selected.
 *
 * Selecting someone from the buddy list or a search result is the app's headline task, and it
 * produced NO immediate feedback: PersonPanel simply appeared, focus did not move into it, and it
 * precedes both controls in DOM order (deliberately — the DOM follows the visual layout), so Tab
 * had already passed it. Announcing the result is the fix that does not fight that ordering.
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
 * Exists so the SPOKEN version can live in a region that is always mounted while the visible
 * panel stays conditional. A live region has to be in the accessibility tree before its
 * content changes for the change to count as a change, and `PathPanel` — region and all — is
 * mounted by the same action that writes its first sentence, so nothing was ever announced.
 * One function so the two renderings cannot drift.
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
    // this string goes straight into a permanently-mounted live region. One of the three sinks
    // io/clamp.ts names — see there for why they are one helper rather than three.
    const chain = clampList(route.map((i) => view.names[i]), ROUTE_NAMES_MAX, " → ");
    return `${chain} — ${steps} step${steps === 1 ? "" : "s"}`;
  }
  return "";
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
  /**
   * The buddy rules this graph was built under. A sibling of `settings`, not part
   * of it — the file schema has always modelled them that way — so export, import
   * and re-measure round-trip them.
   */
  constraints: ConstraintPair[];
  /**
   * How the rules turned out, or null when there were none to report on.
   *
   * Also null for an IMPORTED constrained graph: import rehydrates edges rather
   * than regenerating, so no builder ran and there is nothing to report. That is
   * a real gap and the panel says "not measured" rather than implying success —
   * "no report" must never render as "all rules satisfied".
   */
  report: ConstraintReport | null;
}

/**
 * Combine a worker GraphResult (normalized from BuddyResult or ConstrainedBuddyResult) with the roster + settings into a GraphView.
 *
 * Connectivity is read from the result rather than assumed. It used to be
 * hardcoded true on the reasoning that the unconstrained builder seeds a ring and
 * so always connects — true of that builder, but it made the *view* layer carry a
 * fact about a *generator*, which is exactly the assumption that goes stale the
 * moment a second generator feeds the same view.
 */
export function viewFromResult(
  names: string[],
  settings: Settings,
  constraints: ConstraintPair[],
  r: GraphResult,
): GraphView {
  return {
    names,
    edges: r.edges,
    buddies: r.buddies,
    settings,
    constraints,
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
