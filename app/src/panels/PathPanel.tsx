import type { GraphView } from "../model";

interface Props {
  view: GraphView;
  /** The person a route is being drawn from, while waiting for the second pick. */
  from: number | null;
  route: number[] | null;
  unreachable: boolean;
  onSelect: (index: number) => void;
  onClear: () => void;
}

/**
 * F10's route readout.
 *
 * The chain is rendered as TEXT as well as drawn on the graph, because the graph
 * is a view and never the only interface: "Ana → Ben → Chen" is the part that
 * works with a screen reader, in print, and when the canvas is off-screen on a
 * narrow window. Every name in it is a button, so a route is also a way to
 * navigate.
 */
export default function PathPanel({ view, from, route, unreachable, onSelect, onClear }: Props) {
  const name = (i: number) => view.names[i];

  return (
    <section id="route" className="glass" aria-label="Path between two people">
      <div className="rt-head">
        <span className="rt-lbl">Path</span>
        <button className="chipbtn" onClick={onClear}>Clear</button>
      </div>

      {/* ONE live region, mounted with the panel and filled conditionally. Three
          separate `aria-live` paragraphs that only appear WITH their text are never
          announced: a live region has to be in the accessibility tree before its
          content changes for the change to be a change. */}
      <p className="rt-body" aria-live="polite">
        {from !== null && (
          <>
            Starting from <strong>{name(from)}</strong> — now pick the other person.
          </>
        )}

        {unreachable && <>No chain — they're in separate groups.</>}

        {route !== null && (
          <>
            <span className="rt-chain">
              {route.map((i, at) => (
                <span key={i}>
                  {at > 0 && <span className="rt-arrow" aria-hidden="true"> → </span>}
                  <button className="personchip" onClick={() => onSelect(i)}>{name(i)}</button>
                </span>
              ))}
            </span>
            <span className="rt-steps">
              {route.length - 1} step{route.length - 1 === 1 ? "" : "s"}
            </span>
          </>
        )}
      </p>
    </section>
  );
}
