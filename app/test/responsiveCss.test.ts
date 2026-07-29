/**
 * Panels are placed by absolute offsets from the viewport edges, and a phone is narrower than the
 * offsets assume — `#sidecol` at `right: 314px; width: 250px` computes to x = -174 at 390px wide,
 * which is how the person card shipped entirely off the left edge. The stylesheet's narrow-width
 * block is what returns each panel to the normal flow, so a panel missing from it is the whole
 * defect. This reads the stylesheet rather than a browser because it is a COMPLETENESS claim about
 * a list, which geometry at any one viewport cannot make; `scripts/e2e/drive.mjs` measures the
 * geometry that results.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The `@media (max-width: Npx)` block bodies, widest first, plus everything outside any block. */
function tiers(): { width: number; body: string }[] {
  const found: { width: number; body: string }[] = [];
  let rest = "";
  let at = 0;
  while (at < CSS.length) {
    const m = /@media[^{]*\(max-width:\s*(\d+)px\)[^{]*\{/.exec(CSS.slice(at));
    if (!m) {
      rest += CSS.slice(at);
      break;
    }
    rest += CSS.slice(at, at + m.index);
    let depth = 1;
    let i = at + m.index + m[0].length;
    const start = i;
    for (; i < CSS.length && depth > 0; i++) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}") depth--;
    }
    found.push({ width: Number(m[1]), body: CSS.slice(start, i - 1) });
    at = i;
  }
  return [{ width: Infinity, body: rest }, ...found.sort((a, b) => b.width - a.width)];
}

/** `{selector: declarations}` for rules whose selector is one plain `#id` or `.class`. */
function simpleRules(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const sel of rule[1].split(",")) {
      const s = sel.trim();
      if (/^[#.][\w-]+$/.test(s)) out.set(s, (out.get(s) ?? "") + ";" + rule[2]);
    }
  }
  return out;
}

/** How `selector` is placed in `body`: its position keyword and any viewport-edge offsets. */
function placement(body: string, selector: string): { position: string | null; insets: string[] } {
  const decls = simpleRules(body).get(selector) ?? "";
  const m = [...decls.matchAll(/(?:^|;)\s*position\s*:\s*([\w-]+)/g)].pop();
  const insets = [...decls.matchAll(/(?:^|;)\s*(top|right|bottom|left|inset)\s*:\s*([^;]+)/g)]
    .filter((i) => !/^\s*auto\s*$/.test(i[2]))
    .map((i) => `${i[1]}: ${i[2].trim()}`);
  return { position: m ? m[1] : null, insets };
}

// Present in the accessibility tree and clipped to 1px on purpose — they render nothing, so being
// off-screen is what they are for.
const NOT_PANELS = new Set([".sr-live", ".busy-live"]);

describe("every absolutely-positioned panel rejoins the flow at phone width", () => {
  const all = tiers();
  const narrow = all[all.length - 1];
  const wider = all.slice(0, -1);

  it("has a narrowest tier to rejoin into", () => {
    expect(narrow.width).toBeLessThanOrEqual(820);
    expect(wider.length).toBeGreaterThan(0);
  });

  // Absolute in ANY tier above the narrowest is enough to need checking — a panel can acquire its
  // offsets in a middle tier (`#rightcol` does) or lose them there (`#sidecol` does) and is just
  // as stranded at phone width either way.
  const positioned = new Set<string>();
  for (const tier of wider) {
    for (const [sel, decls] of simpleRules(tier.body)) {
      if (NOT_PANELS.has(sel)) continue;
      const m = [...decls.matchAll(/(?:^|;)\s*position\s*:\s*([\w-]+)/g)].pop();
      if (m?.[1] === "absolute") positioned.add(sel);
    }
  }

  it("finds the panels to check", () => {
    // Non-vacuity: an empty set would make every assertion below pass by having nothing to check.
    expect([...positioned].sort()).toEqual(
      ["#buddies", "#rail", "#rightcol", "#sidecol", "#stage", "#toggle"],
    );
  });

  // `relative` counts as rejoining the flow — it offsets from the flowed position, not from a
  // viewport edge — but only while the tier sets no offsets to displace it by. `#stage` uses it.
  for (const sel of positioned) {
    it(`${sel} is placed by the flow at ${narrow.width}px`, () => {
      const { position, insets } = placement(narrow.body, sel);
      expect(position, `${sel} keeps its wide-tier offsets`).toMatch(/^(static|relative)$/);
      if (position === "relative") expect(insets).toEqual([]);
    });
  }
});
