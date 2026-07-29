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
// Roots are overridable so `oracle-check.mjs` can aim these same checks at deliberate-violation
// fixtures: a check that silently stopped firing looks identical to a clean tree.
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
// 1. Stale comment references: a backticked token naming a symbol that no longer exists. Catches
// only camelCase / PascalCase / SCREAMING_SNAKE tokens, so a lowercase or multi-word reference goes
// unchecked — prose in backticks (`npm test`, `--flag`) would otherwise flood this with noise.
// ---------------------------------------------------------------------------------------------
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const BACKTICKED = /`([^`\n]+)`/g;
const LOOKS_LIKE_SYMBOL = /^(?:[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z][a-zA-Z0-9]*[a-z][a-zA-Z0-9]*|[A-Z][A-Z0-9]*_[A-Z0-9_]+)$/;

// The haystack is WIDER than the scanned set, because a comment under lib/src may legitimately name
// a symbol living elsewhere in the repo. Comments are stripped from it, or the comment under test
// is part of its own haystack, every reference resolves to itself, and the check can never fire.
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
// Platform globals are never DECLARED in this repo, so "does the source contain it" is the wrong
// question for them. Keep this list to genuine globals — anything a repo symbol could plausibly
// shadow must stay checkable.
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
// 2. Dead CSS hooks: a class or id selector no source file mentions anywhere. Membership is tested
// against raw source text, because classes are legitimately built by concatenation ("node " + state)
// — so this catches only a hook nothing references at all, not one referenced from dead code.
// ---------------------------------------------------------------------------------------------
const SELECTOR = /(?:^|[\s,>+~(])([.#][a-zA-Z_][\w-]*)/g;
const cssHooks = new Map();
for (const file of cssFiles) {
  // Strip declaration blocks first, or colour values like `#eef2fb` parse as id selectors and every
  // token in the palette becomes a "dead hook".
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
// 3. Constants mirrored as literals: a file that ALREADY IMPORTS a module then hardcodes the value
// of one of its exported constants, so changing the constant leaves the literal silently
// disagreeing. Requiring the import, and skipping COMMON values, is what stops every coincidental
// `5` being a finding — and is also why a mirror in a file with no such import goes unseen.
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
    const originModule = rel(origin).replace(/\.tsx?$/, "").split("/").pop();
    const imports = new RegExp(`from\\s+["'][^"']*${originModule}["']|from\\s+["']ringweave["']`).test(text);
    if (!imports) continue;
    if (new RegExp(`\\b${name}\\b`).test(stripped)) continue;
    // Only BARE literals are drift: a value bound to its OWN named constant is an independently
    // named concept, and two thresholds are allowed to coincide numerically.
    const bare = new RegExp(`(?<!const\\s+[A-Z_][A-Z0-9_]*\\s*(?::[^=\\n]+)?=\\s*)(?<![\\w.])${value}(?![\\w.])`);
    if (!bare.test(stripped)) continue;
    report("mirrored-constant", file, `hardcodes ${value}, the value of \`${name}\` (${rel(origin)})`);
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Critic frontmatter must agree with the runner. `.claude/workflows/adversarial-review.js` holds
// the EXECUTABLE gating config and the critic `.md` frontmatter repeats it, because workflow scripts
// cannot read the agent files. The drift is invisible without this: a disagreeing surface silently
// gates the wrong lens, producing a review round with a hole in it that still reports converged.
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
// 5. Untracked test files: scratch harnesses left behind by a tool or an agent, which vitest picks
// up and which read as failing tests. git is the oracle — a test-shaped file no one has staged is
// not a test, it is residue.
//
// Scanned across the WHOLE TREE, not a list of test directories: directory names are unbounded,
// `*.test.*` is not. It therefore cannot see residue that is not test-shaped by name.
// `--exclude-standard` hides .gitignore'd paths, so the sanctioned `.review-scratch/` is invisible
// by construction and no allowlist is needed here.
// ---------------------------------------------------------------------------------------------
{
  const out = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  // Skip on a failing git rather than failing the lint gate for a reason unrelated to the tree.
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
