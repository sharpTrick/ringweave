import { useCallback, useMemo, useState } from "react";
import { shortestPath, type Graph } from "ringweave";

/**
 * F10's path finder: pick two people, light the chain between them.
 *
 * The route is CANONICALISED on `min(from, to)`. `shortestPath` is greedy from
 * its source, so it returns the lexicographically smallest path read from that
 * end — which means s→t and t→s can be different (both shortest) paths. Picking
 * Ana then Ben and picking Ben then Ana are the same question, so they must draw
 * the same line; always running from the lower index guarantees that. (It does NOT
 * survive an export/import round trip, because a route is never exported — the file
 * carries the graph, and a re-selected route is recomputed from it.)
 *
 * The RESULT is then oriented to the person the user started from. Returning it in
 * canonical order meant that starting from the higher-indexed person rendered the chain
 * from the other end, contradicting the "Starting from Ana — now pick the other person"
 * sentence the same panel had just announced. A reversed shortest path is still the same
 * shortest path, so reversing the array costs nothing the canonicalisation was protecting.
 */
export function usePathFinder(graph: Graph) {
  const [from, setFrom] = useState<number | null>(null);
  const [ends, setEnds] = useState<[number, number] | null>(null);

  const resolved = useMemo(() => {
    if (ends === null) return { route: null as number[] | null, unreachable: false };
    const [a, b] = ends;
    if (a >= graph.n || b >= graph.n) return { route: null, unreachable: false };
    const [s, t] = a <= b ? [a, b] : [b, a];
    const path = shortestPath(graph, s, t);
    // `ends[0]` is the person the user picked FIRST, whichever index they happen to have.
    const oriented = path !== null && path[0] !== a ? [...path].reverse() : path;
    return { route: oriented, unreachable: path === null };
  }, [ends, graph]);

  /** Begin a route from `i`, discarding any route already drawn. */
  const start = useCallback((i: number) => {
    setEnds(null);
    setFrom(i);
  }, []);

  /**
   * Offer `i` as the second person. Returns whether it was consumed, so the
   * caller knows whether the click was a route pick or an ordinary selection.
   */
  const complete = useCallback(
    (i: number): boolean => {
      if (from === null || i === from) return false;
      setEnds([from, i]);
      setFrom(null);
      return true;
    },
    [from],
  );

  const clear = useCallback(() => {
    setFrom(null);
    setEnds(null);
  }, []);

  return useMemo(
    () => ({
      from,
      route: resolved.route,
      unreachable: resolved.unreachable,
      /** Anything to clear: a pending pick or a drawn route. */
      active: from !== null || ends !== null,
      ends,
      start,
      complete,
      clear,
    }),
    [from, ends, resolved, start, complete, clear],
  );
}
