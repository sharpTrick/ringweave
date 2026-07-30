/**
 * The generation worker's body, split out of `generate.worker.ts` so it can be tested: a module
 * worker cannot be instantiated under jsdom, so logic left inside `onmessage` is unreachable from
 * the suite.
 */
import {
  Graph,
  buildBuddyGraph,
  buildConstrainedBuddyGraph,
  girth,
  validateDetailed,
  type BuddyResult,
  type ConstrainedBuddyResult,
} from "ringweave";
import { joinPairs, toConstraints } from "../constraints";
import { isConstrainedRequest } from "./protocol";
import type { GenerateRequest, GenerateResponse, GraphResult } from "./protocol";

/** Rebuild a core Graph from an edge list, so girth can be measured off-thread. */
function graphFrom(n: number, edges: [number, number][]): Graph {
  const g = new Graph(n);
  for (const [a, b] of edges) g.addEdge(a, b);
  return g;
}

function fromUnconstrained(r: BuddyResult): GraphResult {
  return {
    buddies: r.buddies,
    edges: r.edges,
    regular: r.regular,
    degreeMin: r.degreeMin,
    degreeMax: r.degreeMax,
    aspl: r.aspl,
    diameter: r.diameter,
    girth: r.girth,
    polished: r.polished,
    connected: r.connected,
    largestComponentFraction: r.largestComponentFraction,
    report: null,
  };
}

function fromConstrained(n: number, r: ConstrainedBuddyResult): GraphResult {
  return {
    buddies: r.buddies,
    edges: r.edges,
    regular: r.regular,
    degreeMin: r.degreeMin,
    degreeMax: r.degreeMax,
    aspl: r.aspl,
    diameter: r.diameter,
    // Omitted by the constrained builder, and measured here rather than on the main thread, where
    // an uncapped O(n²) sweep would block the tab.
    girth: girth(graphFrom(n, r.edges)),
    polished: r.polished,
    connected: r.report.connected,
    largestComponentFraction: r.report.largestComponentFraction,
    report: r.report,
  };
}

/**
 * Run one generation request and produce the response to post back.
 *
 * The constrained builder runs ONLY when there are constraints: it is a different algorithm, so
 * routing unconstrained traffic through it would change every existing output.
 *
 * `buildBuddyGraph` THROWS on k<2 / malformed n,k, having no report channel, so every call is
 * wrapped — an escaping throw reaches the main thread as a bare "error" event with no cause.
 */
export function runGeneration(req: GenerateRequest): GenerateResponse {
  const { id, n, k, options, constraints } = req;
  try {
    if (!isConstrainedRequest(constraints)) {
      return { id, kind: "ok", result: fromUnconstrained(buildBuddyGraph(n, k, options)) };
    }

    const cons = toConstraints(n, joinPairs(constraints.required, constraints.prohibited));

    const refusals = validateDetailed(cons, k);
    if (refusals.length > 0) return { id, kind: "refused", refusals };

    const built = buildConstrainedBuddyGraph(n, k, cons, options);
    // A refusal must be READ from `report.refusals`, not inferred: the pre-check above is only
    // the same predicate while the app has no priors to promote, and mapping a refusal to "ok"
    // renders an edgeless graph as "all rules satisfied".
    if (built.report.refusals.length > 0) {
      // Reported as an ERROR carrying the builder's own words, not as a `refused` with structured
      // reasons: reaching here means `validateDetailed(cons, k)` was EMPTY three lines up, so
      // re-deriving it yields `[]` and the app words that as its generic fallback with the
      // buddy-rules disclosure shut. A refusal the app's validator cannot predict is not one it
      // can word, and saying so loudly is the whole point of this branch.
      return { id, kind: "error", error: built.report.refusals.join(" ") };
    }
    return { id, kind: "ok", result: fromConstrained(n, built) };
  } catch (err) {
    return { id, kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
