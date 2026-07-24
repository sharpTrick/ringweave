/** A dismissable transient toast (import errors, gate refusals). Click to dismiss. */
export default function Notice({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div role="status" className="toast" onClick={onDismiss}>
      {message}
    </div>
  );
}
