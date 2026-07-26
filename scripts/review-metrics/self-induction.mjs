#!/usr/bin/env node
/**
 * E2, measured on Sextant's OWN loop: what fraction of this run's findings point at
 * code this run's earlier fixes wrote?
 *
 * The same oracle as `blame-attribution.mjs` (which runs it backwards over E1),
 * pointed at Sextant instead. For each finding, `git blame` the cited line in the
 * tree the critics actually reviewed, and ask whether the commit that wrote it is
 * one of this loop's earlier fix commits. No agent judges anything; `git` answers.
 *
 * Three things this does differently from a naive rate, all of them mandatory:
 *
 *   - It blames the tree the critics SAW — the fix commit's first parent — not
 *     HEAD. Blaming HEAD would attribute a line to the fix that was made in
 *     response to the finding, which reverses cause and effect.
 *   - It reports LIFT over a base rate, not a raw fraction. The base rate is the
 *     share of non-test product lines in the reviewed tree that this loop's fixes
 *     authored; a finding landing there by chance is not self-induction.
 *   - It has an UNKNOWN bucket. A finding with no line, or one whose cited line is
 *     blank/comment/brace-only, is not evidence either way. Blame-based attribution
 *     is documented as sub-optimal for non-functional findings (Quach et al.), and
 *     three of five lenses file mostly those.
 *
 * Fix commits are discovered from git, not from a hand-maintained list: the loop's
 * commits are titled "Review round N (<target>)".
 *
 * Usage: node scripts/review-metrics/self-induction.mjs [--json]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = join(ROOT, "docs/findings/critical-review/2026-07-25-sextant/data");

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const tryGit = (...a) => {
  try {
    return git(...a);
  } catch {
    return null;
  }
};

/** Blame configurations, reported as a sensitivity table rather than one number. */
const CONFIGS = [
  { name: "bare", flags: [] },
  { name: "-w", flags: ["-w"] },
  { name: "-w -M -C", flags: ["-w", "-M", "-C"] },
  { name: "-w -M -CCC", flags: ["-w", "-M", "-CCC"] },
];

/** A cited line carrying no logic is not evidence of anything (the AG-SZZ filter). */
const NOISE = /^\s*(\/\/|\/\*|\*|\}|\{|\)|$)/;

function blameLine(rev, file, line, flags) {
  const out = tryGit("blame", ...flags, "--porcelain", "-L", `${line},${line}`, rev, "--", file);
  if (!out) return null;
  const sha = /^([0-9a-f]{40})/.exec(out)?.[1];
  const text = out.split("\n").find((l) => l.startsWith("\t"))?.slice(1);
  return sha ? { sha, text: text ?? "" } : null;
}

// --- this loop's fix commits, discovered from git -------------------------------
const log = git("log", "--format=%H%x09%s", "HEAD");
const fixCommits = [];
for (const line of log.split("\n")) {
  const [sha, subject] = line.split("\t");
  const m = /^Review round (\d+) \(([^)]+)\)/.exec(subject ?? "");
  if (m) fixCommits.push({ sha, round: Number(m[1]), target: m[2], subject });
}
fixCommits.reverse(); // oldest first

if (fixCommits.length === 0) {
  console.error("self-induction: no fix commits found (expected subjects like \"Review round 1 (lib/src)\")");
  process.exit(1);
}

/** The tree a round's critics reviewed = the parent of that round's fix commit. */
const reviewedTree = new Map();
for (const c of fixCommits) {
  const parent = tryGit("rev-parse", `${c.sha}^`)?.trim();
  if (parent) reviewedTree.set(`${c.target}#${c.round}`, parent);
}

// --- findings -------------------------------------------------------------------
const findingsPath = join(DATA, "findings_full.json");
if (!existsSync(findingsPath)) {
  console.error(`self-induction: ${findingsPath} not found — run round-log.mjs first`);
  process.exit(1);
}
const findings = JSON.parse(readFileSync(findingsPath, "utf8"));

/**
 * Base rate: of the non-test product lines in the tree a round reviewed, what share
 * did THIS loop's earlier fixes author? A finding landing on such a line by chance
 * is not self-induction, so this is what the rate has to beat.
 */
function baseRate(tree, target, earlier, flags) {
  const dir = target.startsWith("lib") ? "lib/src" : "app/src";
  const files = (tryGit("ls-tree", "-r", "--name-only", tree, "--", dir) ?? "")
    .split("\n")
    .filter((f) => f && /\.(ts|tsx)$/.test(f) && !f.includes("/test/"));
  let total = 0;
  let mine = 0;
  for (const f of files) {
    const out = tryGit("blame", ...flags, "--line-porcelain", tree, "--", f);
    if (!out) continue;
    for (const line of out.split("\n")) {
      const sha = /^([0-9a-f]{40}) /.exec(line)?.[1];
      if (!sha) continue;
      total++;
      if (earlier.has(sha)) mine++;
    }
  }
  return { total, mine, rate: total ? mine / total : 0 };
}

