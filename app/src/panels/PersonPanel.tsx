import { useMemo } from "react";
import { eccentricity, type Graph } from "ringweave";
import { relatedChips } from "../neighborhood";
import type { GraphView } from "../model";

interface Props {
  view: GraphView;
  graph: Graph;
  /** PRECONDITION the caller owns, unchecked here: `0 <= index < view.names.length`. */
  index: number;
  canGoBack: boolean;
  onSelect: (index: number) => void;
  onBack: () => void;
  onClose: () => void;
  /** True while this person is the path source, which makes the path button a pressed toggle. */
  pathFrom: boolean;
  onFindPath: () => void;
}

/**
 * Rendered from SELECTION only, never hover: a card that re-rendered on mouse-move would make its
 * own back stack meaningless.
 */
export default function PersonPanel({
  view, graph, index, canGoBack, onSelect, onBack, onClose, pathFrom, onFindPath,
}: Props) {
  const { first, secondShown, secondHidden } = useMemo(
    () => relatedChips(view.buddies, index),
    [view.buddies, index],
  );
  const reach = useMemo(() => eccentricity(graph, index), [graph, index]);

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
          {first.length === 0 ? <span className="pp-none">No buddies yet</span> : first.map(chip)}
        </div>
      </div>

      <div className="pp-group">
        <div className="pp-lbl">Two steps away</div>
        <div className="pp-chips">
          {secondShown.length === 0 ? (
            <span className="pp-none">Nobody</span>
          ) : (
            <>
              {secondShown.map(chip)}
              {secondHidden > 0 && <span className="pp-none">+{secondHidden} more</span>}
            </>
          )}
        </div>
      </div>

      <div className="pp-group">
        {/* The NAME stays put while `aria-pressed` carries the state, so a screen reader hears
            one control toggling rather than two controls swapping places. */}
        <button className="chipbtn" aria-pressed={pathFrom} onClick={onFindPath}>
          Find a path from here
        </button>
      </div>

      <p className="pp-reach">
        {Number.isFinite(reach)
          ? `Everyone is within ${reach} step${reach === 1 ? "" : "s"} of ${view.names[index]}.`
          : `Some people can't be reached from ${view.names[index]} at all — the group is split.`}
      </p>
    </section>
  );
}
