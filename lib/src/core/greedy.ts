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
  const mind = opts.mind ?? 5;
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
 * Greedily connect lowest-degree vertices at least `minDist` apart to close
 * degree gaps. Deterministic; mirrors Python `_repair_degrees` including its
 * stable ordering and first-max selection.
 */
export function repairDegrees(g: Graph, k: number, minDist = 3): void {
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
