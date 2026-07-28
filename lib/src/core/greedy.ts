/**
 * Ring-greedy generation with an incrementally maintained all-pairs distance
 * matrix (the cached variant). Deterministic: no RNG. Produces byte-identical
 * edge sets to the Python reference `gen_c_cached.ring_greedy_cached`.
 *
 * Algorithm (Patrick Sharp). Incremental-distance caching applied to it:
 * Patrick Sharp with Claude (Anthropic), 2026. The incremental all-pairs
 * shortest-path identity is classical (see CONCEPT_LINEAGE).
 */
import { Graph, ring } from "./graph.js";
import {
  DEFAULT_MIN_SEPARATION, MAX_GREEDY_WORK, MAX_REPAIR_WORK, greedyWork, repairWork,
} from "./budgets.js";
import { bfsDistances } from "./metrics.js";

// Upper bound for ringGreedy's n×n cached-distance matrix (~100 MB at this n,
// ints capped well below the typed-array limit). Far tighter than MAX_ROSTER,
// which bounds only the O(n) structures (Graph adjacency, the constrained path).
export const MAX_CACHED_N = 5000;

export interface GreedyResult {
  graph: Graph;
  /** The mind (min-separation) target actually achieved after any demotion. */
  finalMind: number;
}

export interface GreedyOptions {
  /**
   * Minimum degrees of separation to aim for. Default 5, clamped to floor(n/2).
   * `mind` mirrors the Python reference kwarg; the constrained path spells the
   * same concept `minSeparation`.
   */
  mind?: number;
  /** When no pair is `mind` apart, shrink the target by 1 and retry rather than stop. Default true. */
  demote?: boolean;
  /** Run `repairDegrees` after completion to close degree gaps. Default false. */
  repair?: boolean;
}

