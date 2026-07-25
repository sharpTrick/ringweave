/**
 * What the graph is currently emphasising, and the CSS classes that follow from it.
 *
 * Pulled out of `GraphCanvas` because M2's scheme could not express F10. That
 * scheme had one `focus` index and derived an edge's class from whether either
 * endpoint was a highlighted NODE — which structurally cannot distinguish "the
 * chain edge between two people on the route" from "any edge that happens to
 * touch one of them". A route needs the first and only the first.
 *
 * Being pure also makes the M2 behaviour testable as a table, which is what keeps
 * this refactor honest: with no route active, every class string must be exactly
 * what M2 produced.
 */
import { neighborhood } from "../neighborhood";

export type Highlight =
  | { kind: "none" }
  | { kind: "neighborhood"; focus: number; first: Set<number>; second: Set<number> }
  | { kind: "route"; path: number[]; nodes: Set<number> };

const NO_HIGHLIGHT: Highlight = { kind: "none" };

/**
 * Resolve the current emphasis.
 *
 * An active route beats hover. Otherwise hovering a name to read it would destroy
 * the route the user just asked for — the single most annoying way this feature
 * could fail. Within neighbourhood mode hover still beats selection, exactly as
 * M2 behaved.
 */
export function buildHighlight(
  adjacency: number[][],
  selected: number | null,
  hovered: number | null,
  route: number[] | null,
): Highlight {
  if (route !== null && route.length > 0) {
    return { kind: "route", path: route, nodes: new Set(route) };
  }
  const focus = hovered ?? selected;
  if (focus == null) return NO_HIGHLIGHT;
  return { kind: "neighborhood", focus, ...neighborhood(adjacency, focus) };
}

export function nodeClass(h: Highlight, i: number): string {
  switch (h.kind) {
    case "none":
      return "node";
    case "neighborhood":
      if (i === h.focus) return "node sel";
      if (h.first.has(i)) return "node hi";
      if (h.second.has(i)) return "node hi2";
      return "node faded";
    case "route":
      if (i === h.path[0] || i === h.path[h.path.length - 1]) return "node endpoint";
      return h.nodes.has(i) ? "node route" : "node faded";
  }
}

export function edgeClass(h: Highlight, u: number, v: number): string {
  switch (h.kind) {
    case "none":
      return "edge";
    case "neighborhood":
      if (u === h.focus || v === h.focus) return "edge lit";
      if (h.second.has(u) || h.second.has(v)) return "edge lit2";
      return "edge dim";
    case "route":
      // Node membership is enough, and provably so. On a shortest path
      // dist(path[i]) === i, and adjacency implies |dist(u) − dist(v)| <= 1, so
      // two path members that are adjacent must be consecutive on the path. An
      // explicit edge-key set would carry the same information and one more thing
      // to keep canonical.
      return h.nodes.has(u) && h.nodes.has(v) ? "edge route" : "edge dim";
  }
}
