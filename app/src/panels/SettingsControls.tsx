import { DEFAULT_MIN_SEPARATION } from "ringweave";
import { BUDDY_MAX, BUDDY_MIN, type Settings } from "../model";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

const polishValue = (p: boolean | "auto"): string => (p === "auto" ? "auto" : p ? "on" : "off");
const parsePolish = (v: string): boolean | "auto" => (v === "auto" ? "auto" : v === "on");

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** F2 settings: buddies-per-person (k) plus an Advanced disclosure for minimum
    separation, polish mode, and the seed (determinism dial). Numeric inputs are clamped
    on change — HTML min/max don't stop a cleared/typed value (an empty field is 0). */
export default function SettingsControls({ settings, onChange }: Props) {
  const setK = (k: number) => onChange({ ...settings, buddies: clamp(Math.round(k), BUDDY_MIN, BUDDY_MAX) });

  const setMinSep = (raw: number) =>
    onChange({ ...settings, minSeparation: Number.isFinite(raw) ? clamp(Math.round(raw), BUDDY_MIN, BUDDY_MAX) : DEFAULT_MIN_SEPARATION });

  const setSeed = (raw: number) =>
    onChange({ ...settings, seed: Number.isInteger(raw) ? raw : settings.seed });

  return (
    <>
      <div className="field">
        Buddies each
        <div className="stepper">
          <button type="button" aria-label="fewer buddies" onClick={() => setK(settings.buddies - 1)}>−</button>
          <span className="val tabnum">{settings.buddies}</span>
          <button type="button" aria-label="more buddies" onClick={() => setK(settings.buddies + 1)}>+</button>
        </div>
      </div>
      <details className="advanced">
        <summary className="linklike">Advanced</summary>
        <div className="sheet-row">
          <label className="field">
            Min separation
            <input
              type="number"
              min={BUDDY_MIN}
              max={BUDDY_MAX}
              value={settings.minSeparation ?? DEFAULT_MIN_SEPARATION}
              onChange={(e) => setMinSep(Number(e.target.value))}
              style={{ width: 56 }}
            />
          </label>
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
