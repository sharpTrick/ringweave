import { LAYOUT_MODES, type LayoutMode } from "../graph/GraphCanvas";

const label = (m: LayoutMode) => m[0].toUpperCase() + m.slice(1);

export default function LayoutToggle({ layout, onChange }: { layout: LayoutMode; onChange: (m: LayoutMode) => void }) {
  return (
    <div id="toggle" className="glass" role="group" aria-label="Layout">
      {LAYOUT_MODES.map((m) => (
        <button
          key={m}
          aria-pressed={layout === m} // the active mode is otherwise CSS-only
          className={m + (layout === m ? " on" : "")}
          onClick={() => onChange(m)}
        >
          {label(m)}
        </button>
      ))}
    </div>
  );
}
