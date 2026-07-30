/**
 * Ring-greedy generation with an incrementally maintained all-pairs distance matrix.
 * RNG-free, so the edge set is byte-identical to the Python reference
 * `gen_c_cached.ring_greedy_cached` — change reference-python/ first.
 *
 * Algorithm: Patrick Sharp; incremental-distance caching with Claude (Anthropic), 2026.
 * See CONCEPT_LINEAGE.
 */
import { Graph, ring } from "./graph.js";
import {
  DEFAULT_MIN_SEPARATION, MAX_GREEDY_WORK, MAX_REPAIR_WORK, greedyWork,
} from "./budgets.js";
import { bfsDistances } from "./metrics.js";

// MEMORY bound on ringGreedy's n×n distance matrix (~100 MB here), far tighter than
// MAX_ROSTER, which bounds only the O(n) structures.
export const MAX_CACHED_N = 5000;

export interface GreedyResult {
  graph: Graph;
  /** The mind (min-separation) target actually achieved after any demotion. */
  finalMind: number;
}

export interface GreedyOptions {
  /**
   * Minimum degrees of separation to aim for. Default 5, clamped to floor(n/2).
   * The same concept the constrained path spells `minSeparation` — an alias, not another knob.
   */
  mind?: number;
  /** When no pair is `mind` apart, shrink the target by 1 and retry rather than stop. Default true. */
  demote?: boolean;
  /** Run `repairDegrees` after completion to close degree gaps. Default false. */
  repair?: boolean;
}

/**
 * Build a ~k-regular graph on `n` people: a ring seed, then greedily join the pair that is
 * LEAST CONNECTED first and only then farthest apart — degree outranks distance, which is the
 * order `reference-python/generators.py` states and `lexLess` implements.
 *
 * THROWS rather than refuses (it has no report channel): on `k < 2`, on a malformed `k`/`mind`,
 * and past `MAX_CACHED_N` or `MAX_GREEDY_WORK`.
 */
export function ringGreedy(
  n: number,
  k: number,
  opts: GreedyOptions = {},
): GreedyResult {
  // `deg >= NaN` is always false, so an unchecked `k` silently disables findPair's degree cap.
  if (!Number.isInteger(k) || k < 0) {
    throw new Error(`buddy count ${k} must be a non-negative integer`);
  }
  // Likewise `ecc < curMind`: a NaN target builds a DIFFERENT graph rather than ignoring an
  // option, and still propagates out as `finalMinSeparation`.
  const requestedMind = opts.mind ?? DEFAULT_MIN_SEPARATION;
  if (!Number.isInteger(requestedMind) || requestedMind < 0) {
    throw new Error(`minimum separation ${requestedMind} must be a non-negative integer`);
  }
  if (k < 2) {
    throw new Error(
      `ringGreedy needs k >= 2 (its ring seed floors degree at 2); for k < 2 use buildConstrainedBuddyGraph`,
    );
  }
  // Both size guards are conditioned on `Number.isInteger(n)` so that a malformed n falls
  // through to ring() → the Graph ctor for the canonical "must be an integer" message.
  if (Number.isInteger(n) && n > MAX_CACHED_N) {
    throw new Error(
      `ringGreedy supports up to ${MAX_CACHED_N} people (its distance cache is O(n²)); got ${n}`,
    );
  }
  // MAX_CACHED_N bounds MEMORY; this is the TIME bound it does not provide. Each path needs both.
  if (Number.isInteger(n) && Number.isInteger(k) && greedyWork(n, k) > MAX_GREEDY_WORK) {
    throw new Error(
      `roster size ${n} with ${k} buddies each is too large to generate in reasonable time — reduce the roster size or the buddy count`,
    );
  }
  const mind = requestedMind;
  const demote = opts.demote ?? true;
  const repair = opts.repair ?? false;

  const g = ring(n);
  const INF = n + 5;

  const dist = new Int32Array(n * n).fill(INF);
  for (let s = 0; s < n; s++) {
    const d = bfsDistances(g, s);
    const base = s * n;
    for (let t = 0; t < n; t++) dist[base + t] = d[t] >= 0 ? d[t] : INF;
  }

  let curMind = Math.min(mind, Math.floor(n / 2));

  // Inserting (u,v) can only shorten distances, so the cache is repaired rather than rebuilt:
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
    let best: number[] | null = null;
    let bestVa = -1;
    let bestVb = -1;
    for (let va = 0; va < n; va++) {
      const vaNe = g.degree(va);
      if (vaNe >= k) continue;
      const rowVa = va * n;
      let ecc = 0;
      for (let t = 0; t < n; t++) {
        const d = dist[rowVa + t];
        if (d < INF && d > ecc) ecc = d;
      }
      if (ecc < curMind) continue;
      for (let vb = va + 1; vb < n; vb++) {
        if (dist[rowVa + vb] !== ecc) continue;
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
      // Demotion floors at 3: below that the target is smaller than any cycle, so relaxing it
      // buys nothing (mirrors the Python reference).
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

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

/**
 * Greedily connect lowest-degree vertices at least `minDist` apart to close degree gaps.
 * RNG-free; mirrors Python `_repair_degrees` including its stable ordering and first-max
 * selection. Throws once the work counter below passes `MAX_REPAIR_WORK`.
 */

export function repairDegrees(g: Graph, k: number, minDist = 3): void {
  if (!Number.isInteger(k) || k < 0) {
    throw new Error(`buddy count ${k} must be a non-negative integer`);
  }
  if (!Number.isInteger(minDist) || minDist < 0) {
    // `distv[v] < minDist` is false for every NaN, so a NaN floor drops the separation
    // constraint and builds a DIFFERENT graph rather than ignoring an option.
    throw new Error(`minimum separation ${minDist} must be a non-negative integer`);
  }
  // COUNTED, NOT PREDICTED: repair's cost depends on graph STRUCTURE, and four successive
  // (n, k, deficit) models were each wrong in a different direction. All THREE cost centres are
  // charged — sweeps, per-pass rebuild+sort, per-sweep candidate scan — each exposed by a graph
  // shape the other two could not see.
  let work = 0;

  let changed = true;
  while (changed) {
    changed = false;
    const under: number[] = [];
    for (let v = 0; v < g.n; v++) if (g.degree(v) < k) under.push(v);
    if (under.length < 2) break;
    // Stable (ES2019+): Python parity depends on ties keeping ascending vertex order.
    under.sort((x, y) => g.degree(x) - g.degree(y));
    // Per pass, not hoisted: a pass ends the moment it adds an edge, so `m` is constant WITHIN a
    // pass and grows between them.
    const sweepCost = g.n + 2 * g.numEdges();
    work += g.n + under.length * Math.log2(Math.max(2, under.length));
    if (work > MAX_REPAIR_WORK) {
      throw new Error(
        `graph too large to repair in reasonable time (n=${g.n}, k=${k}) — reduce the roster or the buddy count`,
      );
    }

    for (const va of under) {
      if (g.degree(va) >= k) continue;
      work += sweepCost + under.length;
      if (work > MAX_REPAIR_WORK) {
        throw new Error(
          `graph too large to repair in reasonable time (n=${g.n}, k=${k}) — reduce the roster or the buddy count`,
        );
      }
      const distv = bfsDistances(g, va);
      let vb = -1;
      let bestDist = -1;
      for (const v of under) {
        if (v === va) continue;
        if (g.degree(v) >= k) continue;
        if (g.hasEdge(va, v)) continue;
        if (distv[v] < minDist) continue;
        if (distv[v] > bestDist) {
          bestDist = distv[v]; // strict `>` keeps the first max, as Python does
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
