import { useMemo } from "react";
import { Graph } from "ringweave";

/**
 * The core `Graph` for the current view. Keyed on the `edges` array IDENTITY, which `useBuddyGraph`
 * preserves across an identical regeneration precisely so this does not rebuild — building one per
 * render is O(m) on every mouse-move.
 */
export function useGraph(n: number, edges: [number, number][]): Graph {
  return useMemo(() => {
    const g = new Graph(n);
    for (const [a, b] of edges) g.addEdge(a, b);
    return g;
  }, [n, edges]);
}
