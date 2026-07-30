import type { ConstraintReport, Reason } from "ringweave";

export interface GenerateOptions {
  minSeparation?: number;
  polish?: boolean | "auto";
  seed?: number;
}

/**
 * Main thread → worker; `id` correlates the response so stale runs can be dropped.
 *
 * Constraints cross as plain index pairs: a core `Constraints` holds private `#` Set fields and is
 * not structured-clone-safe, so the worker rebuilds one on the other side.
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
 * The one payload BOTH builders normalize into before crossing the worker boundary, so the view
 * layer has a single producer and never branches on which builder ran.
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
 * `refused` is a third outcome, not an error: the input was well-formed and no graph satisfies the
 * rules. It carries structured {@link Reason}s — clone-safe, and enough for the UI to name people.
 */
export type GenerateResponse =
  | { id: number; kind: "ok"; result: GraphResult }
  | { id: number; kind: "error"; error: string }
  | { id: number; kind: "refused"; refusals: Reason[] };

/**
 * Whether a request needs the constraint-aware builder. ONE predicate, over the wire shape, so a
 * new constraint field cannot be added to the worker's routing and missed by the main thread's.
 */
export function isConstrainedRequest(c: GenerateRequest["constraints"]): boolean {
  return c.required.length > 0 || c.prohibited.length > 0;
}
