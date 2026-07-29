import { neighborhood } from "../neighborhood";

export type Highlight =
  | { kind: "none" }
  | { kind: "neighborhood"; focus: number; first: Set<number>; second: Set<number> }
  | { kind: "route"; path: number[]; nodes: Set<number> };

const NO_HIGHLIGHT: Highlight = { kind: "none" };

/** An active route beats hover, or hovering a name to read it destroys the route just drawn. */
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
      // Node membership is enough: on a shortest path dist(path[i]) === i and adjacency implies
      // |dist(u) − dist(v)| <= 1, so two adjacent path members are consecutive on it.
      return h.nodes.has(u) && h.nodes.has(v) ? "edge route" : "edge dim";
  }
}
