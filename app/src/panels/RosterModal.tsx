import { useMemo, useRef, useState, type DragEvent } from "react";
import { validateDetailed } from "ringweave";
import type { Settings } from "../model";
import {
  resolveNamedPairs, toConstraints,
  type ConstraintPair, type NamedPair,
} from "../constraints";
import { describeReasons } from "../io/constraintMessages";
import ConstraintsEditor from "./ConstraintsEditor";
import { MAX_PARSE_CHARS, charCapNotice, parseRoster } from "../io/parseRoster";
import { feasibility } from "../io/feasibility";
import { readFileText } from "../io/readFileText";
import { SAMPLE_NAMES } from "../sample";
import SettingsControls from "./SettingsControls";

interface Props {
  initialText: string;
  settings: Settings;
  /** The rules in force, with the roster their indices point into. */
  /**
   * The rules as the user last TYPED them, name-keyed. Not index pairs plus a roster:
   * a row naming someone who is no longer in the roster has no index to key on, and
   * reconstructing rows from indices is what silently deleted those rows on Generate —
   * contradicting the editor's own contract that an unrecognised row is kept and flagged.
   */
  rules: NamedPair[];
  canCancel: boolean;
  onGenerate: (
    names: string[],
    settings: Settings,
    constraints: ConstraintPair[],
    /** The typed rows, so the caller can hand them straight back when the editor reopens. */
    rules: NamedPair[],
  ) => void;
  onCancel: () => void;
}

/** F1 + F2: roster entry (paste or .txt/.csv drop, tolerant parse, duplicate warnings)
    and generate settings, with pre-run feasibility notes. */
export default function RosterModal({
  initialText, settings: initialSettings, rules: initialRules, canCancel, onGenerate, onCancel,
}: Props) {
  const [text, setText] = useState(initialText);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  // Rules are edited BY NAME, so a roster edit can never silently re-point them at
  // different people. They are converted in here, once, and back out on generate.
  const [rules, setRules] = useState<NamedPair[]>(initialRules);
  const [fileError, setFileError] = useState<string | null>(null);
  const [inputCapped, setInputCapped] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseRoster(text), [text]);
  const feas = useMemo(() => feasibility(parsed.names.length, settings.buddies), [parsed.names.length, settings.buddies]);

  // Bound the STORED (and DOM-rendered) string, not just the parse: an 8 MB file load or a
  // huge paste would otherwise re-render a multi-MB controlled textarea on every keystroke.
  // Because this pre-caps to exactly MAX_PARSE_CHARS, parseRoster's own char-truncation warning
  // can't fire on the UI path (and the name-cap warning misses a <MAX_NAMES-distinct giant
  // paste), so we surface the truncation notice here — capText is the UI truncation authority.
  const capText = (s: string) => {
    const over = s.length > MAX_PARSE_CHARS;
    setInputCapped(over);
    return over ? s.slice(0, MAX_PARSE_CHARS) : s;
  };

  // The ONE way to replace the roster text. Clears the transient notices (a stale file-error or
  // truncation note must never outlive the text it described) and re-derives inputCapped via
  // capText, so EVERY text-replacing path — typing, "try example names", a successful file read —
  // resets consistently rather than only the path that raised a notice.
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

  // Resolve the name-keyed rules against the roster as currently typed. `dropped`
  // counts rules naming somebody who is no longer there — surfaced below, never
  // discarded quietly.
  const resolved = useMemo(() => resolveNamedPairs(rules, parsed.names), [rules, parsed.names]);

  /**
   * The FIRST of F7's two feasibility gates: the same core check the worker will
   * run, run here so an impossible rule set is explained in the editor instead of
   * coming back as a refusal after a round trip. The worker's gate is the
   * authority; this one exists so the message arrives next to the control that
   * caused it.
   */
  const ruleProblems = useMemo(() => {
    if (resolved.pairs.length === 0) return [];
    // The SAME builder the worker uses, so this pre-flight can never call a rule set
    // feasible that the authoritative gate then refuses.
    const cons = toConstraints(parsed.names.length, resolved.pairs);
    return describeReasons(validateDetailed(cons, settings.buddies), parsed.names);
  }, [resolved.pairs, parsed.names, settings.buddies]);

  const generate = () => {
    if (!feas.canGenerate || ruleProblems.length > 0) return;
    onGenerate(parsed.names, settings, resolved.pairs, rules);
  };

  return (
    <div id="modal" role="dialog" aria-modal="true" aria-label="Set up your group">
      <div className="sheet glass" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <h2>Who's in your group?</h2>
        <p>
          Paste names, one per line (or comma-separated). Everyone gets an equal set of buddies, and
          the whole group stays closely connected. Nothing you type is uploaded.
        </p>
        <textarea
          value={text}
          onChange={(e) => setRoster(e.target.value)}
          placeholder={"Alice Nguyen\nBen Carter\nChloe Diaz\n…"}
          aria-label="Roster names"
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
          <SettingsControls settings={settings} onChange={setSettings} />
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

        {fileError && <div className="note blocking">{fileError}</div>}
        {inputCapped && <div className="note">{charCapNotice()}</div>}
        {parsed.warnings.map((w, i) => (
          <div className="note" key={i}>{w}</div>
        ))}
        {feas.messages.map((m, i) => (
          <div className={"note" + (feas.canGenerate ? "" : " blocking")} key={i}>{m}</div>
        ))}
        {/* By CAUSE. One "doesn't match anyone" message covering a duplicate
            restatement or a self-pairing sends the user looking for a missing person
            who is not missing. */}
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
  );
}
