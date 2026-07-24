import { asplGap, type BuddyResult } from "ringweave";

/** Generation settings surfaced in the UI (mirrors the core's BuddyOptions + k). */
export interface Settings {
  buddies: number; // k — the generation target (used by generate/reroll)
  minSeparation?: number;
  polish: boolean | "auto";
  seed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  buddies: 4,
  polish: "auto",
  seed: 12345,
};

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
 * quality = clamp01(1 - asplGap): the core's Moore-gap, never re-derived in the UI. A
 * non-finite ASPL (no reachable pairs: edgeless / n<=1) scores 0, not "optimal" —
 * otherwise `asplGap`'s "no valid Moore bound => gap 0" would collapse to quality 1.
 * NOTE: this does not by itself catch a disconnected-but-edged graph (whose ASPL is a
 * finite reachable-pairs mean); `assembleMetrics` gates that on `connected`.
 */
export function quality(aspl: number, n: number, k: number): number {
  return Number.isFinite(aspl) ? clampQuality(asplGap(aspl, n, k)) : 0;
}

/** Normalize a non-finite metric to null (Infinity for no reachable pairs). */
export function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
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
    quality: measurable ? clampQuality(asplGap(raw.aspl, n, raw.degreeMax)) : 0,
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

/** Display names of person i's buddies. Shared by BuddyList and Slips. */
export function buddyNames(view: GraphView, i: number): string[] {
  return view.buddies[i].map((j) => view.names[j]);
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
