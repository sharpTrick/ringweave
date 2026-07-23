/**
 * Degree-preserving double edge swap, shared by the plain and constraint-aware
 * polish passes. Swapping (a-b, c-d) → (a-c, b-d) leaves every vertex degree
 * unchanged, so a regular graph stays regular.
 */
import { Graph } from "./graph.js";
import { RNG } from "./rng.js";

export interface Swap {
  a: number;
  b: number;
  c: number;
  d: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Pick two edges and one of the two rewirings. Returns null when the swap is
 * degenerate, would duplicate an existing edge, or is vetoed by `reject` (used
 * to enforce constraint guards without duplicating the proposal machinery).
 */
export function proposeSwap(
  g: Graph,
  edges: [number, number][],
  rng: RNG,
  reject?: (s: Swap) => boolean,
): Swap | null {
  const [i, j] = rng.twoDistinct(edges.length);
  const [a, b] = edges[i];
  const [c, d] = edges[j];
  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;
  if (rng.random() < 0.5) {
    x1 = a; y1 = c; x2 = b; y2 = d;
  } else {
    x1 = a; y1 = d; x2 = b; y2 = c;
  }

  if (new Set([a, b, c, d]).size < 4) return null;
  if (g.hasEdge(x1, y1) || g.hasEdge(x2, y2)) return null;

  const swap: Swap = { a, b, c, d, x1, y1, x2, y2 };
  if (reject && reject(swap)) return null;
  return swap;
}

export function applySwap(g: Graph, s: Swap): void {
  g.removeEdge(s.a, s.b);
  g.removeEdge(s.c, s.d);
  g.addEdge(s.x1, s.y1);
  g.addEdge(s.x2, s.y2);
}

export function revertSwap(g: Graph, s: Swap): void {
  g.removeEdge(s.x1, s.y1);
  g.removeEdge(s.x2, s.y2);
  g.addEdge(s.a, s.b);
  g.addEdge(s.c, s.d);
}
