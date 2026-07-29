/**
 * Mechanical hygiene checks for the classes oxlint and knip cannot see. Each check below states
 * what it catches and what it does not; the narrowings are deliberate, not accidental.
 *
 * The largest gap: "stale comment" is only partly mechanizable. A comment whose prose is now false
 * but whose identifiers all still exist is undetectable here, so a clean run is not evidence that
 * the comments are true.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
// Language and platform globals are real identifiers that are correctly never DECLARED in
// this repo, so "does the source contain it" is the wrong question for them. Without this the
// check fires on a comment saying a NaN weight poisons a comparison — which is exactly the
// kind of comment it should be encouraging. Kept to genuine globals: anything a repo symbol
// could plausibly shadow stays checkable.
const PLATFORM_GLOBALS = new Set([
  "NaN", "Infinity", "undefined", "null", "globalThis",
  "Math", "JSON", "Number", "String", "Boolean", "Object", "Array", "Set", "Map",
  "Promise", "Symbol", "BigInt", "Error", "TypeError", "RangeError", "RegExp", "Date",
  "Int32Array", "Uint8Array", "Float64Array", "ArrayBuffer",
  "Worker", "MessageEvent", "Blob", "File", "FileReader", "URL", "TextEncoder",
]);

for (const file of codeFiles) {
  for (const comment of read(file).match(COMMENT) ?? []) {
    for (const [, token] of comment.matchAll(BACKTICKED)) {
      const name = token.replace(/\(\)$/, "").trim();
      if (!LOOKS_LIKE_SYMBOL.test(name)) continue;
      if (PLATFORM_GLOBALS.has(name)) continue;
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
  const blocks = [...runner.matchAll(/\{\s*type:\s*'(critic-[\w-]+)',\s*model:\s*'(\w+)',\s*effort:\s*'(\w+)',\s*saturationGate:\s*(\d+),\s*surface:\s*(\[[^\]]*\])/g)];
  const runnerLenses = new Map(
    blocks.map(([, type, model, effort, gate, surface]) => [
      type,
      { model, effort, gate: Number(gate), surface: JSON.parse(surface.replace(/'/g, '"')) },
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
    const effort = /^effort:\s*(\S+)/m.exec(fm)?.[1];
    if (effort !== inRunner.effort) {
      report("critic-runner-drift", path, `effort \`${effort}\` but the runner spawns it at \`${inRunner.effort}\``);
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
// 5. Untracked test files.
//
// Review lenses have Bash access on purpose — it is what lets them measure instead of speculate,
// and one of them examined 432,954 fragmenting graph swaps to check a fix. But nothing tells an
// agent to clean up, and one left a scratch harness at lib/test/zz_frag.test.ts. Vitest picked it
// up, it ran 90 s and timed out, and on the next `npm test` it read as two FAILING tests — which
// looks exactly like a regression in the fix that had just been made. Committed, it would have
// broken CI.
//
// git is the oracle here: a file under a test directory that no one has staged is not a test, it is
// residue. Cheap, and it cannot be argued with.
//
// WIDENED, because the first version of this check knew only two directories and the hazard did not.
// It recurred four times in one run, in four different places: lib/test/zz_frag.test.ts,
// app/test/tmpbench/, app/test/zz_probe.test.ts, and then app/zz-scratch/ — which was outside the two
// paths this check scanned and so sailed straight past it. Fixing the case and calling the theme
// closed is the anti-pattern REVIEW_PROTOCOL.md names, and this check had committed it. So the scan
// is now the WHOLE TREE for anything test-shaped: directory names are unbounded, `*.test.*` is not.
//
// `--exclude-standard` means .gitignore'd paths never appear, so the sanctioned `.review-scratch/`
// (and any other scratch directory the ignore file blesses) is invisible here by construction — a
// designated place to work, exactly as intended, with no allowlist to maintain in this file.
// ---------------------------------------------------------------------------------------------
{
  const out = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  // A missing or failing git is not this check's business to diagnose — skip rather than fail the
  // lint gate for a reason unrelated to the tree's contents.
  if (out.status === 0) {
    for (const line of out.stdout.split("\n").map((x) => x.trim()).filter(Boolean)) {
      if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(line)) continue;
      report(
        "untracked-test-file",
        line,
        "untracked test-shaped file — scratch left behind by a tool or an agent. Delete it, " +
          "`git add` it, or work under .review-scratch/ (gitignored, and outside both packages' " +
          "vitest include globs).",
      );
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
