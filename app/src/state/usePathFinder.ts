import { useCallback, useMemo, useState } from "react";
import { shortestPath, type Graph } from "ringweave";

/**
 * The route is CANONICALISED on the lower index: `shortestPath` is greedy from its source, so
 * s→t and t→s can be different (both shortest) paths, and picking Ana-then-Ben must draw the same
 * line as Ben-then-Ana. The RESULT is then oriented back to whoever the user started from, or the
 * chain renders from the end opposite the "Starting from Ana" sentence beside it.
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
    // `ends[0]` is the person picked FIRST, whichever index they happen to have.
    const oriented = path !== null && path[0] !== a ? [...path].reverse() : path;
    return { route: oriented, unreachable: path === null };
  }, [ends, graph]);

  /** Begin a route from `i`, discarding any route already drawn. */
  const start = useCallback((i: number) => {
    setEnds(null);
    setFrom(i);
  }, []);

  /** Offer `i` as the second person. Returns whether the click was consumed as a route pick. */
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
