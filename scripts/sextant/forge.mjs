/**
 * Build and admit the Sextant seeded-defect corpus.
 *
 * One git worktree per seed (one defect each, so seeds can never interact), seed applied, corpus
 * information stripped, admission gates run.
 *
 * Usage:
 *   node scripts/sextant/forge.mjs --check            # gates only, no worktrees kept
 *   node scripts/sextant/forge.mjs --build            # build worktrees and keep them, for review
 *   node scripts/sextant/forge.mjs --clean            # remove all worktrees
 *
 * INFORMATION LEAK. A worktree is a copy of the repo, so a naive one contains the seed manifest,
 * this script and the write-up — and a critic has Read/Grep/Bash, which would make recall
 * meaningless and unfixable after the fact. Every worktree has them REMOVED before any review runs,
 * verified by `assertNoLeak` rather than assumed.
 *
 * STRATUM R SEEDS ARE GUARDED BY CONSTRUCTION: every confirmed E1 finding was ratcheted into a test,
 * so re-introducing a historical defect fails its guard and the "suite stays green" gate. Such a
 * seed therefore also removes that guard, and the manifest records which — so what the stratum
 * measures is "a real historical defect with its guard removed", not "a reverted fix".
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKTREES = join(ROOT, ".sextant-worktrees");
const DEFS = join(ROOT, "scripts/sextant/seed-defs.json");
const OUT = join(ROOT, "docs/findings/critical-review/2026-07-25-sextant/data/admission.json");

const sh = (cmd, cwd = ROOT, timeout = 600_000) =>
  execFileSync("bash", ["-lc", cmd], { cwd, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
const trySh = (cmd, cwd = ROOT, timeout = 600_000) => {
  try {
    return { ok: true, out: sh(cmd, cwd, timeout) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

/** Paths whose presence in a worktree would let a critic look up the answer. */
const LEAKY = [
  "scripts/sextant",
  "docs/findings/critical-review",
  ".sextant-worktrees",
];

function stripLeaks(dir) {
  for (const p of LEAKY) rmSync(join(dir, p), { recursive: true, force: true });
}

function assertNoLeak(dir, seedId) {
  for (const p of LEAKY) {
    if (existsSync(join(dir, p))) throw new Error(`LEAK: ${p} still present in worktree for ${seedId}`);
  }
  // The DESCRIPTIVE seed id must appear nowhere a critic can read. `.git` is excluded because it
  // legitimately records the worktree's own directory name — which is why slots are opaque.
  const hit = trySh(
    `grep -rl --binary-files=without-match --exclude-dir=.git ${JSON.stringify(seedId)} . 2>/dev/null | head -3`,
    dir,
    120_000,
  );
  if (hit.ok && hit.out.trim()) throw new Error(`LEAK: seed id ${seedId} appears in ${hit.out.trim().split("\n").join(", ")}`);
}

/** Apply one edit: assert the anchor occurs EXACTLY once, then replace it. Fails loudly otherwise —
    a silently-unapplied seed would be scored as "not found" and read as a blind spot. */
function applyEdit(dir, edit) {
  const path = join(dir, edit.file);
  const before = readFileSync(path, "utf8");
  const n = before.split(edit.find).length - 1;
  if (n !== 1) throw new Error(`anchor for ${edit.file} matched ${n} times (need exactly 1): ${edit.find.slice(0, 60)}`);
  writeFileSync(path, before.replace(edit.find, edit.replace), "utf8");
}

/** Lines with at least one executed statement, per file, from a v8 coverage report. */
function coveredLines(covPath) {
  if (!existsSync(covPath)) return null;
  const cov = JSON.parse(readFileSync(covPath, "utf8"));
  const map = new Map();
  for (const [abs, d] of Object.entries(cov)) {
    const rel = abs.replace(/^.*?((?:lib|app)\/)/, "$1");
    const lines = map.get(rel) ?? new Set();
    for (const [id, count] of Object.entries(d.s ?? {})) {
      if (count > 0) {
        const loc = d.statementMap?.[id];
        if (loc) for (let l = loc.start.line; l <= loc.end.line; l++) lines.add(l);
      }
    }
    map.set(rel, lines);
  }
  return map;
}

const defs = JSON.parse(readFileSync(DEFS, "utf8"));
const mode = process.argv.includes("--build") ? "build" : process.argv.includes("--clean") ? "clean" : "check";

if (mode === "clean") {
  const all = [...defs.seeds, ...defs.controls];
  all.forEach((_s, i) => trySh(`git worktree remove --force ${JSON.stringify(join(WORKTREES, `wt-${String(i + 1).padStart(2, "0")}`))}`));
  trySh("git worktree prune");
  rmSync(WORKTREES, { recursive: true, force: true });
  console.log("worktrees removed");
  process.exit(0);
}

mkdirSync(WORKTREES, { recursive: true });
const head = sh("git rev-parse HEAD").trim();
const results = [];

