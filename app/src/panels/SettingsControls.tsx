import { useId } from "react";
import { clamp } from "../io/clamp";
import { BUDDY_MAX, BUDDY_MIN, SEED_MAX, SEPARATION_DEFAULT, SEPARATION_MAX, SEPARATION_MIN, type Settings } from "../model";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  /**
   * False once the roster carries buddy rules: the constrained builder accepts and ignores
   * `minSeparation`, and a control that cannot affect the output must not read as a request.
   */
  separationApplies?: boolean;
}

const polishValue = (p: boolean | "auto"): string => (p === "auto" ? "auto" : p ? "on" : "off");
const parsePolish = (v: string): boolean | "auto" => (v === "auto" ? "auto" : v === "on");

/** Numeric inputs are clamped on change: HTML min/max do not stop a cleared or typed value, and
    an empty field reads as 0. */
export default function SettingsControls({ settings, onChange, separationApplies = true }: Props) {
  const separationNoteId = `${useId()}-sep`;

  const setK = (k: number) => onChange({ ...settings, buddies: clamp(Math.round(k), BUDDY_MIN, BUDDY_MAX) });

  const setMinSep = (raw: number) =>
    onChange({ ...settings, minSeparation: Number.isFinite(raw) ? clamp(Math.round(raw), SEPARATION_MIN, SEPARATION_MAX) : SEPARATION_DEFAULT });

  const setSeed = (raw: number) =>
    onChange({ ...settings, seed: Number.isInteger(raw) ? clamp(raw, 0, SEED_MAX) : settings.seed });

  return (
    <>
      <div className="field">
        Buddies each
        {/* Announced two ways. `role="status"` reports the NEW value after a press, since the
            button keeps focus and nothing else says the press registered; each button's label
            repeats the CURRENT value for someone who has just tabbed on.
            AT THE BOUNDS the region cannot help — `setK` clamps, the text does not change and no
            mutation is announced — so the bound is carried by the control instead.
            `aria-disabled`, not `disabled`: the press that REACHES the bound would otherwise blur
            the button under the user's finger, and no element is removed for `useFocusRescue` to
            catch. */}
        <div className="stepper">
          <button
            type="button"
            aria-disabled={settings.buddies <= BUDDY_MIN}
            aria-label={
              settings.buddies <= BUDDY_MIN
                ? `fewer buddies, currently ${settings.buddies} — the fewest allowed`
                : `fewer buddies, currently ${settings.buddies}`
            }
            onClick={() => setK(settings.buddies - 1)}
          >
            −
          </button>
          <span className="val tabnum" role="status" aria-live="polite">{settings.buddies}</span>
          <button
            type="button"
            aria-disabled={settings.buddies >= BUDDY_MAX}
            aria-label={
              settings.buddies >= BUDDY_MAX
                ? `more buddies, currently ${settings.buddies} — the most allowed`
                : `more buddies, currently ${settings.buddies}`
            }
            onClick={() => setK(settings.buddies + 1)}
          >
            +
          </button>
        </div>
      </div>
      <details>
        <summary className="linklike">Advanced</summary>
        <div className="sheet-row">
          <label className="field">
            Min separation
            <input
              type="number"
              min={SEPARATION_MIN}
              max={SEPARATION_MAX}
              value={settings.minSeparation ?? SEPARATION_DEFAULT}
              onChange={(e) => setMinSep(Number(e.target.value))}
              style={{ width: 56 }}
              // `aria-disabled`, not `disabled`, for the reason the stepper gives: a real
              // `disabled` blurs the control out from under a keyboard user.
              aria-disabled={!separationApplies || undefined}
              aria-describedby={separationApplies ? undefined : separationNoteId}
            />
          </label>
          {!separationApplies && (
            <span className="field-note" id={separationNoteId}>
              Doesn't apply when the group has buddy rules — those arrange it a different way.
            </span>
          )}
          <label className="field">
            Polish
            <select
              value={polishValue(settings.polish)}
              onChange={(e) => onChange({ ...settings, polish: parsePolish(e.target.value) })}
            >
              <option value="auto">auto</option>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </label>
          <label className="field">
            Seed
            <input
              type="number"
              min={0}
              max={SEED_MAX}
              value={settings.seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              style={{ width: 84 }}
            />
          </label>
        </div>
      </details>
    </>
  );
}
