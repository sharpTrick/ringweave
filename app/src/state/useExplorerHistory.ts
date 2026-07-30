import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Every explorer click pushes an entry, so an unbounded stack grows for the whole session. */
const MAX_HISTORY = 50;

/**
 * Selection with a back stack. Going back from the FIRST selection is not offered, so "Back" can
 * never land on nothing; clearing the selection is what empties the stack.
 *
 * `isRelated(from, to)` decides whether a selection CONTINUES the trail or starts a new one. A
 * person reached from the card in front of you is a step; anyone else — found by search, tapped in
 * the graph, picked from the buddy list — is a jump, and Back after a jump offers to return to a
 * card the new one has no connection to. The test lives in the hook rather than at the call sites
 * so that a new way to select a person cannot forget it.
 */
export function useExplorerHistory(isRelated: (from: number, to: number) => boolean) {
  const [stack, setStack] = useState<number[]>([]);
  // Refreshed every render, because the predicate closes over the current view and the state
  // updater below would otherwise capture a stale one.
  const latestIsRelated = useRef(isRelated);
  useEffect(() => {
    latestIsRelated.current = isRelated;
  });

  const select = useCallback((i: number | null) => {
    setStack((prev) => {
      if (i === null) return prev.length === 0 ? prev : [];
      const top = prev.length > 0 ? prev[prev.length - 1] : null;
      // Re-selecting the person already shown is not a step: pushing it makes "Back" do nothing.
      if (top === i) return prev;
      if (top !== null && !latestIsRelated.current(top, i)) return [i];
      const next = [...prev, i];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
  }, []);

  const back = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const reset = useCallback(() => setStack((prev) => (prev.length === 0 ? prev : [])), []);

  return useMemo(
    () => ({
      current: stack.length > 0 ? stack[stack.length - 1] : null,
      canGoBack: stack.length > 1,
      select,
      back,
      reset,
    }),
    [stack, select, back, reset],
  );
}