export function ringGreedy(
  n: number,
  k: number,
  opts: GreedyOptions = {},
): GreedyResult {
  // k must be a real number: `deg >= NaN` is always false, silently disabling the
  // degree-cap logic in findPair. (The ring seed still gives every vertex degree
  // 2, so this path targets ~k, not a hard cap — unlike the constrained path.)
  if (!Number.isInteger(k) || k < 0) {
    throw new Error(`buddy count ${k} must be a non-negative integer`);
  }
  // Same reasoning as `k`, and it was the one numeric option left unchecked: `mind`
  // reaches `ecc < curMind`, and every comparison against NaN is false — so a NaN
  // separation target silently disables the separation logic and produces a DIFFERENT
  // graph, not an ignored option. It then propagates out as `finalMinSeparation`, so the
  // result reports a target that was never applied.
  const requestedMind = opts.mind ?? DEFAULT_MIN_SEPARATION;
  if (!Number.isInteger(requestedMind) || requestedMind < 0) {
    throw new Error(`minimum separation ${requestedMind} must be a non-negative integer`);
  }
  // The ring seed gives every vertex degree 2 and completion only ADDS edges, so
  // ringGreedy structurally cannot honor k < 2 — it would silently return a
  // 2-regular graph. Refuse and point to the constrained path, which builds the
  // empty graph (k=0) / matching (k=1) correctly.
  if (k < 2) {
    throw new Error(
      `ringGreedy needs k >= 2 (its ring seed floors degree at 2); for k < 2 use buildConstrainedBuddyGraph`,
    );
  }
  // ringGreedy allocates a flat n×n distance cache (O(n²) memory, and completion
  // is ~O(n³) time), so it is capped far tighter than MAX_ROSTER — beyond ~a few
  // thousand the Int32Array allocation would throw a native RangeError. Refuse
  // with a clear message; a malformed n (non-integer/negative) is left to ring()
  // → the Graph ctor for the canonical "must be an integer" message.
  if (Number.isInteger(n) && n > MAX_CACHED_N) {
    throw new Error(
      `ringGreedy supports up to ${MAX_CACHED_N} people (its distance cache is O(n²)); got ${n}`,
    );
  }
  // MAX_CACHED_N is a MEMORY bound and says so; this is the TIME bound it does not
  // provide. Without it, (1000, 999) — which `validate` refuses outright on the
  // constrained path — ran for over 22 minutes without returning. Same shape as
  // MAX_CONSTRAINED_WORK, different constant: see MAX_GREEDY_WORK on why the two
  // budgets are deliberately not shared.
  if (Number.isInteger(n) && Number.isInteger(k) && greedyWork(n, k) > MAX_GREEDY_WORK) {
    throw new Error(
      `roster size ${n} with ${k} buddies each is too large to generate in reasonable time — reduce the roster size or the buddy count`,
    );
  }
  const mind = requestedMind; // validated above
  const demote = opts.demote ?? true;
  const repair = opts.repair ?? false;

  const g = ring(n); // throws on a non-integer/negative n
  const INF = n + 5;

  // Flat n*n distance matrix; dist[i*n + j].
  const dist = new Int32Array(n * n).fill(INF);
  for (let s = 0; s < n; s++) {
    const d = bfsDistances(g, s);
    const base = s * n;
    for (let t = 0; t < n; t++) dist[base + t] = d[t] >= 0 ? d[t] : INF;
  }
  for (let i = 0; i < n; i++) dist[i * n + i] = 0;

  let curMind = Math.min(mind, Math.floor(n / 2));

  // Incremental update: inserting edge (u,v) can only shorten distances.
  // new[i,j] = min(old[i,j], old[i,u]+1+old[v,j], old[i,v]+1+old[u,j])
  const updateAfterEdge = (u: number, v: number): void => {
    for (let i = 0; i < n; i++) {
      const rowI = i * n;
      const diu = dist[rowI + u];
      const div = dist[rowI + v];
      const throughU = diu + 1;
      const throughV = div + 1;
      const rowV = v * n;
      const rowU = u * n;
      for (let j = 0; j < n; j++) {
        const cur = dist[rowI + j];
        const a = throughU + dist[rowV + j];
        if (a < cur) {
          dist[rowI + j] = a;
          continue;
        }
        const b = throughV + dist[rowU + j];
        if (b < cur) dist[rowI + j] = b;
      }
    }
  };

  const findPair = (): [number, number] | null => {
    // best key = (neMax, neMin, -ecc, -perim, va, vb); smaller wins lexicographically
    let best: number[] | null = null;
    let bestVa = -1;
    let bestVb = -1;
    for (let va = 0; va < n; va++) {
      const vaNe = g.degree(va);
      if (vaNe >= k) continue;
      const rowVa = va * n;
      // eccentricity over finite entries
      let ecc = 0;
      for (let t = 0; t < n; t++) {
        const d = dist[rowVa + t];
        if (d < INF && d > ecc) ecc = d;
      }
      if (ecc < curMind) continue;
      for (let vb = va + 1; vb < n; vb++) {
        if (dist[rowVa + vb] !== ecc) continue; // only the farthest set
        const vbNe = g.degree(vb);
        if (vbNe >= k) continue;
        if (g.hasEdge(va, vb)) continue;
        const neMin = vaNe < vbNe ? vaNe : vbNe;
        const neMax = vaNe < vbNe ? vbNe : vaNe;
        const perim = Math.min(
          Math.abs(va - vb),
          Math.abs(va - vb - n),
          Math.abs(vb - va - n),
        );
        const key = [neMax, neMin, -ecc, -perim, va, vb];
        if (best === null || lexLess(key, best)) {
          best = key;
          bestVa = va;
          bestVb = vb;
        }
      }
    }
    if (best === null) return null;
    return [bestVa, bestVb];
  };

  for (;;) {
    const pair = findPair();
    if (pair === null) {
      // Floor demotion at 3: below that the target is smaller than any cycle, so
      // relaxing it buys nothing (mirrors the Python reference).
      if (demote && curMind > 3) {
        curMind -= 1;
        continue;
      }
      break;
    }
    const [u, v] = pair;
    g.addEdge(u, v);
    updateAfterEdge(u, v);
  }

  if (repair) repairDegrees(g, k, 3);

  return { graph: g, finalMind: curMind };
}

