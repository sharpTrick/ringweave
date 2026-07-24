import type { GraphView } from "../model";

interface Props {
  view: GraphView;
  onExport: () => void;
  onImport: () => void;
}

const fmt1 = (x: number | null): string => (x == null ? "—" : x.toFixed(1));
const fmtInt = (x: number | null): string => (x == null ? "—" : String(x));

/** F5: plain-language quality readout — avg hops, max hops, and a connection-quality
    score from the core's Moore gap. Numbers come straight from the GraphView metrics. */
export default function QualityPanel({ view, onExport, onImport }: Props) {
  const m = view.metrics;
  const q = Math.round(m.quality * 100);
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
          title="Connection quality: how close to the theoretical best (Moore bound) this graph is."
        >
          <div className="inner tabnum">{q}</div>
        </div>
        <span className="l">connection quality — everyone's well-linked</span>
      </div>
      <div className="m-acts">
        <button className="btn btn-ghost" onClick={onImport}>Import ↑</button>
        <button className="btn btn-ghost" onClick={() => window.print()}>Print slips</button>
        <button className="btn btn-cool" onClick={onExport}>Export ↓</button>
      </div>
    </section>
  );
}
