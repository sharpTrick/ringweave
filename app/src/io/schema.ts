import type { Metrics } from "../model";

/** The versioned BuddyGraph file format (F6) — the shape is fixed by PROJECT_PLAN §4 F6 and
    DESIGN_HANDOFF.md §9, so changing it needs a `version` bump and an import path for 1. */
export interface BuddyGraphFile {
  version: 1;
  people: { id: number; name: string }[];
  constraints: {
    required: [number, number][];
    prohibited: [number, number][];
  };
  edges: [number, number][]; // canonical u<v, sorted
  settings: {
    buddies: number;
    minSeparation?: number;
    polish: boolean | "auto";
    seed: number;
  };
  meta: {
    app: "BuddyGraph";
    // Write-only: `importGraph` ignores this and re-measures from `edges`, so nothing may be
    // read back out of it.
    metrics: Metrics;
  };
}
