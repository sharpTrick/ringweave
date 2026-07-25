import { useMemo } from "react";
import { eccentricity, type Graph } from "ringweave";
import { neighborhood } from "../neighborhood";
import type { GraphView } from "../model";

interface Props {
  view: GraphView;
  graph: Graph;
  /** Who is being explored. Selection only — never hover; see the note below. */
  index: number;
  canGoBack: boolean;
  onSelect: (index: number) => void;
  onBack: () => void;
  onClose: () => void;
  onFindPath: () => void;
}

/** Cap on second-degree chips before collapsing to a count. */
const SECOND_LIMIT = 24;

/**
 * F8's node explorer: who this person's buddies are, who is two steps away, and
 * how far the furthest person is.
 *
 * Rendered from SELECTION ONLY, never from hover. The graph canvas deliberately
 * uses `hovered ?? selected` for its highlight, but a card that re-renders on
 * mouse-move would make its own back stack meaningless — every name you moved the
 * pointer across would look like somewhere you had been.
 *
 * Every name here is a real `<button>` that navigates, which is F8's acceptance
 * criterion and also the reason the whole feature is reachable without a mouse.
 */
export default function PersonPanel({
  view, graph, index, canGoBack, onSelect, onBack, onClose, onFindPath,
}: Props) {
  const { first, second } = useMemo(
    () => neighborhood(view.buddies, index),
    [view.buddies, index],
  );
  // O(n + m), and only on a selection change — not on hover.
  const reach = useMemo(() => eccentricity(graph, index), [graph, index]);

  const sorted = (set: Set<number>) => Array.from(set).sort((a, b) => a - b);
  const secondAll = sorted(second);
  const secondShown = secondAll.slice(0, SECOND_LIMIT);

  const chip = (i: number) => (
    <button className="personchip" key={i} onClick={() => onSelect(i)}>
      {view.names[i]}
    </button>
  );

  return (
    <section id="person" className="glass" aria-label={`About ${view.names[index]}`}>
      <div className="pp-head">
        <h2>{view.names[index]}</h2>
        <div className="pp-acts">
          {canGoBack && <button className="chipbtn" onClick={onBack}>← Back</button>}
          <button className="chipbtn" onClick={onClose} aria-label="Close person details">Close</button>
        </div>
      </div>

      <div className="pp-group">
        <div className="pp-lbl">Buddies</div>
        <div className="pp-chips">
          {first.size === 0 ? <span className="pp-none">No buddies yet</span> : sorted(first).map(chip)}
        </div>
      </div>

      <div className="pp-group">
        <div className="pp-lbl">Two steps away</div>
        <div className="pp-chips">
          {secondAll.length === 0 ? (
            <span className="pp-none">Nobody</span>
          ) : (
            <>
              {secondShown.map(chip)}
              {secondAll.length > secondShown.length && (
                <span className="pp-none">+{secondAll.length - secondShown.length} more</span>
              )}
            </>
          )}
        </div>
      </div>

      <div className="pp-group">
        <button className="chipbtn" onClick={onFindPath}>Find a path from here</button>
      </div>

      <p className="pp-reach">
        {Number.isFinite(reach)
          ? `Everyone is within ${reach} step${reach === 1 ? "" : "s"} of ${view.names[index]}.`
          : `Some people can't be reached from ${view.names[index]} at all — the group is split.`}
      </p>
    </section>
  );
}
