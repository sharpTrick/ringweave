import { useCallback, useRef, useState } from "react";
import { clampText } from "../io/clamp";

/** The app's FLOOR for "long enough to read", not a detail of this hook — the buddy list's own
    confirmation shares it. */
export const AUTO_CLEAR_MS = 4000;

/**
 * A ceiling applied at the SINK, because import errors interpolate values straight out of a file.
 * Per-site truncation cannot be enforced mechanically; this bounds every producer, including ones
 * written later that forget to.
 */
const MAX_NOTICE_CHARS = 300;

const clampNotice = (message: string) => clampText(message, MAX_NOTICE_CHARS);

/**
 * Transient user notices. `flash` auto-clears after {@link AUTO_CLEAR_MS} and a newer message
 * wins; `show`/`clear` are for status-driven messages the caller manages.
 */
export function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => setNotice(null), []);
  const show = useCallback((message: string) => setNotice(clampNotice(message)), []);
  const flash = useCallback((message: string) => {
    const text = clampNotice(message);
    setNotice(text);
    if (timer.current) clearTimeout(timer.current);
    // Compares the CLAMPED text, which is what state holds: comparing the raw argument makes the
    // "newer message wins" guard never match, so a superseded timer clears a newer notice.
    timer.current = setTimeout(() => setNotice((n) => (n === text ? null : n)), AUTO_CLEAR_MS);
  }, []);

  return { notice, flash, show, clear };
}
