import { useEffect, useRef } from "react";

/**
 * A single global Escape handler (F10 requires one; the app had none).
 *
 * Two things make this less trivial than it looks.
 *
 * **It must not fire behind a modal.** `RosterModal` has no Escape handling of
 * its own, so an unguarded global listener would clear the path or selection
 * *underneath* an open dialog while the dialog itself ignored the key — the user
 * sees nothing happen, and then finds their route gone. `enabled` is how the
 * caller says "a dialog owns the keyboard right now".
 *
 * **It must not steal Escape from a control that has its own.** The search box
 * calls `stopPropagation`, which works because this listens in the bubble phase
 * on `document` rather than capturing.
 *
 * The handler is held in a ref so a caller can pass an inline closure without
 * re-registering the listener on every render.
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
