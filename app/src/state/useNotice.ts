import { useCallback, useRef, useState } from "react";
import { clampText } from "../io/clamp";

/** The app's FLOOR for "long enough to read", not a detail of this hook — the buddy list's own
    confirmation shares it. */
export const AUTO_CLEAR_MS = 4000;

/**
 * Roughly 17 characters a second, an unhurried reading pace. The floor above was chosen for the
 * short producers ("That's already an optimal arrangement…"), and the same channel carries import
 * errors that interpolate a file's own message up to {@link MAX_NOTICE_CHARS} — at which length a
 * fixed 4 s removes the toast, and with it the only copy of the message, before it can be read.
 */
const READING_MS_PER_CHAR = 60;

const readingTime = (text: string) => Math.max(AUTO_CLEAR_MS, text.length * READING_MS_PER_CHAR);

/**
 * A ceiling applied at the SINK, because import errors interpolate values straight out of a file.
 * Per-site truncation cannot be enforced mechanically; this bounds every producer, including ones
 * written later that forget to.
 */
const MAX_NOTICE_CHARS = 300;

const clampNotice = (message: string) => clampText(message, MAX_NOTICE_CHARS);

/**
 * Transient user notices. `flash` auto-clears after at least {@link AUTO_CLEAR_MS}, longer for a
 * longer message, and a newer message wins; `show`/`clear` are for status-driven messages the
 * caller manages.
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
    timer.current = setTimeout(() => setNotice((n) => (n === text ? null : n)), readingTime(text));
  }, []);

  return { notice, flash, show, clear };
}
