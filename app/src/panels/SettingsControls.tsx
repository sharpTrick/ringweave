import { useId } from "react";
import { clamp } from "../io/clamp";
import { BUDDY_MAX, BUDDY_MIN, SEED_MAX, SEPARATION_DEFAULT, SEPARATION_MAX, SEPARATION_MIN, type Settings } from "../model";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  /**
   * Whether `minSeparation` reaches a builder that acts on it.
   *
   * False once the roster carries buddy rules: the constrained builder maximises separation
   * instead of aiming at a target, so the core documents the option as accepted and ignored on
   * that path. A control that cannot affect the output must not read as a request — the same
   * reason `separationShortfall` stops reporting a shortfall there.
   */
  separationApplies?: boolean;
}

const polishValue = (p: boolean | "auto"): string => (p === "auto" ? "auto" : p ? "on" : "off");
const parsePolish = (v: string): boolean | "auto" => (v === "auto" ? "auto" : v === "on");

/** F2 settings: buddies-per-person (k) plus an Advanced disclosure for minimum
    separation, polish mode, and the seed (determinism dial). Numeric inputs are clamped
    on change — HTML min/max don't stop a cleared/typed value (an empty field is 0). */
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
        {/* The value is announced two ways, because the two are for different moments.
            `role="status"` reports the NEW number after a press — the buttons keep focus, so
            without it a screen-reader user pressing "+" hears nothing at all and has no way to
            know whether the press registered. The value in each button's own label reports the
            CURRENT number to someone who has just tabbed onto the control and has not pressed
            anything yet. LayoutToggle's `aria-pressed` is the same idea for a control whose
            state is a choice rather than a count. */}
        {/* AT THE BOUNDS the live region cannot carry the news, because the value does not
            change: `setK` clamps 13 back to 12, the text stays "12", no DOM mutation happens and
            nothing is announced. A user pressing "+" at the ceiling could not tell "my press did
            not register" from "I am already at the limit" — the one distinction the region exists
            to make. So the state is carried by the CONTROL rather than by the value.

            `aria-disabled`, not `disabled`: a real `disabled` on the button under the user's
            finger is blurred by the browser the moment it takes effect, and that happens on the
            press that REACHES the bound — no element is removed, so `useFocusRescue` (which
            watches for removals) correctly does not fire, and focus is simply gone. `aria-disabled`
            conveys the state, keeps the control focusable, and leaves the no-op no-op. */}
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
              // `aria-disabled`, not `disabled`, for the reason the stepper documents: the value
              // is still worth reading, and a control blurred out from under a keyboard user is
              // its own defect. The note beside it is what says why.
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
