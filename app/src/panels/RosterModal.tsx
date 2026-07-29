import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { validateDetailed } from "ringweave";
import type { Settings } from "../model";
import {
  resolveNamedPairs, toConstraints,
  type ConstraintPair, type NamedPair,
} from "../constraints";
import { describeReasons } from "../io/constraintMessages";
import ConstraintsEditor from "./ConstraintsEditor";
import { MAX_PARSE_CHARS, charCapNotice, parseRoster } from "../io/parseRoster";
import { clampToPoints } from "../io/clamp";
import { feasibility } from "../io/feasibility";
import { readFileText } from "../io/readFileText";
import { SAMPLE_NAMES } from "../sample";
import SettingsControls from "./SettingsControls";

interface Props {
  initialText: string;
  settings: Settings;
  /**
   * The rules as last TYPED, name-keyed rather than index pairs: a row naming someone no longer
   * in the roster has no index, so rebuilding rows from indices deletes it.
   */
  rules: NamedPair[];
  /**
   * Why the dialog was reopened. It arrives here rather than in the toast because the toast is
   * `inert` while this dialog is open, and `inert` removes it from the accessibility tree.
   */
  reopenReason?: string | null;
  canCancel: boolean;
  onGenerate: (
    names: string[],
    settings: Settings,
    constraints: ConstraintPair[],
    rules: NamedPair[],
  ) => void;
  onCancel: () => void;
}

/**
 * App's focus rescue finds this field by label, not by ref, so a rename here silently demotes the
 * rescue to its next candidate with nothing failing.
 */
export const ROSTER_FIELD_LABEL = "Roster names";

const REOPEN_REASON_ID = "reopen-reason";

