import { useId, useMemo } from "react";
import { clampText } from "../io/clamp";
import {
  MAX_CONSTRAINT_PAIRS,
  indexByName,
  type ConstraintKind,
  type NamedPair,
} from "../constraints";

interface Props {
  /** The roster the rules are being written against, as currently parsed. */
  names: string[];
  pairs: NamedPair[];
  onChange: (pairs: NamedPair[]) => void;
}

/**
 * How much of a typed name an accessible label repeats back.
 *
 * The value is whatever the user typed into a free-text field, so it is unbounded — and an
 * `aria-label` is a DOM sink like any other. Same rule and the same helper as every other place
 * untrusted text reaches the tree; see io/clamp.ts.
 */
const NAME_ECHO_MAX = 40;

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
  // ONE roster index per render, not one per field. `resolvePerson` builds a fresh
  // Map over the whole roster on every call, and each row validated two fields — at
  // the 1000-person ceiling with the 200-rule cap that was 400 thousand-entry Maps
  // per render, on every keystroke.
  const lookup = useMemo(() => indexByName(names), [names]);
  const unknownName = (text: string) =>
    text.trim() !== "" && !lookup.has(text.trim().toLowerCase());

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
        const unknownA = unknownName(p.a);
        const unknownB = unknownName(p.b);
        // THE REASON TRAVELS WITH THE FIELD. `aria-invalid` says a control is wrong and nothing
        // more; the only explanation was a COUNT in RosterModal's shared note stack ("2 buddy
        // rules name someone who isn't in this roster"), which never says WHICH row. A sighted
        // user gets the red outline on the offending input; a screen-reader user tabbing five
        // rules with two flagged heard "invalid, edit text, Rule 3, first person" and had to
        // cross-reference an aggregate elsewhere in the DOM.
        //
        // `aria-describedby`, NOT the label. Folding the reason into `aria-label` was the first
        // attempt and it is the wrong channel: the label is the control's NAME — its identity in
        // a rotor, and what every query in the suite and the e2e driver finds it by — so making
        // it change on each keystroke renames the control while the user types. A description is
        // the part of the ARIA contract that is allowed to vary, and it is what RosterModal
        // already uses to explain why the dialog reopened. Rendered visibly too: a sighted user
        // gets an outline and no words, which is the same gap one sense over.
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
        {/* `aria-disabled`, not `disabled`, for the reason the buddies stepper documents: the
            click that adds the LAST allowed row is the click that flips `atCap`, so a real
            `disabled` lands on the button under the user's finger and the browser blurs it. No
            element is removed, so `useFocusRescue` fires on the new row's insertion instead and
            relocates focus to the roster field at the top of the dialog — out of the rules
            disclosure, away from the row just added and from the cap notice explaining why, with
            200 rows to Tab back through. Keeping the button focusable and inert leaves the user
            where they were, next to a live region that is already announcing the limit. */}
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
        {/* Permanently mounted, text conditional — the same pattern RosterModal's note stack
            uses, and for the same reason: a region that appears together with its first message
            is never announced. This one gates a control (the Add button disables at the cap), so
            a keyboard-and-screen-reader user hitting the limit would otherwise find Add dead with
            no explanation. Fifth instance of this class; see io/clamp.ts for the sibling case
            where four repeats became one helper. */}
        <span className="rule-note" role="status" aria-live="polite">
          {atCap ? `That's the limit of ${MAX_CONSTRAINT_PAIRS} rules.` : ""}
        </span>
      </div>
    </div>
  );
}
