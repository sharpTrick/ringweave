import { useState } from "react";
import { buddyNames, type GraphView } from "../model";
import { copyText, downloadBlob, toCsv } from "../io/download";

interface Props {
  view: GraphView;
  selected: number | null;
  onSelect: (i: number) => void;
}

/** F3: the always-available, non-graph interface — a Name → buddies table with copy
    and CSV export. Clicking a row selects that person in the graph. */
export default function BuddyList({ view, selected, onSelect }: Props) {
  const [copied, setCopied] = useState(false);

  const copyAll = async () => {
    const text = view.names
      .map((name, i) => `${name}: ${buddyNames(view, i).join(", ")}`)
      .join("\n");
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1100);
    }
  };

  const exportCsv = () => {
    const rows: string[][] = [["name", "buddies"]];
    view.names.forEach((name, i) => rows.push([name, buddyNames(view, i).join("; ")]));
    downloadBlob("buddies.csv", "text/csv", toCsv(rows));
  };

  return (
    <section id="buddies" className="glass" aria-label="Buddy list">
      <div className="bp-head">
        <h2>Buddy list</h2>
        <div className="bp-acts">
          <button className="chipbtn" onClick={copyAll}>{copied ? "Copied" : "Copy"}</button>
          <button className="chipbtn" onClick={exportCsv}>CSV</button>
        </div>
      </div>
      <div className="bp-list">
        {view.names.map((name, i) => (
          <button
            key={i}
            className={"brow" + (selected === i ? " sel" : "")}
            onClick={() => onSelect(i)}
          >
            <span className="nm">{name}</span>
            <span className="bd">{buddyNames(view, i).join(", ") || "—"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
