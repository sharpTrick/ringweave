import type { GraphView } from "../model";

/** F3: print-friendly buddy slips in their own DOM subtree (hidden on screen, shown
    for print via print.css) — one card per person, cut-apart friendly. */
export default function Slips({ view }: { view: GraphView }) {
  return (
    <div className="slips" aria-hidden="true">
      {view.names.map((name, i) => (
        <div className="slip" key={i}>
          <h3>{name}</h3>
          <div className="who">Your buddies:</div>
          <div className="buddies">
            {view.buddies[i].map((j) => view.names[j]).join(", ") || "—"}
          </div>
        </div>
      ))}
    </div>
  );
}
