/**
 * Mechanical hygiene checks for the classes oxlint and knip cannot see.
 *
 * These exist because `docs/REVIEW_PROTOCOL.md` takes lint classes off the adversarial critics'
 * plate, and E1's most-repeated finding labels were exactly these three: stale comments, dead CSS
 * hooks, and a literal silently mirroring a named constant. A critic finding them costs a whole
 * review round; a script finds them in milliseconds and never gets bored.
 *
 * Every check is deliberately tuned for a low **effective** false-positive rate (Tricorder's bar:
 * an issue nobody acts on is a false positive, however technically correct). Where a check cannot
 * be precise it is narrowed rather than made noisy, and the narrowing is stated. In particular,
 * "stale comment" is only partly mechanizable: a comment whose prose is now false but whose
 * identifiers all still exist is undetectable here. That gap is real and is recorded rather than
 * papered over.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, extname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Roots are overridable so `selftest.mjs` can point the very same checks at deliberate-violation
// fixtures and prove each one still fires. A hygiene check that silently stopped working would
// otherwise look identical to a clean tree.
const SOURCE_ROOTS =
  process.argv.length > 2
    ? process.argv.slice(2).map((p) => join(ROOT, p))
    : [join(ROOT, "lib", "src"), join(ROOT, "app", "src")];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const sourceFiles = SOURCE_ROOTS.flatMap(walk);
const codeFiles = sourceFiles.filter((f) => [".ts", ".tsx"].includes(extname(f)));
const cssFiles = sourceFiles.filter((f) => extname(f) === ".css");
const read = (() => {
  const cache = new Map();
  return (f) => {
    if (!cache.has(f)) cache.set(f, readFileSync(f, "utf8"));
    return cache.get(f);
  };
})();
const rel = (f) => relative(ROOT, f);

const failures = [];
const report = (check, file, detail) => failures.push({ check, file: rel(file), detail });

// ---------------------------------------------------------------------------------------------
// 1. Stale comment references.
//
// A comment naming a symbol that no longer exists is a comment that lies. Only UNAMBIGUOUS code
// references are considered — a backticked token that is camelCase, PascalCase or SCREAMING_SNAKE
// — because prose words in backticks (`npm test`, `--flag`) would otherwise flood this with noise.
// A single-word lowercase token is skipped for the same reason.
// ---------------------------------------------------------------------------------------------
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const BACKTICKED = /`([^`\n]+)`/g;
const LOOKS_LIKE_SYMBOL = /^(?:[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z][a-zA-Z0-9]*[a-z][a-zA-Z0-9]*|[A-Z][A-Z0-9]*_[A-Z0-9_]+)$/;

// The existence haystack is WIDER than the scanned set: we only inspect comments under lib/src and
// app/src, but a comment there may legitimately name a symbol living elsewhere in the repo — e.g.
// feasibility.ts says it mirrors "the mock's `checkNote`", which really is at mock/app.js:314.
// Scanning narrowly and searching widely is what keeps this precise in both directions.
//
// Comments MUST also be stripped before asking "does this symbol still exist?" — otherwise the
// comment under test is part of its own haystack, every reference resolves to itself, and the
// check can never fire. (Both of these were real bugs, caught by selftest.mjs.)
const HAYSTACK_EXTRA = [join(ROOT, "mock")].filter((d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
});
const allCode = [...codeFiles, ...HAYSTACK_EXTRA.flatMap(walk).filter((f) => /\.(js|html|css)$/.test(f))]
  .map((f) => read(f).replace(COMMENT, " "))
  .join("\n");
for (const file of codeFiles) {
  for (const comment of read(file).match(COMMENT) ?? []) {
    for (const [, token] of comment.matchAll(BACKTICKED)) {
      const name = token.replace(/\(\)$/, "").trim();
      if (!LOOKS_LIKE_SYMBOL.test(name)) continue;
      if (new RegExp(`\\b${name}\\b`).test(allCode)) continue;
      report("stale-comment-ref", file, `comment references \`${name}\`, which no longer exists`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Dead CSS hooks.
//
// A class or id selector no source file mentions anywhere. Membership is checked against the raw
// source text rather than parsed className expressions, because classes are legitimately built by
// concatenation ("node " + state). That makes this deliberately permissive: it only catches a hook
// nothing references at all, which is exactly the rename-residue case, with near-zero FPs.
// ---------------------------------------------------------------------------------------------
const SELECTOR = /(?:^|[\s,>+~(])([.#][a-zA-Z_][\w-]*)/g;
const cssHooks = new Map();
for (const file of cssFiles) {
  // Scan SELECTORS only — strip every declaration block first. Without this, colour values like
  // `#eef2fb` parse as id selectors and every token in the palette becomes a "dead hook".
  const selectorsOnly = read(file).replace(/\{[^{}]*\}/g, " { } ");
  for (const [, sel] of selectorsOnly.matchAll(SELECTOR)) {
    if (!cssHooks.has(sel)) cssHooks.set(sel, file);
  }
}
for (const [sel, file] of cssHooks) {
  const bare = sel.slice(1);
  if (new RegExp(`\\b${bare.replace(/-/g, "\\-")}\\b`).test(allCode)) continue;
  report("dead-css-hook", file, `selector \`${sel}\` is referenced by no source file`);
}

// ---------------------------------------------------------------------------------------------
// 3. Constants mirrored as literals.
//
// A file that ALREADY IMPORTS a module, then hardcodes the numeric value of one of that module's
// exported constants, is drift waiting to happen — change the constant and the literal silently
// disagrees. Requiring the import is what keeps this precise: without it, every coincidental `5`
// in the codebase would be a finding. Small/common values are skipped for the same reason.
// ---------------------------------------------------------------------------------------------
const COMMON = new Set([0, 1, 2, 3, 4, 10, 100, 1000, -1]);
const EXPORTED_CONST = /export const ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(-?\d+(?:\.\d+)?)\s*(?:\*\*\s*(\d+))?/g;

const constants = [];
for (const file of codeFiles) {
  for (const [, name, raw, exponent] of read(file).matchAll(EXPORTED_CONST)) {
    const value = exponent ? Number(raw) ** Number(exponent) : Number(raw);
    if (!COMMON.has(value)) constants.push({ name, value, file });
  }
}
for (const file of codeFiles) {
  const text = read(file);
  const stripped = text.replace(COMMENT, "");
  for (const { name, value, file: origin } of constants) {
    if (file === origin) continue;
    // Only if this file already has the defining module in scope — otherwise the literal may be
    // an unrelated coincidence rather than a missed reference.
    const originModule = rel(origin).replace(/\.tsx?$/, "").split("/").pop();
    const imports = new RegExp(`from\\s+["'][^"']*${originModule}["']|from\\s+["']ringweave["']`).test(text);
    if (!imports) continue;
    if (new RegExp(`\\b${name}\\b`).test(stripped)) continue; // uses the constant properly
    // A value bound to its OWN named constant is a deliberate, independently-named concept, not
    // drift — two thresholds are allowed to coincide numerically. (app/src/model.ts:53 documents
    // exactly such a pair: POLISH_MAX_N and layout.ts's unrelated FORCE_TICK_KNEE_N, which a
    // review already adjudicated as "don't consolidate them".) Only BARE literals are drift.
    const bare = new RegExp(`(?<!const\\s+[A-Z_][A-Z0-9_]*\\s*(?::[^=\\n]+)?=\\s*)(?<![\\w.])${value}(?![\\w.])`);
    if (!bare.test(stripped)) continue;
    report("mirrored-constant", file, `hardcodes ${value}, the value of \`${name}\` (${rel(origin)})`);
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Critic frontmatter must agree with the runner.
//
// `.claude/workflows/adversarial-review.js` holds the EXECUTABLE gating config (each lens's model,
// surface globs and saturation gate) because workflow scripts have no filesystem access and cannot
// read the agent definitions. The critic `.md` frontmatter carries the same values for anyone
// reading the agent file. Two copies of a fact drift, and here the drift is invisible: a surface
// that disagrees would silently gate the wrong lens, producing a review round with a hole in it
// that still reports converged. So the two are compared mechanically.
// ---------------------------------------------------------------------------------------------
const AGENTS_DIR = join(ROOT, ".claude", "agents");
const RUNNER = join(ROOT, ".claude", "workflows", "adversarial-review.js");
let agentFiles = [];
try {
  agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.startsWith("critic-") && f.endsWith(".md"));
} catch {
  /* no agents dir — nothing to cross-check */
}
if (agentFiles.length > 0) {
  const runner = readFileSync(RUNNER, "utf8");
  const blocks = [...runner.matchAll(/\{\s*type:\s*'(critic-[\w-]+)',\s*model:\s*'(\w+)',\s*saturationGate:\s*(\d+),\s*surface:\s*(\[[^\]]*\])/g)];
  const runnerLenses = new Map(
    blocks.map(([, type, model, gate, surface]) => [
      type,
      { model, gate: Number(gate), surface: JSON.parse(surface.replace(/'/g, '"')) },
    ]),
  );

  for (const file of agentFiles) {
    const path = join(AGENTS_DIR, file);
    const fm = readFileSync(path, "utf8").split(/^---$/m)[1] ?? "";
    const name = /^name:\s*(\S+)/m.exec(fm)?.[1];
    const model = /^model:\s*(\S+)/m.exec(fm)?.[1];
    const gate = /^saturation_gate:\s*(\d+)/m.exec(fm)?.[1];
    const surfaceRaw = /^surface:\s*(\[.*\])/m.exec(fm)?.[1];

    const inRunner = runnerLenses.get(name);
    if (!inRunner) {
      report("critic-runner-drift", path, `\`${name}\` has no entry in adversarial-review.js — it would never run`);
      continue;
    }
    if (model !== inRunner.model) {
      report("critic-runner-drift", path, `model \`${model}\` but the runner spawns it on \`${inRunner.model}\``);
    }
    if (Number(gate) !== inRunner.gate) {
      report("critic-runner-drift", path, `saturation_gate ${gate} but the runner gates at ${inRunner.gate}`);
    }
    const surface = surfaceRaw ? JSON.parse(surfaceRaw.replace(/'/g, '"')) : null;
    if (!surface || JSON.stringify(surface) !== JSON.stringify(inRunner.surface)) {
      report("critic-runner-drift", path, `surface globs disagree with the runner's copy for \`${name}\``);
    }
  }
  for (const name of runnerLenses.keys()) {
    if (!agentFiles.some((f) => f === `${name}.md`)) {
      report("critic-runner-drift", RUNNER, `runner spawns \`${name}\` but .claude/agents/${name}.md does not exist`);
    }
  }
}

// ---------------------------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`hygiene: ${failures.length} issue(s)\n`);
  for (const { check, file, detail } of failures) console.error(`  ${check}  ${file}\n      ${detail}`);
  console.error("");
  process.exit(1);
}
console.log(
  `hygiene: clean (${codeFiles.length} source files, ${cssHooks.size} css hooks, ${constants.length} exported constants)`,
);
