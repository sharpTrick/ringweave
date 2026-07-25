import { useCallback, useMemo, useState } from "react";

/**
 * Cap on retained history. Every click through the explorer pushes an entry, so
 * without a bound a long browsing session grows the array forever. 50 is far more
 * back-steps than anyone retraces, and dropping the oldest is invisible.
 */
const MAX_HISTORY = 50;

/**
 * Selection with a back stack (F8).
 *
 * The explorer turns selection into navigation — every name in the panel is a
 * link to that person — so "back" has to mean something, and a plain `selected`
 * state cannot express it.
 *
 * Going back from the FIRST selection is not offered: the stack returns to
 * previous *people*, and emptying it is what clearing the selection does. That
 * keeps "Back" from ever landing on nothing.
 */
export function useExplorerHistory() {
  const [stack, setStack] = useState<number[]>([]);

  const select = useCallback((i: number | null) => {
    setStack((prev) => {
      if (i === null) return prev.length === 0 ? prev : [];
      // Re-selecting the person already shown is not a navigation step; pushing it
      // would make "Back" appear to do nothing.
      if (prev[prev.length - 1] === i) return prev;
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
