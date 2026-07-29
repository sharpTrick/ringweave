import { useCallback, useMemo, useState } from "react";

/** Every explorer click pushes an entry, so an unbounded stack grows for the whole session. */
const MAX_HISTORY = 50;

/**
 * Selection with a back stack. Going back from the FIRST selection is not offered, so "Back" can
 * never land on nothing; clearing the selection is what empties the stack.
 */
export function useExplorerHistory() {
  const [stack, setStack] = useState<number[]>([]);

  const select = useCallback((i: number | null) => {
    setStack((prev) => {
      if (i === null) return prev.length === 0 ? prev : [];
      // Re-selecting the person already shown is not a step: pushing it makes "Back" do nothing.
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
