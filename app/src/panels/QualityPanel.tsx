import {
  buddiesLabel, connectionSummary, constraintSummary, qualityPercent, separationShortfall, targetShortfall,
  type GraphView,
} from "../model";

interface Props {
  view: GraphView;
  onExport: () => void;
  onImport: () => void;
}

const fmt1 = (x: number | null): string => (x == null ? "—" : x.toFixed(1));
const fmtInt = (x: number | null): string => (x == null ? "—" : String(x));

export default function QualityPanel({ view, onExport, onImport }: Props) {
  const m = view.metrics;
  const q = qualityPercent(m);
  const rules = constraintSummary(view);
  const shortfall = targetShortfall(view);
  const separation = separationShortfall(view);
  return (
    <section id="metrics" className="glass" aria-label="Connection quality">
      <div className="metric">
        <span className="v tabnum">{fmt1(m.aspl)}</span>
        <span className="l">avg hops between any two people</span>
      </div>
      <div className="sep" />
      <div className="metric">
        <span className="v tabnum">{fmtInt(m.diameter)}</span>
        <span className="l">most steps between anyone</span>
      </div>
      <div className="sep" />
      <div className="metric">
        {/* `title` is a pointer affordance, and the gauge is not focusable — so without the
            `aria-label` the number reaches a screen reader as a bare integer with no unit and no
            statement of what it measures. */}
        <div
          className="gauge"
          role="img"
          aria-label={`Connection quality ${q}%: how close to the theoretical best (Moore bound) this graph is. Zero when the group is split into disconnected sub-groups.`}
          style={{ background: `conic-gradient(var(--cool2) 0 ${q}%, var(--line) ${q}% 100%)` }}
          title="Connection quality: how close to the theoretical best (Moore bound) this graph is. Zero when the group is split into disconnected sub-groups."
        >
          <div className="inner tabnum" aria-hidden="true">{q}</div>
        </div>
        <span className="l">{connectionSummary(m)}</span>
      </div>
      {shortfall && (
        <div className="rules-line">
          {/* Worded about the GRAPH: `targetShortfall` cannot tell a generated view from an
              imported one, so blaming "this roster" blames a limit that came from a file.
              `buddiesLabel`, not `degreeMax`: on an irregular graph `degreeMax` asserts a count
              at least one person does not have. */}
          Each person has {buddiesLabel(view.metrics)}, not the{" "}
          {shortfall.asked} in Settings.
        </div>
      )}
      {separation && (
        <div className="rules-line">
          Buddies are {separation.got} {separation.got === 1 ? "step" : "steps"} apart, not the{" "}
          {separation.asked} in Settings.
        </div>
      )}
      {rules && <div className="rules-line">{rules}</div>}
      <div className="m-acts">
        <button className="btn btn-ghost" onClick={onImport}>Import ↑</button>
        <button className="btn btn-ghost" onClick={() => window.print()}>Print slips</button>
        <button className="btn btn-cool" onClick={onExport}>Export ↓</button>
      </div>
    </section>
  );
}
