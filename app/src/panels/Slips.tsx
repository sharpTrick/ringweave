import { memo } from "react";
import { buddyLabel, type GraphView } from "../model";

/** F3: print-friendly buddy slips in their own DOM subtree (hidden on screen, shown
    for print via print.css) — one card per person, cut-apart friendly. */
/**
 * MEMOIZED, and the reason is measured rather than precautionary. `hovered` is App-level state
 * written on every mouse-enter/leave over the graph, and nothing below App was memoized — so a
 * hover transition re-rendered every panel, including the two that read neither `hovered` nor
 * `selected`. At the import ceiling (1000 people) that is ~46 ms here and ~70 ms in BuddyList per
 * transition, on top of the canvas's own 168 ms, for a state change neither of them consumes.
 *
 * `app/CLAUDE.md` recorded the hover cost as the highlight recompute; that is the SMALLEST of the
 * three terms — `neighborhood()` is bounded at ~144 set operations by the degree cap — and the
 * note is corrected there too.
 */
function SlipsInner({ view }: { view: GraphView }) {
  return (
    <div className="slips" aria-hidden="true">
      {view.names.map((name, i) => (
        <div className="slip" key={i}>
          <h3>{name}</h3>
          <div className="who">Your buddies:</div>
          <div className="buddies">{buddyLabel(view, i)}</div>
        </div>
      ))}
    </div>
  );
}

export default memo(SlipsInner);
