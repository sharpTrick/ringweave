import { asplGap, type BuddyResult } from "ringweave";

/** Generation settings surfaced in the UI (mirrors the core's BuddyOptions + k). */
export interface Settings {
  buddies: number; // k
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

/** quality = clamp01(1 - asplGap): the core's Moore-gap, never re-derived in the UI.
    Used on the import path, which has no BuddyResult to read `asplGap` from. */
export function quality(aspl: number, n: number, k: number): number {
  return clampQuality(asplGap(aspl, n, k));
}

/** Display names of person i's buddies. Shared by BuddyList and Slips. */
export function buddyNames(view: GraphView, i: number): string[] {
  return view.buddies[i].map((j) => view.names[j]);
}

/** Normalize a non-finite metric (Infinity for n<=1 / disconnected) to null. */
export function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

/** Combine a worker BuddyResult with the roster + settings into a GraphView. */
export function viewFromResult(names: string[], settings: Settings, r: BuddyResult): GraphView {
  return {
    names,
    edges: r.edges,
    buddies: r.buddies,
    settings,
    metrics: {
      aspl: finiteOrNull(r.aspl),
      diameter: finiteOrNull(r.diameter),
      girth: finiteOrNull(r.girth),
      // Trust the core's own asplGap field rather than recomputing it.
      quality: clampQuality(r.asplGap),
      regular: r.regular,
      degreeMin: r.degreeMin,
      degreeMax: r.degreeMax,
    },
  };
}