const results = [];
for (const cfg of CONFIGS) {
  let selfInduced = 0;
  let preexisting = 0;
  let unknown = 0;
  const attributed = [];
  // Severity matters more than the pooled rate: a self-induced BLOCKING finding is
  // the loop breaking its own code, while a self-induced nit is the loop tidying up
  // after itself. Pooling them hides which one is happening.
  const bySeverity = {};

  for (const f of findings) {
    const key = `${f.target}#${f.round}`;
    const tree = reviewedTree.get(key);
    // Earlier fixes ON THE SAME TARGET: a lib fix cannot have induced an app finding.
    const earlier = new Set(
      fixCommits.filter((c) => c.target === f.target && c.round < f.round).map((c) => c.sha),
    );
    if (!tree || !f.file || !f.line || earlier.size === 0) {
      unknown++;
      continue;
    }
    const blamed = blameLine(tree, f.file, f.line, cfg.flags);
    if (!blamed || NOISE.test(blamed.text)) {
      unknown++;
      continue;
    }
    const bucket = (bySeverity[f.severity] ??= { selfInduced: 0, preexisting: 0 });
    if (earlier.has(blamed.sha)) {
      selfInduced++;
      bucket.selfInduced++;
      attributed.push({ round: f.round, target: f.target, severity: f.severity, file: f.file, line: f.line, class: f.class, blamed: blamed.sha.slice(0, 7) });
    } else {
      preexisting++;
      bucket.preexisting++;
    }
  }

  const classifiable = selfInduced + preexisting;
  results.push({
    config: cfg.name,
    selfInduced,
    preexisting,
    unknown,
    classifiable,
    rate: classifiable ? selfInduced / classifiable : null,
    bySeverity,
    attributed,
  });
}

// Base rate on the LAST round's reviewed tree, where the most fix code exists.
const last = fixCommits[fixCommits.length - 1];
const lastTree = reviewedTree.get(`${last.target}#${last.round}`);
const earlierThanLast = new Set(
  fixCommits.filter((c) => c.target === last.target && c.round < last.round).map((c) => c.sha),
);
const base = lastTree && earlierThanLast.size > 0
  ? baseRate(lastTree, last.target, earlierThanLast, ["-w", "-M", "-C"])
  : { total: 0, mine: 0, rate: 0 };

const primary = results.find((r) => r.config === "-w -M -C") ?? results[0];
const report = {
  note:
    "E2 on Sextant's own loop. Rounds are blamed against the tree their critics reviewed (the fix " +
    "commit's first parent), so a fix made IN RESPONSE to a finding cannot be counted as its cause. " +
    "Only earlier fixes on the SAME target count. Lift over the base rate is the claim; the raw " +
    "fraction is not.",
  fixCommits: fixCommits.map((c) => ({ round: c.round, target: c.target, sha: c.sha.slice(0, 7) })),
  findings: findings.length,
  primary: { config: primary.config, selfInduced: primary.selfInduced, preexisting: primary.preexisting, unknown: primary.unknown, rate: primary.rate },
  baseRate: { tree: lastTree?.slice(0, 7) ?? null, ...base },
  lift: primary.rate && base.rate ? primary.rate / base.rate : null,
  bySeverity: Object.fromEntries(
    Object.entries(primary.bySeverity).map(([sev, v]) => [
      sev,
      { ...v, rate: v.selfInduced + v.preexisting ? v.selfInduced / (v.selfInduced + v.preexisting) : null },
    ]),
  ),
  sensitivity: results.map(({ config, selfInduced, preexisting, unknown, rate }) => ({ config, selfInduced, preexisting, unknown, rate })),
  attributed: primary.attributed,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`fix commits: ${fixCommits.map((c) => `${c.target} r${c.round}`).join(", ")}`);
  console.log(`findings: ${findings.length}`);
  console.log(`\nprimary (${primary.config}):`);
  console.log(`  self-induced ${primary.selfInduced}  pre-existing ${primary.preexisting}  unknown ${primary.unknown}`);
  console.log(`  rate over classifiable: ${primary.rate === null ? "n/a" : (primary.rate * 100).toFixed(1) + "%"}`);
  console.log(`  base rate: ${(base.rate * 100).toFixed(1)}% (${base.mine}/${base.total} product lines)`);
  console.log(`  lift: ${report.lift === null ? "n/a" : report.lift.toFixed(2) + "x"}`);
  console.log(`\nby severity:`);
  for (const [sev, v] of Object.entries(report.bySeverity)) {
    console.log(`  ${sev.padEnd(12)} self ${String(v.selfInduced).padStart(3)}  pre ${String(v.preexisting).padStart(3)}  rate ${v.rate === null ? "n/a" : (v.rate * 100).toFixed(1) + "%"}`);
  }
  console.log(`\nsensitivity:`);
  for (const r of report.sensitivity) {
    console.log(`  ${r.config.padEnd(12)} self ${String(r.selfInduced).padStart(3)}  pre ${String(r.preexisting).padStart(3)}  unk ${String(r.unknown).padStart(3)}  rate ${r.rate === null ? "n/a" : (r.rate * 100).toFixed(1) + "%"}`);
  }
}
