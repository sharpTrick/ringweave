import { memo, useEffect, useRef, useState } from "react";
import { buddyLabel, type GraphView } from "../model";
import { copyText, downloadBlob, neutralizeCell, toCsv } from "../io/download";
import { AUTO_CLEAR_MS } from "../state/useNotice";

interface Props {
  view: GraphView;
  selected: number | null;
  onSelect: (i: number) => void;
}

/** F3: the always-available, non-graph interface — a Name → buddies table with copy
    and CSV export. Clicking a row selects that person in the graph. */
/** What a successful copy announces. One string, so the emptied/refilled pair cannot drift. */
const COPIED_MESSAGE = "Buddy list copied to the clipboard.";

/**
 * MEMOIZED for the same measured reason as `Slips`: a hover transition over the graph rewrote
 * App-level state this component does not read, and re-rendered all n rows — ~70 ms at the import
 * ceiling, per transition, per node crossed. The memo only pays if `onSelect` is stable, which is
 * why App's `setSelected` is a `useCallback`.
 */
function BuddyListInner({ view, selected, onSelect }: Props) {
  const [copied, setCopied] = useState(false);
  // The live region's text, held separately from `copied` so it can be emptied and refilled —
  // see copyAll. The button's own label still reads from `copied`.
  const [announced, setAnnounced] = useState("");
  // The confirmation's pending timers. A NEWER PRESS WINS: without this, each press scheduled its
  // own teardown and none cancelled the previous, so an earlier press's 4 s timer cleared a later
  // press's confirmation — press at 0 s and again at 3 s, and the label reverts at 4.2 s, 1.2 s
  // into a window that should have run to 7 s. `useNotice.flash` already implements exactly this
  // guard for the toast; these are the app's two auto-clearing confirmations and now both have it.
  // Clearing them on unmount also stops a resolved clipboard write from setting state on a
  // component that is gone.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const copyAll = async () => {
    // Each line starts with a name, so a hostile name (`=HYPERLINK(...)`) pasted into a
    // spreadsheet cell would be a live formula — neutralize the leading name the same way
    // toCsv neutralizes every cell, so both spreadsheet-bound sinks share one guard. The buddy
    // half reuses buddyLabel (the one projection) so the copy can't diverge from the on-screen
    // list on separator/empty glyph.
    const text = view.names
      .map((name, i) => `${neutralizeCell(name)}: ${buddyLabel(view, i)}`)
      .join("\n");
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      // EMPTIED, THEN REFILLED, in two commits. A live region announces a CHANGE, and pressing
      // Copy again inside the window below sets the identical string — no DOM mutation, so the
      // second press is silent, which is exactly the press a user makes when unsure the first
      // registered (the clipboard write is awaited and there is no other synchronous feedback).
      // The two setStates are in different tasks, so this is two commits and two mutations, not
      // one batch: a fix that cannot be observed to have happened is not a fix, and this one is
      // asserted by watching the region rather than by reading the final markup.
      timers.current.forEach(clearTimeout);
      setAnnounced("");
      timers.current = [
        setTimeout(() => setAnnounced(COPIED_MESSAGE), 0),
        // The app's shared floor, not a local literal — see AUTO_CLEAR_MS.
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
          {/* The label swap is the ONLY confirmation that the copy worked, and a label change on
              the focused control is not reliably announced. Every other transient feedback in the
              app has a live region; this one did not. Mounted always, filled conditionally. */}
          <span className="sr-live" role="status" aria-live="polite">{announced}</span>
          <button className="chipbtn" onClick={exportCsv}>CSV</button>
        </div>
      </div>
      <div className="bp-list">
        {view.names.map((name, i) => (
          <button
            key={i}
            className={"brow" + (selected === i ? " sel" : "")}
            // The row is visibly highlighted when selected (.brow.sel), and that state was
            // conveyed by colour alone — LayoutToggle already uses aria-pressed for the
            // identical "which of these is active" pattern.
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
