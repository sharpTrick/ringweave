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

/** Display metrics. aspl/diameter/girth are null when non-finite (n<=1 / disconnected). */
export interface Metrics {
  aspl: number | null;
  diameter: number | null;
  girth: number | null;
  quality: number; // 0..1
  regular: boolean;
  degreeMin: number;
  degreeMax: number;
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

/** Clamp an ASPL gap to a 0..1 quality score (1 = provably optimal). */
function clampQuality(gap: number): number {
  return Math.max(0, Math.min(1, 1 - gap));
}

/** quality = clamp01(1 - asplGap): the core's Moore-gap, never re-derived in the UI. */
export function quality(aspl: number, n: number, k: number): number {
  return clampQuality(asplGap(aspl, n, k));
}

/** Normalize a non-finite metric (Infinity for n<=1 / disconnected) to null. */
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
}

/**
 * The single owner of the display `Metrics` shape — called by BOTH the generation and
 * import paths so they can't drift. Quality is scored against the graph's ACTUAL degree
 * (`degreeMax`), not a declared/target `k`: an imported graph must be measured honestly
 * (a 2-regular 4-cycle is 100%, regardless of what `settings.buddies` claims). For a
 * generated k-regular graph `degreeMax === k`, so this matches the core's own `asplGap`.
 */
export function assembleMetrics(n: number, raw: RawMetrics): Metrics {
  return {
    aspl: finiteOrNull(raw.aspl),
    diameter: finiteOrNull(raw.diameter),
    girth: finiteOrNull(raw.girth),
    quality: quality(raw.aspl, n, raw.degreeMax),
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

/** Combine a worker BuddyResult with the roster + settings into a GraphView. */
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
    }),
  };
}
