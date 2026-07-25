/**
 * How much of the review loop's own output did the review loop then rewrite?
 *
 * This is the label-free companion to the self-induction rate. Every other measure of
 * "the loop consumed its own output" involves judgement somewhere — E1's headline 66.7% was a
 * hand-label applied post-hoc by the same agent that had authored the fixes being judged, which its
 * own corrections section calls an upper bound rather than a measurement. This number has no model
 * and no judgement anywhere in it: it asks git how many lines each review-round fix commit added,
 * and how many of those lines still survive at the end of the loop.
 *
 * Usage:  node scripts/review-metrics/fix-churn.mjs [--json]
 *
 * Reads the commit manifest at
 * docs/findings/critical-review/2026-07-25-sextant/data/e1-commits.json, which records why `main`
 * cannot be used: it is squash-merged (one commit per PR), so blame there resolves at PR
 * granularity and cannot tell a review-round fix from the M2 baseline.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "docs/findings/critical-review/2026-07-25-sextant/data/e1-commits.json");

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const head = manifest.head;
const fixShas = manifest.fixCommits.map((c) => c.sha);

// Product code only. Tests are excluded deliberately: the loop was *supposed* to grow and rework
// the suite (E1 took it from 68 to 136 tests), so counting test churn would conflate the ratchet
// working as intended with the loop rewriting its own fixes.
const isProduct = (p) =>
  (p.startsWith("lib/src/") || p.startsWith("app/src/")) && !/\.(test|spec)\.[tj]sx?$/.test(p);

/** Lines each fix commit ADDED to product files, as `file:lineNumberAfter`. */
function addedLines(sha) {
  const out = [];
  const diff = git("show", "--unified=0", "--no-color", "--format=", sha);
  let file = null;
  let next = 0;
  for (const line of diff.split("\n")) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) {
      file = f[1] === "/dev/null" ? null : f[1];
      continue;
    }
    const h = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h) {
      next = Number(h[1]);
      continue;
    }
    if (!file || !isProduct(file)) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) out.push(`${file}:${next++}`);
  }
  return out;
}

/**
 * Lines at HEAD still attributed to each fix commit.
 *
 * `git blame` at HEAD attributes every surviving line to the commit that last touched it, so lines
 * still blamed on commit C are exactly C's surviving contribution — if a later round rewrote or
 * deleted the line, blame moves to that round (or the line is gone). `-w` ignores whitespace-only
 * rewrites so a reindent does not read as a rewrite.
 *
 * This is computed once for the whole tree rather than per commit: one blame pass per product file
 * at HEAD gives the survivor count for every fix commit simultaneously.
 */
function survivingLinesByCommit() {
  const counts = new Map();
  const files = git("ls-tree", "-r", "--name-only", head).split("\n").filter(isProduct);
  for (const file of files) {
    let blame;
    try {
      blame = git("blame", "-w", "--porcelain", head, "--", file);
    } catch {
      continue;
    }
    for (const bl of blame.split("\n")) {
      const m = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/.exec(bl);
      if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }
  }
  return counts;
}

const surviving = survivingLinesByCommit();
const rows = [];
let addedTotal = 0;
let aliveTotal = 0;
for (const c of manifest.fixCommits) {
  const added = addedLines(c.sha).length;
  const alive = surviving.get(c.sha) ?? 0;
  addedTotal += added;
  aliveTotal += alive;
  rows.push({ round: c.round, sha: c.sha.slice(0, 7), subject: c.subject, added, surviving: alive });
}

const churn = addedTotal === 0 ? 0 : 1 - aliveTotal / addedTotal;
const result = {
  ref: manifest.ref,
  head: head.slice(0, 7),
  fixCommits: fixShas.length,
  productLinesAdded: addedTotal,
  productLinesSurviving: aliveTotal,
  rewrittenOrRemovedFraction: Number(churn.toFixed(4)),
  perRound: rows,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`E1 fix-churn over ${fixShas.length} review-round commits (${manifest.ref} @ ${result.head})\n`);
  for (const r of rows) {
    const pct = r.added === 0 ? "  —  " : `${(100 * (1 - r.surviving / r.added)).toFixed(0).padStart(3)}%`;
    console.log(`  round ${String(r.round).padStart(4)}  +${String(r.added).padStart(4)} lines  ${String(r.surviving).padStart(4)} survive  ${pct} rewritten`);
  }
  console.log(
    `\n  TOTAL  +${addedTotal} product lines added, ${aliveTotal} survive at round 21` +
      `\n  => ${(100 * churn).toFixed(1)}% of fix-authored product code was rewritten or removed` +
      `\n     by a later round of the same loop.\n`,
  );
  console.log(
    `  CAVEAT, and it is not small: this is confounded by position in the sequence. Round 2 had 19\n` +
      `  further rounds in which to be overwritten; round 21 had none, and trivially shows 0%. So the\n` +
      `  per-round column is partly a survivorship artifact and the aggregate understates early churn.\n` +
      `  Compare rounds at equal depth, or read the curve, not the total.\n` +
      `  Excludes tests deliberately: the loop was SUPPOSED to rework the suite (68 -> 136 tests), so\n` +
      `  counting test churn would score the ratchet working as intended as if it were waste.\n`,
  );
}
