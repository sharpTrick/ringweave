import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Guards the "a light theme is a later token-swap" promise: a color literal that duplicates
// a defined --token would survive a token-only theme change and silently break contrast.
describe("CSS tokens", () => {
  it("no 6-digit hex outside :root duplicates a defined --token value", () => {
    const css = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");
    const root = css.match(/:root\s*\{([\s\S]*?)\}/);
    expect(root).not.toBeNull();

    const tokenByValue = new Map<string, string>();
    for (const m of root![1].matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
      tokenByValue.set(m[2].toLowerCase(), m[1]);
    }

    const body = css.slice(root!.index! + root![0].length);
    const offenders: string[] = [];
    for (const m of body.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
      const hex = m[0].toLowerCase();
      if (tokenByValue.has(hex)) offenders.push(`${m[0]} should be var(${tokenByValue.get(hex)})`);
    }
    expect(offenders).toEqual([]);
  });

  // Class: the data-driven layout toggle renders a button per LAYOUT_MODES entry, so the ACTIVE
  // style must be mode-agnostic — a new mode's selected state can't depend on a hardcoded
  // `.on.<mode>` rule or it renders invisible. The generic `#toggle button.on` rule must set a
  // non-transparent background so any mode reads as selected.
  it("the active toggle button has a mode-agnostic background", () => {
    const css = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");
    const generic = css.match(/#toggle button\.on\s*\{([^}]*)\}/); // the .on rule, not .on.<mode>
    expect(generic).not.toBeNull();
    expect(generic![1]).toMatch(/background:\s*var\(--/); // a defined-token background, not transparent
  });
});
