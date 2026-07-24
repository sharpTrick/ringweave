import { useCallback, useRef, useState } from "react";

const AUTO_CLEAR_MS = 4000;

/**
 * Transient user notices (import errors, gate refusals, worker errors). `flash` shows a
 * message and auto-clears it after a few seconds (a newer message wins — it won't be
 * clobbered by an older flash's timer); `show`/`clear` are for status-driven messages the
 * caller manages (e.g. clear on a new run). Extracted so a second message kind is additive.
 */
export function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => setNotice(null), []);
  const show = useCallback((message: string) => setNotice(message), []);
  const flash = useCallback((message: string) => {
    setNotice(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice((n) => (n === message ? null : n)), AUTO_CLEAR_MS);
  }, []);

  return { notice, flash, show, clear };
}
