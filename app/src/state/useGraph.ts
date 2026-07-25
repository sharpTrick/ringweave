import { useMemo } from "react";
import { Graph } from "ringweave";

/**
 * The core `Graph` for the current view, rebuilt only when the edge set changes.
 *
 * The single place the app rehydrates a Graph from a view. The explorer and the
 * path finder both need real graph queries (`eccentricity`, `shortestPath`) and
 * neither may reimplement them — so they need an actual `Graph`, and building one
 * per render would be O(m) work on every mouse-move.
 *
 * Keyed on the `edges` array IDENTITY, which the view model maintains
 * deliberately: `useBuddyGraph` reuses the previous array when a regeneration
 * produces the same graph, precisely so downstream memos and layouts do not
 * recompute.
 */
export function useGraph(n: number, edges: [number, number][]): Graph {
  return useMemo(() => {
    const g = new Graph(n);
    for (const [a, b] of edges) g.addEdge(a, b);
    return g;
  }, [n, edges]);
}
