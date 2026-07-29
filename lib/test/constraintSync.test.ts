/**
 * A mechanical guard for the three-site hard-constraint contract in `constrainedGreedy.ts`.
 *
 * The module's own comment states it: "a new hard-constraint kind must be enforced in legalEdge
 * (used by both completion and forceConnect), swapBreaksConstraint, AND asserted here — keep the
 * three in sync." Until now the only thing keeping them in sync was that comment. The three sites
 * genuinely do different jobs — a can-this-edge-be-added predicate, a is-this-swap-legal predicate
 * and a dev-mode postcondition — so folding them into one abstraction would be forcing three
 * different questions through one function to satisfy a coupling that is real but is a coupling of
 * COVERAGE, not of logic. What is checkable is the coverage: whichever constraint kinds one site
 * consults, the other two must consult too.
 *
 * This reads the source rather than the behaviour on purpose. The drift it catches — a fourth
 * constraint kind wired into the generator but not into the swap check — has no test that could
 * fail on it, because the kind would not exist yet to be exercised.
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
 * Which CONSTRAINT KINDS a body consults, normalized across the two spellings each has: a
 * membership probe (`isRequired`) and an enumeration (`requiredPairs`). An unrecognised accessor
 * maps to its own bare name, so a genuinely new kind shows up as a set difference rather than
 * being silently folded into an existing one — the check fails closed.
 */
function kindsUsedIn(body: string): Set<string> {
  const kinds = new Set<string>();
  for (const [, accessor] of body.matchAll(/\bcons\.(\w+)/g)) {
    // `n` is the roster size, not a constraint kind; priors are SOFT (a polish penalty) and are
    // deliberately absent from all three hard-constraint sites.
    if (accessor === "n" || accessor.startsWith("prior")) continue;
    kinds.add(accessor.replace(/^is/, "").replace(/Pairs$/, "").toLowerCase());
  }
  return kinds;
}

describe("the hard-constraint enforcement sites stay in sync with the postcondition", () => {
  // Not "all sites consult all kinds" — that is false and would be the wrong invariant to pin.
  // `legalEdge` only ever ADDS an edge, so the only kind it can violate is `prohibited`; the
  // sites that REMOVE one (`swapBreaksConstraint`, `swapJoin`, `stealSlot`) must also refuse to
  // drop a `required` edge. What must hold is that the postcondition asserts exactly the kinds
  // the enforcement sites between them enforce: a kind enforced nowhere but asserted is a
  // guarantee nothing upholds, and a kind enforced somewhere but never asserted is a guarantee
  // nothing checks.
  // Classified by what each site can DO to an edge, which is what decides the kinds it owes a
  // check to — not by a per-site list of expected accessors, which would just restate the code.
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
      // Non-vacuity per site: a broken `bodyOf` or an over-tightened accessor filter would make
      // every set empty and the union comparison trivially true.
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
    // And they are the two documented hard kinds today, so a third arriving anywhere shows up
    // here rather than in a user's graph.
    expect([...asserted].sort()).toEqual(["prohibited", "required"]);
  });
});
