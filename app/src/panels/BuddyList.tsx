import { memo, useEffect, useRef, useState } from "react";
import { buddyLabel, type GraphView } from "../model";
import { copyText, downloadBlob, neutralizeCell, toCsv } from "../io/download";
import { AUTO_CLEAR_MS } from "../state/useNotice";

interface Props {
  view: GraphView;
  selected: number | null;
  onSelect: (i: number) => void;
}

const COPIED_MESSAGE = "Buddy list copied to the clipboard.";

/** Names the way out, because the failed button gives none. */
const COPY_FAILED_MESSAGE = "Couldn't copy to the clipboard — use CSV instead.";

/**
 * Memoized: a hover rewrites App state this component does not read. The memo holds only while
 * `onSelect` is stable, which is why App's `setSelected` is a `useCallback`.
 */
function BuddyListInner({ view, selected, onSelect }: Props) {
  const [copied, setCopied] = useState(false);
  const [announced, setAnnounced] = useState("");
  // A newer press wins: unless the pending timers are cleared, an earlier press's timer clears a
  // later press's confirmation. Cleared on unmount too, so a resolved clipboard write cannot set
  // state on a gone component.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const copyAll = async () => {
    // Each line starts with a name, and a name pasted into a spreadsheet cell is a live formula
    // (`=HYPERLINK(...)`), so it is neutralized exactly as toCsv neutralizes every cell.
    const text = view.names
      .map((name, i) => `${neutralizeCell(name)}: ${buddyLabel(view, i)}`)
      .join("\n");
    const ok = await copyText(text);
    if (!ok) {
      timers.current.forEach(clearTimeout);
      setCopied(false);
      setAnnounced("");
      timers.current = [
        setTimeout(() => setAnnounced(COPY_FAILED_MESSAGE), 0),
        setTimeout(() => setAnnounced(""), AUTO_CLEAR_MS),
      ];
      return;
    }
    if (ok) {
      setCopied(true);
      // Emptied, then refilled in a separate task: a live region announces a CHANGE, so a second
      // press that re-sets the identical string mutates nothing and is silent.
      timers.current.forEach(clearTimeout);
      setAnnounced("");
      timers.current = [
        setTimeout(() => setAnnounced(COPIED_MESSAGE), 0),
        setTimeout(() => {
          setCopied(false);
          setAnnounced("");
        }, AUTO_CLEAR_MS),
      ];
    }
  };

  const exportCsv = () => {
    const rows: string[][] = [["name", "buddies"]];
    view.names.forEach((name, i) => rows.push([name, buddyLabel(view, i, "; ")]));
    downloadBlob("buddies.csv", "text/csv", toCsv(rows));
  };

  return (
    <section id="buddies" className="glass" aria-label="Buddy list">
      <div className="bp-head">
        <h2>Buddy list</h2>
        <div className="bp-acts">
          <button className="chipbtn" onClick={copyAll}>{copied ? "Copied" : "Copy"}</button>
          {/* A label change on the focused button is not reliably announced, so the result goes
              through a region that is mounted always and filled conditionally. */}
          <span className="sr-live" role="status" aria-live="polite">{announced}</span>
          <button className="chipbtn" onClick={exportCsv}>CSV</button>
        </div>
      </div>
      <div className="bp-list">
        {view.names.map((name, i) => (
          <button
            key={i}
            className={"brow" + (selected === i ? " sel" : "")}
            // Selection is otherwise conveyed by colour alone (.brow.sel).
            aria-current={selected === i || undefined}
            onClick={() => onSelect(i)}
          >
            <span className="nm">{name}</span>
            <span className="bd">{buddyLabel(view, i)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default memo(BuddyListInner);