const allSeeds = [...defs.seeds, ...defs.controls];
// The critic is handed the target PATH, so the directory name must carry no information about the
// defect — `wt-07`, never `sd-01-roster-cap-offbyone`. The slot->seed mapping lives only in
// admission.json, outside every worktree.
const slotOf = new Map(allSeeds.map((s, i) => [s.id, `wt-${String(i + 1).padStart(2, "0")}`]));

for (const seed of allSeeds) {
  const slot = slotOf.get(seed.id);
  const dir = join(WORKTREES, slot);
  const isControl = !seed.edits;
  process.stdout.write(`${seed.id.padEnd(22)} `);

  trySh(`git worktree remove --force ${JSON.stringify(dir)}`);
  const made = trySh(`git worktree add --detach ${JSON.stringify(dir)} ${head}`);
  if (!made.ok) {
    console.log(`WORKTREE FAILED\n${made.out.slice(0, 300)}`);
    results.push({ id: seed.id, slot, admitted: false, reason: "worktree-failed" });
    continue;
  }

  const gates = {};
  try {
    for (const e of seed.edits ?? []) applyEdit(dir, e);
    stripLeaks(dir);
    assertNoLeak(dir, seed.id);
    gates.applied = true;
  } catch (e) {
    console.log(`APPLY FAILED: ${e.message}`);
    results.push({ id: seed.id, slot, admitted: false, reason: `apply-failed: ${e.message}` });
    trySh(`git worktree remove --force ${JSON.stringify(dir)}`);
    continue;
  }

  // Symlinked from the main checkout rather than installed per seed: the dependency tree is
  // identical by construction (same HEAD, same lockfiles), and per-seed installs would dominate the
  // runtime.
  trySh(`ln -sfn ${JSON.stringify(join(ROOT, "node_modules"))} node_modules`, dir);
  trySh(`ln -sfn ${JSON.stringify(join(ROOT, "lib/node_modules"))} lib/node_modules`, dir);
  trySh(`ln -sfn ${JSON.stringify(join(ROOT, "app/node_modules"))} app/node_modules`, dir);
  trySh(`ln -sfn ${JSON.stringify(join(ROOT, "lib/dist"))} lib/dist`, dir);

  const tc = trySh("npm run typecheck --silent", join(dir, "app"), 300_000);
  gates.typecheck = tc.ok;
  const libTest = seed.edits?.some((e) => e.file.startsWith("lib/")) ? trySh("npm test --silent", join(dir, "lib"), 600_000) : { ok: true };
  const appTest = trySh("npm test --silent", join(dir, "app"), 900_000);
  gates.tests = libTest.ok && appTest.ok;
  // The FULL gate — the same command the review protocol requires to be clean before a critic is
  // spawned. oxlint alone leaves knip and the custom hygiene checks unrun, which makes `lint=y`
  // worthless as evidence that the linter misses a defect, and that is what the oracle probes test.
  const lint = trySh("npm run lint --silent", dir, 600_000);
  gates.lint = lint.ok;
  gates.lintDetail = lint.ok ? null : lint.out.split("\n").filter((l) => /error|warning|hygiene|knip|Unused/.test(l)).slice(0, 4).join(" | ");

  // The seeded line must be exercised by at least one existing test, or recall partly measures
  // "can the reviewer read uncovered code".
  const cov = coveredLines(join(ROOT, "docs/findings/critical-review/2026-07-25-sextant/data/coverage-app.json"));
  gates.covered = isControl
    ? true
    : (seed.edits ?? []).every((e) => {
        if (!e.line) return true;
        const lines = cov?.get(e.file);
        return lines ? lines.has(e.line) : false;
      });

  const wantGreen = seed.expectGates !== false;
  const admitted = gates.applied && gates.covered && (wantGreen ? gates.typecheck && gates.tests && gates.lint : true);
  results.push({ id: seed.id, slot, stratum: seed.stratum, admitted, gates, isControl, note: seed.note, worktree: `.sextant-worktrees/${slot}` });
  console.log(
    `${admitted ? "ADMITTED" : "rejected"}  ` +
      `tc=${gates.typecheck ? "y" : "n"} test=${gates.tests ? "y" : "n"} lint=${gates.lint ? "y" : "n"} cov=${gates.covered ? "y" : "n"}` +
      (admitted ? "" : `  <- ${!gates.covered ? "line not covered by any test" : !gates.tests ? "suite goes red (the suite already catches it)" : !gates.lint ? "linter catches it" : "typecheck catches it"}`),
  );

  if (mode === "check") trySh(`git worktree remove --force ${JSON.stringify(dir)}`);
}

const admitted = results.filter((r) => r.admitted);
writeFileSync(OUT, JSON.stringify({ head, mode, generatedFrom: "scripts/sextant/seed-defs.json", results }, null, 2) + "\n", "utf8");
console.log(`\n${admitted.length}/${results.length} admitted. Written to ${OUT.replace(ROOT + "/", "")}`);
