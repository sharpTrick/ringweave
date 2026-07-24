import { LAYOUT_MODES, type LayoutMode } from "../graph/GraphCanvas";

/** Title-case a mode name for its button label ("ring" -> "Ring"). */
const label = (m: LayoutMode) => m[0].toUpperCase() + m.slice(1);

/** The layout toggle, rendered one button per LAYOUT_MODES entry — so LAYOUT_MODES is the single,
    load-bearing source of the selectable layouts: adding a mode there surfaces its button here
    (its CSS hook is the mode name; see #toggle in app.css). */
export default function LayoutToggle({ layout, onChange }: { layout: LayoutMode; onChange: (m: LayoutMode) => void }) {
  return (
    <div id="toggle" className="glass" role="group" aria-label="Layout">
      {LAYOUT_MODES.map((m) => (
        <button key={m} className={m + (layout === m ? " on" : "")} onClick={() => onChange(m)}>
          {label(m)}
        </button>
      ))}
    </div>
  );
}