export default function RosterModal({
  initialText, settings: initialSettings, rules: initialRules, reopenReason, canCancel,
  onGenerate, onCancel,
}: Props) {
  const [text, setText] = useState(initialText);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [rules, setRules] = useState<NamedPair[]>(initialRules);
  const [fileError, setFileError] = useState<string | null>(null);
  const [inputCapped, setInputCapped] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rosterRef = useRef<HTMLTextAreaElement>(null);

  // `useFocusRescue` is gated on focus having been somewhere real first, so it does not cover the
  // cold load — where this dialog is the whole accessible document and focus sits on `<body>`.
  // On mount only: a reopen is a new mount, and a re-render must not steal focus mid-typing.
  useEffect(() => {
    rosterRef.current?.focus();
  }, []);

  const parsed = useMemo(() => parseRoster(text), [text]);
  const feas = useMemo(() => feasibility(parsed.names.length, settings.buddies), [parsed.names.length, settings.buddies]);

  // Bound the STORED string, not just the parse, or a huge paste re-renders a multi-MB controlled
  // textarea on every keystroke. Pre-capping to exactly MAX_PARSE_CHARS also stops parseRoster's
  // own truncation warning from ever firing, so the notice has to be raised here.
  const capText = (s: string) => {
    const cut = clampToPoints(s, MAX_PARSE_CHARS);
    setInputCapped(cut !== s);
    return cut;
  };

  // The ONE way to replace the roster text: every replacing path must clear the transient notices,
  // or a stale file-error or truncation note outlives the text it described.
  const setRoster = (s: string) => {
    setFileError(null);
    setText(capText(s));
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setRoster(await readFileText(file));
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    void readFile(e.dataTransfer.files[0]);
  };

  const resolved = useMemo(() => resolveNamedPairs(rules, parsed.names), [rules, parsed.names]);

  /**
   * A pre-flight only: the worker's gate is the authority. It runs the SAME core check, so this
   * can never call a rule set feasible that the worker then refuses.
   */
  const ruleProblems = useMemo(() => {
    if (resolved.pairs.length === 0) return [];
    const cons = toConstraints(parsed.names.length, resolved.pairs);
    return describeReasons(validateDetailed(cons, settings.buddies), parsed.names);
  }, [resolved.pairs, parsed.names, settings.buddies]);

  const generate = () => {
    if (!feas.canGenerate || ruleProblems.length > 0) return;
    onGenerate(parsed.names, settings, resolved.pairs, rules);
  };

  return (
    // `aria-describedby`, NOT the live region below, announces why the dialog came back: a
    // refusal closes and reopens this dialog, so the region and its one message are created in
    // the same commit and nothing is announced. A description is read when focus enters, and
    // needs no ordering. Hoisting the text to one of App's permanent regions would put it outside
    // this `aria-modal` dialog.
    <div
      id="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Set up your group"
      aria-describedby={reopenReason ? REOPEN_REASON_ID : undefined}
    >
      <div className="sheet glass" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <h2>Who's in your group?</h2>
        <p>
          Paste names, one per line (or comma-separated). Everyone gets an equal set of buddies, and
          the whole group stays closely connected. Nothing you type is uploaded.
        </p>
        <textarea
          ref={rosterRef}
          value={text}
          onChange={(e) => setRoster(e.target.value)}
          placeholder={"Alice Nguyen\nBen Carter\nChloe Diaz\n…"}
          aria-label={ROSTER_FIELD_LABEL}
        />
        <div className="filedrop">
          <span>{parsed.names.length} {parsed.names.length === 1 ? "person" : "people"}</span>
          <span>· drop a .txt/.csv file, or</span>
          <button className="linklike" onClick={() => fileRef.current?.click()}>choose a file</button>
          <button className="linklike" onClick={() => setRoster(SAMPLE_NAMES.join("\n"))}>try example names</button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // allow re-choosing the same filename after an external edit
              void readFile(file);
            }}
          />
        </div>

        <details className="rules-block">
          <summary>
            Buddy rules{rules.length > 0 ? ` (${rules.length})` : ""}
          </summary>
          <p className="rules-help">
            Optional. Pin two people together, or keep them apart. Everything else is arranged
            around the rules.
          </p>
          <ConstraintsEditor names={parsed.names} pairs={rules} onChange={setRules} />
        </details>

        <div className="sheet-row">
          <SettingsControls
            settings={settings}
            onChange={setSettings}
            separationApplies={resolved.pairs.length === 0}
          />
          <div className="spacer" />
          {canCancel && <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
          <button
            className="btn btn-warm"
            disabled={!feas.canGenerate || ruleProblems.length > 0}
            onClick={generate}
          >
            Generate buddy graph
          </button>
        </div>

        {/* ONE permanently-mounted live region around the whole stack, not one per note: a region
            that appears together with its first text is never announced, and two of these notes
            gate the Generate button. */}
        <div role="status" aria-live="polite">
        {reopenReason && <div id={REOPEN_REASON_ID} className="note blocking">{reopenReason}</div>}
        {fileError && <div className="note blocking">{fileError}</div>}
        {inputCapped && <div className="note">{charCapNotice()}</div>}
        {parsed.warnings.map((w, i) => (
          <div className="note" key={i}>{w}</div>
        ))}
        {feas.messages.map((m, i) => (
          <div className={"note" + (feas.canGenerate ? "" : " blocking")} key={i}>{m}</div>
        ))}
        {/* Split by CAUSE: one "doesn't match anyone" covering a duplicate or a self-pairing
            sends the user hunting for a person who is not missing. */}
        {resolved.unmatched > 0 && (
          <div className="note">
            {resolved.unmatched === 1
              ? "1 buddy rule names someone who isn't in this roster and won't be used."
              : `${resolved.unmatched} buddy rules name someone who isn't in this roster and won't be used.`}
          </div>
        )}
        {resolved.selfPair > 0 && (
          <div className="note">
            {resolved.selfPair === 1
              ? "1 buddy rule pairs someone with themselves and won't be used."
              : `${resolved.selfPair} buddy rules pair someone with themselves and won't be used.`}
          </div>
        )}
        {resolved.incomplete > 0 && (
          <div className="note">
            {resolved.incomplete === 1
              ? "1 buddy rule is still missing a name."
              : `${resolved.incomplete} buddy rules are still missing a name.`}
          </div>
        )}
        {resolved.duplicate > 0 && (
          <div className="note">
            {resolved.duplicate === 1
              ? "1 buddy rule repeats another one and will only be applied once."
              : `${resolved.duplicate} buddy rules repeat others and will only be applied once.`}
          </div>
        )}
        {ruleProblems.map((m, i) => (
          <div className="note blocking" key={i}>{m}</div>
        ))}
        </div>
      </div>
    </div>
  );
}
