import type { GraphView } from "../model";

interface Props {
  view: GraphView;
  from: number | null;
  route: number[] | null;
  unreachable: boolean;
  onSelect: (index: number) => void;
  onClear: () => void;
}

export default function PathPanel({ view, from, route, unreachable, onSelect, onClear }: Props) {
  const name = (i: number) => view.names[i];

  return (
    <section id="route" className="glass" aria-label="Path between two people">
      <div className="rt-head">
        <span className="rt-lbl">Path</span>
        <button className="chipbtn" onClick={onClear}>Clear</button>
      </div>

      {/* NOT a live region: this panel is mounted by the same action that writes its first
          sentence, so an `aria-live` here would never be announced. The spoken version is
          `pathStatusText`, in a region App keeps mounted for the life of the view. */}
      <p className="rt-body">
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
