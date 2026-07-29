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

// Class: a live region must be IN the accessibility tree before its text changes, or the change
// is never announced. Every mechanism the app has for that is in the markup — permanently
// mounted regions, emptied-then-refilled text, `aria-describedby` where a dialog cannot stay
// mounted — and CSS could undo all of it in one line, invisibly, from a file none of those
// components import. `.toast-region:empty { display: none }` did exactly that: `display:none`
// removes the subtree from the accessibility tree, so the region and its first message entered
// together and no toast was ever announced. Asserted over the STYLESHEET SOURCE, for every
// live-region class in the tree rather than the one that was broken.
describe("CSS cannot un-mount a live region", () => {
  it("no rule hides any live-region class, in any state", () => {
    const css = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");
    const liveClasses = ["toast-region", "sr-live", "busy-live", "search-empty", "rule-note"];
    const offenders: string[] = [];
    // Rule-by-rule: selector up to `{`, declarations up to `}`. Comments are stripped first so
    // the prose ABOVE a rule (which names these classes on purpose) is never mistaken for one.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector, body] = rule;
      const hidden = /(^|[;\s])(display\s*:\s*none|visibility\s*:\s*hidden)\s*(;|$)/.test(body);
      if (!hidden) continue;
      for (const cls of liveClasses) {
        if (new RegExp(`\\.${cls}\\b`).test(selector)) {
          offenders.push(`${selector.trim()} { ${body.trim()} }`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
