import type { Settings } from "../model";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

const polishValue = (p: boolean | "auto"): string => (p === "auto" ? "auto" : p ? "on" : "off");
const parsePolish = (v: string): boolean | "auto" => (v === "auto" ? "auto" : v === "on");

/** F2 settings: buddies-per-person (k) plus an Advanced disclosure for minimum
    separation, polish mode, and the seed (determinism dial). */
export default function SettingsControls({ settings, onChange }: Props) {
  const setK = (k: number) => onChange({ ...settings, buddies: Math.max(2, Math.min(12, k)) });

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
              min={2}
              max={12}
              value={settings.minSeparation ?? 5}
              onChange={(e) => onChange({ ...settings, minSeparation: Number(e.target.value) })}
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
              onChange={(e) => onChange({ ...settings, seed: Number(e.target.value) })}
              style={{ width: 84 }}
            />
          </label>
        </div>
      </details>
    </>
  );
}
