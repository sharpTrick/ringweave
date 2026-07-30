/**
 * A dismissable transient toast.
 *
 * The `role="status"` region stays mounted with no message, so a later message is announced as a
 * content change; a region remounted together with its text is not reliably announced.
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
