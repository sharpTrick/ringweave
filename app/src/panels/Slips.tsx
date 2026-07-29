import { memo } from "react";
import { buddyLabel, type GraphView } from "../model";

/** Memoized: a hover rewrites App state this component does not read, and it renders one card per
    person. */
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
