/**
 * The generation worker's body, as a plain function.
 *
 * Split out from `generate.worker.ts` so it can be tested directly: a module
 * worker cannot be instantiated under jsdom, so as long as this logic lived
 * inside `onmessage` the entire request→response mapping — including the error
 * and refusal channels, which are the parts that matter — was unreachable from
 * the suite. The worker file is now only the wiring that cannot be tested anyway.
 *
 * All math lives in `ringweave`; nothing here reimplements any of it.
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
    // Deliberately omitted by the constrained builder; measured here rather than
    // on the main thread, where an uncapped O(n²) sweep would block the tab.
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
 * The constrained builder is used ONLY when there are constraints. It is a
 * different algorithm with different guarantees, so routing unconstrained traffic
 * through it would change every existing output — invalidating the reroll and
 * determinism tests — for no user benefit.
 *
 * Feasibility is checked with `validateDetailed` before building. That is the same
 * predicate `buildConstrainedBuddyGraph` applies internally (identical here, since
 * the app has no priors to promote), so the builder cannot then refuse; checking
 * first is what lets the refusal carry structured reasons instead of the prose
 * strings its report would give.
 *
 * `buildBuddyGraph` THROWS on k<2 / malformed n,k (it has no report channel — see
 * its contract note), so every call is wrapped and the message is returned over
 * the error channel rather than escaping as an unhandled worker error, which the
 * main thread would see only as a bare "error" event with no cause.
 */
export function runGeneration(req: GenerateRequest): GenerateResponse {
  const { id, n, k, options, constraints } = req;
  try {
    if (constraints.required.length === 0 && constraints.prohibited.length === 0) {
      return { id, kind: "ok", result: fromUnconstrained(buildBuddyGraph(n, k, options)) };
    }

    const cons = toConstraints(n, joinPairs(constraints.required, constraints.prohibited));

    const refusals = validateDetailed(cons, k);
    if (refusals.length > 0) return { id, kind: "refused", refusals };

    const built = buildConstrainedBuddyGraph(n, k, cons, options);
    // The builder has its own refusal channel, and the pre-check above is NOT a proof
    // that it stays empty — it is the same predicate only while the app has no priors to
    // promote, which is what `withHardPriors` would change. Mapping a refusal to `kind:
    // "ok"` renders an edgeless graph as "all rules satisfied", which is precisely the
    // silent partial F7's acceptance criteria forbid. Checked rather than assumed, so the
    // day a promotion step exists this fails loudly instead of lying.
    if (built.report.refusals.length > 0) {
      return {
        id,
        kind: "refused",
        // The builder reports prose; the channel carries structured reasons. Re-derive
        // them from the same validator rather than parsing its strings back — and if that
        // somehow disagrees, the error channel is the honest answer, never "ok".
        refusals: validateDetailed(cons, k),
      };
    }
    return { id, kind: "ok", result: fromConstrained(n, built) };
  } catch (err) {
    return { id, kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
