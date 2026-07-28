import {
  connectionSummary, constraintSummary, degreeLabel, qualityPercent, targetShortfall,
  type GraphView,
} from "../model";

interface Props {
  view: GraphView;
  onExport: () => void;
  onImport: () => void;
}

const fmt1 = (x: number | null): string => (x == null ? "—" : x.toFixed(1));
const fmtInt = (x: number | null): string => (x == null ? "—" : String(x));

/** F5: plain-language quality readout — avg hops, max hops, and a connection-quality
    score from the core's Moore gap. Numbers come straight from the GraphView metrics.
    A disconnected import (some people in separate groups) is shown honestly, not as
    "everyone's well-linked". */
export default function QualityPanel({ view, onExport, onImport }: Props) {
  const m = view.metrics;
  const q = qualityPercent(m); // same rounded value the caption thresholds on
  const rules = constraintSummary(view);
  const shortfall = targetShortfall(view);
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
        <div
          className="gauge"
          style={{ background: `conic-gradient(var(--cool2) 0 ${q}%, var(--line) ${q}% 100%)` }}
          title="Connection quality: how close to the theoretical best (Moore bound) this graph is. Zero when the group is split into disconnected sub-groups."
        >
          <div className="inner tabnum">{q}</div>
        </div>
        <span className="l">{connectionSummary(m)}</span>
      </div>
      {shortfall && (
        // Stated plainly, next to the gauge that reads 100. The gauge is not wrong — the graph
        // IS optimal for the degree it delivered — but "optimal" and "what you asked for" are
        // different claims, and only one of them was on screen.
        <div className="rules-line">
          {/* Worded about the GRAPH, not about the roster or the request. `targetShortfall` cannot
              tell a generated view from an imported one, and an imported edge set no generator
              ever built was being blamed on "this roster" — a limit that came from the file.
              Describing what is true of the graph in front of the user is accurate on both
              paths, and needed no provenance flag to get there. */}
          {/* `degreeLabel`, not `degreeMax` — the SAME seam the rail and the connection caption
              use. Wording this off degreeMax asserted a count at least one person does not have
              whenever the graph is not regular, and disagreed with the two panels beside it. The
              caption had exactly this defect fixed one round earlier; this line was added in that
              same commit and reintroduced it. */}
          Each person has {degreeLabel(view.metrics)}{" "}
          {view.metrics.regular && view.metrics.degreeMax === 1 ? "buddy" : "buddies"}, not the{" "}
          {shortfall.asked} in Settings.
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
