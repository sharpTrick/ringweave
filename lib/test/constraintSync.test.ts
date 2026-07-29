/**
 * This reads `constrainedGreedy.ts`'s SOURCE rather than its behaviour on purpose: the drift it
 * catches — a fourth hard-constraint kind wired into the generator but not into the swap check —
 * has no test that could fail on it, because the kind would not exist yet to be exercised.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/core/constrainedGreedy.ts"), "utf8");

/** The body of a top-level `function name(...) {...}`, by brace matching. */
function bodyOf(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `function ${name} not found`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/**
 * Which CONSTRAINT KINDS a body consults, normalized across the two spellings each has (a
 * membership probe `isRequired` and an enumeration `requiredPairs`). An unrecognised accessor maps
 * to its own bare name, so a genuinely new kind shows up as a set difference rather than being
 * folded into an existing one — the check fails closed.
 */
function kindsUsedIn(body: string): Set<string> {
  const kinds = new Set<string>();
  for (const [, accessor] of body.matchAll(/\bcons\.(\w+)/g)) {
    // `n` is the roster size, not a constraint kind; priors are SOFT and are deliberately absent
    // from all three hard-constraint sites.
    if (accessor === "n" || accessor.startsWith("prior")) continue;
    kinds.add(accessor.replace(/^is/, "").replace(/Pairs$/, "").toLowerCase());
  }
  return kinds;
}

describe("the hard-constraint enforcement sites stay in sync with the postcondition", () => {
  const enforcement = {
    legalEdge: "adds",
    swapBreaksConstraint: "rewires",
    swapJoin: "rewires",
    stealSlot: "rewires",
  } as const;

  it("the postcondition asserts exactly the kinds the generator enforces", () => {
    const enforced = new Set<string>();
    for (const [site, kind] of Object.entries(enforcement)) {
      const kinds = kindsUsedIn(bodyOf(site));
      // Non-vacuity: a broken `bodyOf` or an over-tightened accessor filter would make every set
      // empty and the union comparison trivially true.
      expect(kinds.size, `${site} consults no constraint kind`).toBeGreaterThan(0);
      // Adding an edge can only create a prohibited one; rewiring can also DROP a required one,
      // so a site that removes owes both checks.
      expect([...kinds].sort(), `${site} (${kind}) checks the wrong kinds`).toEqual(
        kind === "adds" ? ["prohibited"] : ["prohibited", "required"],
      );
      for (const k of kinds) enforced.add(k);
    }
    const asserted = kindsUsedIn(bodyOf("assertHardConstraints"));
    expect([...enforced].sort()).toEqual([...asserted].sort());
    // Pinned to the two documented hard kinds, so a third arriving anywhere shows up here rather
    // than in a user's graph.
    expect([...asserted].sort()).toEqual(["prohibited", "required"]);
  });
});
