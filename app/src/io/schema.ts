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
    metrics: {
      aspl: number | null; // Infinity -> null at the JSON boundary
      diameter: number | null;
      girth: number | null;
      quality: number;
      regular: boolean;
      degreeMin: number;
      degreeMax: number;
    };
  };
}