/** Lexicographic comparison of equal-length numeric tuples: a < b ? */
function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

/**
 * Greedily connect lowest-degree vertices at least `minDist` apart to close degree gaps.
 * Deterministic; mirrors Python `_repair_degrees` including its stable ordering and
 * first-max selection.
 *
 * EXPORTED public API, and it was the one generator with neither an argument guard nor a work
 * budget: `repairDegrees(ring(400), 1e9)` ran to completion while `ringGreedy` refuses the
 * identical (n, k), and `NaN`/`Infinity` were accepted silently, making `degree(v) < k` false
 * everywhere — a no-op reported as success.
 */

export function repairDegrees(g: Graph, k: number, minDist = 3): void {
  if (!Number.isInteger(k) || k < 0) {
    throw new Error(`buddy count ${k} must be a non-negative integer`);
  }
  if (!Number.isInteger(minDist) || minDist < 0) {
    // Same silent-no-op class as `k` and `mind`: `distv[v] < minDist` is false for every NaN,
    // so a NaN floor disables the separation constraint and builds a DIFFERENT graph rather
    // than ignoring an option.
    throw new Error(`minimum separation ${minDist} must be a non-negative integer`);
  }
  // Priced on what repair ACTUALLY spends, computed in O(n) before the loop. The previous two
  // attempts both reused `greedyWork`, which is built from EDGES ADDED — a quantity unrelated to
  // this function's cost. Repair's real work is (passes) x (under-degree vertices scanned) x one
  // full `bfsDistances` sweep each, and a pass ends as soon as one vertex succeeds, so a roster
  // that adds few edges can still scan many vertices many times. Scaling a wrong model by 4 made
  // it wrong by a different factor; these two quantities bound the real thing:
  //   underCount — vertices below k, i.e. the most any single pass can scan
  //   addable    — total degree deficit / 2, i.e. the most passes that can make progress
  const degrees = g.degrees();
  let deficit = 0;
  for (let v = 0; v < g.n; v++) if (degrees[v] < k) deficit += k - degrees[v];
  // Repair's OWN budget, in repair's own units — see MAX_REPAIR_WORK. Two earlier attempts
  // expressed this in ringGreedy's units (reusing `greedyWork`, then scaling it by 4) and both
  // failed, because `greedyWork` is built from edges ADDED while repair's cost is driven by the
  // degree DEFICIT. The intermediate version over-charged so badly it refused an edgeless n=1200
  // repair costing ~35 ms — refusing working configurations is the other half of the failure this
  // module's header warns about, and the half nobody notices until they hit it.
  if (repairWork(g.n, k, deficit) > MAX_REPAIR_WORK) {
    throw new Error(
      `graph too large to repair in reasonable time (n=${g.n}, k=${k}) — reduce the roster or the buddy count`,
    );
  }
  let changed = true;
  while (changed) {
    changed = false;
    // under-degree vertices, ascending vertex order, stable-sorted by degree
    const under: number[] = [];
    for (let v = 0; v < g.n; v++) if (g.degree(v) < k) under.push(v);
    if (under.length < 2) break;
    under.sort((x, y) => g.degree(x) - g.degree(y)); // stable in ES2019+

    for (const va of under) {
      if (g.degree(va) >= k) continue;
      const distv = bfsDistances(g, va);
      // candidates in `under` order (degree-sorted, stable ascending v)
      let vb = -1;
      let bestDist = -1;
      for (const v of under) {
        if (v === va) continue;
        if (g.degree(v) >= k) continue;
        if (g.hasEdge(va, v)) continue;
        if (distv[v] < minDist) continue;
        if (distv[v] > bestDist) {
          bestDist = distv[v]; // first-max: strict > keeps the first
          vb = v;
        }
      }
      if (vb !== -1) {
        g.addEdge(va, vb);
        changed = true;
        break;
      }
    }
  }
}
