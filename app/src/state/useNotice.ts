import { useCallback, useRef, useState } from "react";
import { clampText } from "../io/clamp";

/**
 * How long a transient message stays up. Exported because it is the app's FLOOR for "long
 * enough to read", not a detail of this hook: the buddy list's "Copied" confirmation had its
 * own undocumented 1100 ms — a quarter of it, timed from AFTER an awaited clipboard write, with
 * no dismiss affordance — so the one piece of feedback that action produces was the one most
 * likely to be missed, and a screen reader could revert the region before announcing it.
 */
export const AUTO_CLEAR_MS = 4000;

/**
 * Hard ceiling on any notice, applied at the SINK.
 *
 * Notices are rendered as the sole text child of the toast, so an unbounded message is an
 * unbounded DOM text node — and the messages that carry untrusted content are exactly the
 * import errors, which interpolate values straight out of the file. `importGraph` truncates
 * at each interpolation, which is where a readable message comes from; this bounds EVERY
 * producer, including ones written later that forget to.
 *
 * Two layers on purpose: per-site truncation cannot be enforced mechanically, one clamp here
 * can.
 */
const MAX_NOTICE_CHARS = 300;

/** Bound and keep it readable: a hard slice mid-word beats a multi-megabyte text node. */
const clampNotice = (message: string) => clampText(message, MAX_NOTICE_CHARS);

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
  const show = useCallback((message: string) => setNotice(clampNotice(message)), []);
  const flash = useCallback((message: string) => {
    const text = clampNotice(message);
    setNotice(text);
    if (timer.current) clearTimeout(timer.current);
    // Compares the CLAMPED text, because that is what state holds — comparing the raw
    // argument would make the "a newer message wins" guard never match, so a superseded
    // timer would clear a newer notice.
    timer.current = setTimeout(() => setNotice((n) => (n === text ? null : n)), AUTO_CLEAR_MS);
  }, []);

  return { notice, flash, show, clear };
}
