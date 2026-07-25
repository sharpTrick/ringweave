import { useId } from "react";
import {
  MAX_CONSTRAINT_PAIRS,
  resolvePerson,
  type ConstraintKind,
  type NamedPair,
} from "../constraints";

interface Props {
  /** The roster the rules are being written against, as currently parsed. */
  names: string[];
  pairs: NamedPair[];
  onChange: (pairs: NamedPair[]) => void;
}

const KIND_LABEL: Record<ConstraintKind, string> = {
  required: "Must be buddies",
  prohibited: "Never buddies",
};

/**
 * F7's rule editor: one row per rule, `[person A] [person B] [kind] [×]`.
 *
 * Rows hold NAMES, not roster positions — see `NamedPair`. A row naming somebody
 * who is not in the roster is kept and flagged rather than deleted: the user is
 * mid-edit, and silently removing a row they are still typing is worse than
 * showing it as unrecognised.
 *
 * People are picked through one shared `<datalist>` rather than two `<select>`
 * elements per row. At the roster ceiling (1000 people) two selects across the
 * 200-pair cap would mount 400,000 option nodes; a datalist is mounted once and
 * still gives native keyboard autocomplete.
 */
export default function ConstraintsEditor({ names, pairs, onChange }: Props) {
  const listId = useId();
  const atCap = pairs.length >= MAX_CONSTRAINT_PAIRS;

  const update = (i: number, patch: Partial<NamedPair>) => {
    onChange(pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };

  return (
    <div className="rules">
      <datalist id={listId}>
        {/* Text content as well as `value`: a bare <option/> reads as an unlabelled
            control to the a11y linter, and browsers collapse the two when identical. */}
        {names.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </datalist>

      {pairs.map((p, i) => {
        const unknownA = p.a.trim() !== "" && resolvePerson(p.a, names) < 0;
        const unknownB = p.b.trim() !== "" && resolvePerson(p.b, names) < 0;
        return (
          <div className="rule-row" key={i}>
            <input
              className={"rule-who" + (unknownA ? " unknown" : "")}
              list={listId}
              value={p.a}
              onChange={(e) => update(i, { a: e.target.value })}
              aria-label={`Rule ${i + 1}, first person`}
              aria-invalid={unknownA || undefined}
              placeholder="Someone"
            />
            <input
              className={"rule-who" + (unknownB ? " unknown" : "")}
              list={listId}
              value={p.b}
              onChange={(e) => update(i, { b: e.target.value })}
              aria-label={`Rule ${i + 1}, second person`}
              aria-invalid={unknownB || undefined}
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
          </div>
        );
      })}

      <div className="rule-acts">
        <button
          className="linklike"
          disabled={atCap}
          onClick={() => onChange([...pairs, { a: "", b: "", kind: "required" }])}
        >
          + Add a buddy rule
        </button>
        {atCap && <span className="rule-note">That's the limit of {MAX_CONSTRAINT_PAIRS} rules.</span>}
      </div>
    </div>
  );
}
