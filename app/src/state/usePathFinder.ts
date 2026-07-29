import { useCallback, useMemo, useState } from "react";
import { shortestPath, type Graph } from "ringweave";

/**
 * A MODE, not a two-click gesture: while a source is set, every person the user picks becomes the
 * target and the chain redraws. The graph's own rendering stays modal for as long as a route is
 * lit, so selection is modal too; leaving is explicit, by clearing or by pressing the toggle again.
 *
 * The route is CANONICALISED on the lower index: `shortestPath` is greedy from its source, so
 * s→t and t→s can be different (both shortest) paths, and picking Ana-then-Ben must draw the same
 * line as Ben-then-Ana. The RESULT is then oriented back to the source, or the chain renders from
 * the end opposite the "Starting from Ana" sentence beside it.
 */
export function usePathFinder(graph: Graph) {
  const [source, setSource] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);

  const resolved = useMemo(() => {
    const none = { route: null as number[] | null, unreachable: false };
    if (source === null || target === null) return none;
    if (source >= graph.n || target >= graph.n) return none;
    const [s, t] = source <= target ? [source, target] : [target, source];
    const path = shortestPath(graph, s, t);
    const oriented = path !== null && path[0] !== source ? [...path].reverse() : path;
    return { route: oriented, unreachable: path === null };
  }, [source, target, graph]);

  const clear = useCallback(() => {
    setSource(null);
    setTarget(null);
  }, []);

  /** Arm the mode from `i`, or leave it when `i` is already the source. */
  const toggle = useCallback((i: number) => {
    setSource((prev) => (prev === i ? null : i));
    setTarget(null);
  }, []);

  /**
   * Offer `i` as the target. Returns whether the pick was consumed, which is what stops the same
   * click from also navigating the explorer.
   */
  const retarget = useCallback(
    (i: number): boolean => {
      if (source === null) return false;
      setTarget(i === source ? null : i);
      return true;
    },
    [source],
  );

  return useMemo(
    () => ({
      source,
      target,
      route: resolved.route,
      unreachable: resolved.unreachable,
      active: source !== null,
      /** The source while no target is chosen yet — what "now pick the other person" is about. */
      pending: target === null ? source : null,
      toggle,
      retarget,
      clear,
    }),
    [source, target, resolved, toggle, retarget, clear],
  );
}
