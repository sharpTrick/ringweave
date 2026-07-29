import { useId, useMemo } from "react";
import { clampText } from "../io/clamp";
import {
  MAX_CONSTRAINT_PAIRS,
  indexByName,
  type ConstraintKind,
  type NamedPair,
} from "../constraints";

interface Props {
  names: string[];
  pairs: NamedPair[];
  onChange: (pairs: NamedPair[]) => void;
}

/** The echoed name is unbounded free text, and an accessible label is a DOM sink like any other. */
const NAME_ECHO_MAX = 40;

const KIND_LABEL: Record<ConstraintKind, string> = {
  required: "Must be buddies",
  prohibited: "Never buddies",
};

/**
 * Rows hold NAMES, not roster positions: a row naming somebody who is not in the roster is kept
 * and flagged, so deleting it here would remove a row the user is still typing.
 */
export default function ConstraintsEditor({ names, pairs, onChange }: Props) {
  const listId = useId();
  const atCap = pairs.length >= MAX_CONSTRAINT_PAIRS;
  // One roster index per render, not one per field: `indexByName` walks the whole roster, and
  // every row validates two fields on every keystroke.
  const lookup = useMemo(() => indexByName(names), [names]);
  const unknownName = (text: string) =>
    text.trim() !== "" && !lookup.has(text.trim().toLowerCase());

  const update = (i: number, patch: Partial<NamedPair>) => {
    onChange(pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };

  return (
    <div className="rules">
      <datalist id={listId}>
        {/* Text content as well as `value`: a bare <option/> reads as an unlabelled control. */}
        {names.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </datalist>

      {pairs.map((p, i) => {
        const unknownA = unknownName(p.a);
        const unknownB = unknownName(p.b);
        // `aria-describedby`, not `aria-label`: the label is the control's NAME — its rotor
        // identity, and what every test and the e2e driver find it by — so folding a per-keystroke
        // reason into it renames the control while the user types. A description may vary.
        const whyId = (side: "a" | "b") => `${listId}-why-${i}-${side}`;
        const why = (name: string) => `“${clampText(name, NAME_ECHO_MAX)}” isn't in this roster.`;
        return (
          <div className="rule-row" key={i}>
            <input
              className={"rule-who" + (unknownA ? " unknown" : "")}
              list={listId}
              value={p.a}
              onChange={(e) => update(i, { a: e.target.value })}
              aria-label={`Rule ${i + 1}, first person`}
              aria-invalid={unknownA || undefined}
              aria-describedby={unknownA ? whyId("a") : undefined}
              placeholder="Someone"
            />
            <input
              className={"rule-who" + (unknownB ? " unknown" : "")}
              list={listId}
              value={p.b}
              onChange={(e) => update(i, { b: e.target.value })}
              aria-label={`Rule ${i + 1}, second person`}
              aria-invalid={unknownB || undefined}
              aria-describedby={unknownB ? whyId("b") : undefined}
              placeholder="Someone else"
            />
            <select
              className="rule-kind"
              value={p.kind}
              onChange={(e) => update(i, { kind: e.target.value as ConstraintKind })}
              aria-label={`Rule ${i + 1}, kind`}
            >
              {(Object.keys(KIND_LABEL) as ConstraintKind[]).map((kind) => (
                <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>
              ))}
            </select>
            <button
              className="rule-del"
              onClick={() => onChange(pairs.filter((_, j) => j !== i))}
              aria-label={`Remove rule ${i + 1}`}
            >
              ×
            </button>
            {unknownA && <div className="rule-why" id={whyId("a")}>{why(p.a)}</div>}
            {unknownB && <div className="rule-why" id={whyId("b")}>{why(p.b)}</div>}
          </div>
        );
      })}

      <div className="rule-acts">
        {/* `aria-disabled`, not `disabled`: the click that adds the LAST allowed row is the click
            that flips `atCap`, and a real `disabled` blurs the button under the user's finger. */}
        <button
          className="linklike"
          aria-disabled={atCap}
          onClick={() => {
            if (atCap) return;
            onChange([...pairs, { a: "", b: "", kind: "required" }]);
          }}
        >
          + Add a buddy rule
        </button>
        {/* Mounted always, text conditional: a region that appears together with its first message
            is never announced, and this one is why Add went inert. */}
        <span className="rule-note" role="status" aria-live="polite">
          {atCap ? `That's the limit of ${MAX_CONSTRAINT_PAIRS} rules.` : ""}
        </span>
      </div>
    </div>
  );
}
