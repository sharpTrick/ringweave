import type { ConstraintReport, Reason } from "ringweave";

/** Generation options mirroring the subset of the core's `BuddyOptions` the UI exposes. */
export interface GenerateOptions {
  minSeparation?: number;
  polish?: boolean | "auto";
  seed?: number;
}

/**
 * Main thread → worker. `id` correlates the response and lets stale runs be dropped.
 *
 * Constraints cross as plain index pairs, not as a core `Constraints` instance:
 * that class holds private `#` Set fields and so is not structured-clone-safe. The
 * worker rebuilds one on the other side.
 */
export interface GenerateRequest {
  id: number;
  n: number;
  k: number;
  options: GenerateOptions;
  constraints: {
    required: [number, number][];
    prohibited: [number, number][];
  };
}

/**
 * The one payload shape both builders are normalized into before crossing the
 * worker boundary.
 *
 * `BuddyResult` and `ConstrainedBuddyResult` differ (the constrained one omits
 * `girth`/`asplGap`, since Moore's bound assumes a k-regular target that
 * constrained graphs only approximate), so they are not assignable to one another
 * and a union would push the fork into every consumer. Normalizing here keeps the
 * view layer with a single producer and no branch on which builder ran.
 *
 * `girth` for the constrained path is measured in the worker from a rebuilt
 * `Graph`, exactly as `ConstrainedBuddyResult`'s own doc instructs — it is O(n²)
 * and belongs off the main thread. `asplGap` is not carried because nothing reads
 * it: `model.ts` computes quality from `aspl` itself.
 */
export interface GraphResult {
  buddies: number[][];
  edges: [number, number][];
  regular: boolean;
  degreeMin: number;
  degreeMax: number;
  aspl: number;
  diameter: number;
  girth: number;
  polished: boolean;
  connected: boolean;
  largestComponentFraction: number;
  /** Constraint outcome, or null when the graph was generated without constraints. */
  report: ConstraintReport | null;
}

/**
 * Worker → main thread, as a three-way tagged union.
 *
 * `refused` is genuinely a third outcome and not an error: the input was
 * well-formed, the app is working, and no graph exists that satisfies the rules.
 * It carries structured {@link Reason}s (plain data, so clone-safe) rather than
 * prose, so the UI can name the people involved.
 *
 * `error` still carries a message string because it comes from a thrown Error —
 * `buildBuddyGraph` throws on k<2 / bad n,k, having no report channel of its own.
 */
export type GenerateResponse =
  | { id: number; kind: "ok"; result: GraphResult }
  | { id: number; kind: "error"; error: string }
  | { id: number; kind: "refused"; refusals: Reason[] };

/**
 * Whether a request needs the constraint-aware builder.
 *
 * ONE predicate, over the wire shape, because there were two: the worker routed on
 * `required.length === 0 && prohibited.length === 0` and the main thread picked its auto-polish
 * budget from `ConstraintPair[].length > 0` — equivalent only because `splitPairs` preserves the
 * total, on opposite sides of the structured-clone boundary, in different files, under different
 * names for the same fact. They do not look like duplicates of each other, which is exactly what
 * makes the next field (F9's priors) easy to add to one and miss in the other: routing a
 * priors-only request through `buildBuddyGraph`, which never sees priors, would preserve nothing
 * and report success.
 */
export function isConstrainedRequest(c: GenerateRequest["constraints"]): boolean {
  return c.required.length > 0 || c.prohibited.length > 0;
}
