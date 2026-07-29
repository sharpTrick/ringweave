import { useEffect, useRef } from "react";

/**
 * A single global Escape handler.
 *
 * `enabled` is how a caller says a dialog owns the keyboard: `RosterModal` ignores Escape, so an
 * unguarded listener clears the route or selection underneath an open dialog.
 *
 * Bubble phase on `document`, not capture, so a control with its own Escape (the search box) can
 * stop propagation. The handler is held in a ref so an inline closure does not re-register it.
 */
export function useEscape(onEscape: () => void, enabled: boolean): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handler.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
