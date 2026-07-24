import type { Metrics } from "../model";

/**
 * The versioned BuddyGraph file format (F6). Matches PROJECT_PLAN §4 F6 and
 * DESIGN_HANDOFF.md §9: `{version, people, constraints, edges, settings, meta}`.
 * `constraints` is present-but-empty in M2 (the constraints UI is F7/M3) so the
 * schema is stable from day one and can already carry hand-authored constraints.
 */
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
    // Informational / write-only: exportGraph writes the produced Metrics here, but
    // importGraph ignores it and RE-MEASURES from `edges`. Reuses the Metrics type
    // (not a hand-copied mirror) so it can't drift when Metrics gains a field.
    metrics: Metrics;
  };
}
