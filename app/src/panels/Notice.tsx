/**
 * A dismissable transient toast (import errors, gate refusals). It also auto-clears — see
 * `useNotice`.
 *
 * Two a11y constraints shape this markup, both surfaced by the hygiene linter:
 * - The dismiss affordance is a real `<button>`, not a click handler on a `<div>`, so it is
 *   reachable and operable without a mouse. "Everything works from the panels; keyboard-navigable"
 *   is non-negotiable (see app/CLAUDE.md), and a mouse-only dismiss broke it.
 * - The `role="status"` region stays mounted even with no message, so assistive tech announces a
 *   *content change* in a region it is already watching. Unmounting the region and remounting it
 *   with text is announced far less reliably.
 */
export default function Notice({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  return (
    <div role="status" className="toast-region">
      {message ? (
        <button type="button" className="toast" onClick={onDismiss}>
          {message}
        </button>
      ) : null}
    </div>
  );
}
