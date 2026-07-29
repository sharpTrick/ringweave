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

const APP_CSS = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

/**
 * The stylesheet as segments IN SOURCE ORDER — each `@media (max-width: Npx)` block, and each run
 * of rules between them. Source order is the point: `@media` adds no specificity, so a base rule
 * written AFTER a media block beats it, and collecting all the base rules into one leading segment
 * reports the opposite.
 */
function tiers(css: string): { width: number; body: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: { width: number; body: string }[] = [];
  let at = 0;
  while (at < stripped.length) {
    const m = /@media[^{]*\(max-width:\s*(\d+)px\)[^{]*\{/.exec(stripped.slice(at));
    if (!m) {
      found.push({ width: Infinity, body: stripped.slice(at) });
      break;
    }
    found.push({ width: Infinity, body: stripped.slice(at, at + m.index) });
    let depth = 1;
    let i = at + m.index + m[0].length;
    const start = i;
    for (; i < stripped.length && depth > 0; i++) {
      if (stripped[i] === "{") depth++;
      else if (stripped[i] === "}") depth--;
    }
    found.push({ width: Number(m[1]), body: stripped.slice(start, i - 1) });
    at = i;
  }
  return found;
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

const INSET = /(?:^|;)\s*(top|right|bottom|left|inset)\s*:\s*([^;]+)/g;
const POSITION = /(?:^|;)\s*position\s*:\s*([\w-]+)/g;

/**
 * How `selector` is placed at `width`, evaluated over the CASCADE rather than over one block: a
 * panel demoted to `relative` in the narrow tier still inherits every offset the wider tiers set,
 * and a block-local read reports it as carrying none.
 */
function placementAt(all: ReturnType<typeof tiers>, selector: string, width: number) {
  const decls = all.filter((t) => t.width >= width)
    .map((t) => simpleRules(t.body).get(selector) ?? "").join(";");
  const position = [...decls.matchAll(POSITION)].pop()?.[1] ?? null;
  // Last declaration wins per property, so an offset re-set to `auto` in a narrower tier is gone.
  const insets = new Map<string, string>();
  for (const m of decls.matchAll(INSET)) insets.set(m[1], m[2].trim());
  return {
    position,
    insets: [...insets].filter(([, v]) => !/^auto$/.test(v)).map(([k, v]) => `${k}: ${v}`),
  };
}

/**
 * Not panels, each for a stated reason — an allow-list rather than an omission, so adding a
 * viewport-fixed element is a decision someone writes down here.
 *
 * The live regions are clipped to 1px on purpose and render nothing. The rest COVER the viewport
 * rather than sit at an offset within it: `#app` is the shell every panel is inside, and the three
 * overlays are meant to follow the viewport at every width — that is what makes them overlays.
 */
const NOT_PANELS = new Set([".sr-live", ".busy-live", "#app", "#modal", ".busy", ".toast"]);

/** `absolute` and `fixed` alike: both place a box against a viewport edge rather than the flow,
    which is the property this file is about. */
const VIEWPORT_RELATIVE = new Set(["absolute", "fixed"]);

/** Selectors the cascade places against the viewport at any tier, including the narrowest one. */
function positionedSelectors(all: ReturnType<typeof tiers>): string[] {
  const names = new Set<string>();
  for (const tier of all) {
    for (const sel of simpleRules(tier.body).keys()) if (!NOT_PANELS.has(sel)) names.add(sel);
  }
  // One width just inside each tier, plus one above them all — every width where the cascade can
  // produce a different answer.
  const widths = [Number.MAX_SAFE_INTEGER, ...all.map((t) => t.width).filter(Number.isFinite)];
  return [...names]
    .filter((sel) => widths.some((w) => VIEWPORT_RELATIVE.has(placementAt(all, sel, w).position ?? "")))
    .sort();
}

/** Every complaint the guard makes about `css`; empty when the stylesheet strands nothing. */
function strandedPanels(css: string): string[] {
  const all = tiers(css);
  const narrow = Math.min(...all.map((t) => t.width));
  const out: string[] = [];
  for (const sel of positionedSelectors(all)) {
    const { position, insets } = placementAt(all, sel, narrow);
    // `relative` counts as rejoining the flow — it offsets from the flowed position, not from a
    // viewport edge — but only while nothing displaces it. `#stage` uses it.
    if (position !== "static" && position !== "relative") {
      out.push(`${sel} is ${position} at ${narrow}px`);
    } else if (position === "relative" && insets.length > 0) {
      out.push(`${sel} is relative at ${narrow}px but still carries ${insets.join(", ")}`);
    }
  }
  return out;
}

describe("every absolutely-positioned panel rejoins the flow at phone width", () => {
  it("finds the panels to check", () => {
    // Non-vacuity: an empty set would make the assertion below pass by having nothing to check.
    expect(positionedSelectors(tiers(APP_CSS))).toEqual(
      ["#buddies", "#rail", "#rightcol", "#sidecol", "#stage", "#toggle"],
    );
  });

  it("strands none of them", () => {
    expect(strandedPanels(APP_CSS)).toEqual([]);
  });
});

describe("the guard itself", () => {
  const NARROW = "@media (max-width: 820px) { #stage { position: relative } }";

  it("catches a panel the narrow tier never names — the defect that shipped", () => {
    const css = `#sidecol { position: absolute; right: 314px; width: 250px }\n${NARROW}`;
    expect(strandedPanels(css)).toEqual(["#sidecol is absolute at 820px"]);
  });

  it("catches an offset INHERITED from a wider tier, which a block-local read cannot see", () => {
    // The narrow tier demotes it to `relative` and says nothing about `left`, so reading only that
    // block reports no offsets — while the browser computes `relative; left: 300px` and pushes the
    // panel 300px off a 390px viewport.
    const css = `#stage { position: absolute; left: 300px }\n${NARROW}`;
    expect(strandedPanels(css)).toEqual(["#stage is relative at 820px but still carries left: 300px"]);
  });

  it("catches a panel that only becomes absolute INSIDE the narrow tier", () => {
    const css = "#rail { color: red }\n@media (max-width: 820px) { #rail { position: absolute; left: 9px } }";
    expect(strandedPanels(css)).toEqual(["#rail is absolute at 820px"]);
  });

  it("catches a base rule written AFTER the narrow tier, which beats it in source order", () => {
    // `@media` adds no specificity, so this later rule wins at every width — the browser computes
    // `absolute; left: 500px` at 390px. Reading the base rules as one leading segment reports the
    // narrow tier as the last word and calls it flow-placed.
    const css = `#rail { position: absolute }\n${NARROW}\n#rail { position: absolute; left: 500px }`;
    expect(strandedPanels(css)).toEqual(["#rail is absolute at 820px"]);
  });

  it("catches a FIXED panel, which is stranded for exactly the same reason", () => {
    const css = `#newpanel { position: fixed; top: 14px; left: 700px }\n${NARROW}`;
    expect(strandedPanels(css)).toEqual(["#newpanel is fixed at 820px"]);
  });

  it("accepts an offset the narrow tier withdraws", () => {
    const css = "#rail { position: absolute; left: 300px }\n" +
      "@media (max-width: 820px) { #rail { position: relative; left: auto } }";
    expect(strandedPanels(css)).toEqual([]);
  });
});
