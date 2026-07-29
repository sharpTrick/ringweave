#!/usr/bin/env node
/**
 * E2 on Sextant's OWN loop: what fraction of this run's findings point at code this run's earlier
 * fixes wrote? The same instrument as `blame-attribution.mjs`, with the same published error bar,
 * pointed forward instead of back.
 *
 * Three things it does that a naive rate does not, all mandatory:
 *
 *   - blames the tree the critics SAW (the fix commit's first parent), not HEAD; blaming HEAD
 *     attributes a line to the fix made in RESPONSE to the finding, reversing cause and effect;
 *   - reports LIFT over a base rate, not a raw fraction — a finding landing on fix-authored code by
 *     chance is not self-induction;
 *   - has an UNKNOWN bucket: a finding with no line, or one citing a blank/comment/brace-only line,
 *     is not evidence either way, and blame is weakest exactly on the non-functional findings that
 *     dominate here.
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

/** Reported as a sensitivity table rather than as one number. */
const CONFIGS = [
  { name: "bare", flags: [] },
  { name: "-w", flags: ["-w"] },
  { name: "-w -M -C", flags: ["-w", "-M", "-C"] },
  { name: "-w -M -CCC", flags: ["-w", "-M", "-CCC"] },
];

/** A cited line carrying no logic is not evidence of anything. */
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
/** Three subject shapes, because the run's own commit style drifted. A shape these regexes miss
 *  routes that round's findings to `unknown`; the coverage check below asserts each against the
 *  real log rather than trusting a tidier pattern. */
const fixCommits = [];
const addFix = (sha, round, target, subject) => fixCommits.push({ sha, round, target, subject });
for (const line of log.split("\n")) {
  const [sha, subject = ""] = line.split("\t");
  let m = /^Review round (\d+) \(([^)]+)\)/.exec(subject);
  if (m) {
    addFix(sha, Number(m[1]), m[2], subject);
    continue;
  }
  m = /^(lib|app) round (\d+)\b/.exec(subject);
  if (m) {
    addFix(sha, Number(m[2]), `${m[1]}/src`, subject);
    continue;
  }
  m = /^(?:Review r|R)ounds (lib|app)-(\d+) and (lib|app)-(\d+)\b/.exec(subject);
  if (m) {
    addFix(sha, Number(m[2]), `${m[1]}/src`, subject);
    addFix(sha, Number(m[4]), `${m[3]}/src`, subject);
  }
}
fixCommits.reverse();

if (fixCommits.length === 0) {
  console.error("self-induction: no fix commits found (expected subjects like \"lib round 7: …\")");
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

/** Coverage, checked rather than assumed: a round whose fix commit this cannot find has all of its
 *  findings silently routed to `unknown`, which reads as caution and is blindness. */
const roundsInData = new Set(findings.map((f) => `${f.target}#${f.round}`));
const roundsMapped = new Set(fixCommits.map((c) => `${c.target}#${c.round}`));
const unmapped = [...roundsInData].filter((r) => !roundsMapped.has(r)).sort();

/** Of the non-test product lines in the tree a round reviewed, the share THIS loop's earlier fixes
 *  authored — the chance rate the observed rate has to beat. */
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
  const classifiableByRound = new Map();
  // A self-induced BLOCKING finding is the loop breaking its own code; a self-induced nit is the
  // loop tidying up after itself. The pooled rate hides which one is happening.
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
    classifiableByRound.set(key, (classifiableByRound.get(key) ?? 0) + 1);
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
    classifiableByRound,
  });
}

const primary = results.find((r) => r.config === "-w -M -C") ?? results[0];

/**
 * The base rate MUST be per round, weighted by that round's classifiable findings. Fix-authored code
 * accumulates monotonically, so an end-of-run share is the largest it ever is while an early-round
 * finding was drawn from a nearly fix-free tree; dividing by the final tree's rate produced a lift
 * below 1 — the loop appearing to avoid its own code — which was an artifact, not a result.
 */
const perRound = new Map();
for (const c of fixCommits) {
  const key = `${c.target}#${c.round}`;
  if (perRound.has(key)) continue;
  const tree = reviewedTree.get(key);
  const earlier = new Set(
    fixCommits.filter((x) => x.target === c.target && x.round < c.round).map((x) => x.sha),
  );
  perRound.set(
    key,
    tree && earlier.size > 0
      ? baseRate(tree, c.target, earlier, ["-w", "-M", "-C"])
      : { total: 0, mine: 0, rate: 0 },
  );
}
const weighed = primary.classifiableByRound;
let weightedRate = 0;
let weightTotal = 0;
let baseLines = 0;
let baseMine = 0;
for (const [key, n] of weighed) {
  const b = perRound.get(key);
  if (!b) continue;
  weightedRate += b.rate * n;
  weightTotal += n;
  baseLines += b.total;
  baseMine += b.mine;
}
const base = {
  total: baseLines,
  mine: baseMine,
  rate: weightTotal ? weightedRate / weightTotal : 0,
  perRound: Object.fromEntries([...perRound].map(([k, v]) => [k, Number(v.rate.toFixed(4))])),
};
const report = {
  note:
    "E2 on Sextant's own loop. Rounds are blamed against the tree their critics reviewed (the fix " +
    "commit's first parent), so a fix made IN RESPONSE to a finding cannot be counted as its cause. " +
    "Only earlier fixes on the SAME target count. Lift over the base rate is the claim; the raw " +
    "fraction is not.",
  fixCommits: fixCommits.map((c) => ({ round: c.round, target: c.target, sha: c.sha.slice(0, 7) })),
  findings: findings.length,
  unmappedRounds: unmapped,
  primary: { config: primary.config, selfInduced: primary.selfInduced, preexisting: primary.preexisting, unknown: primary.unknown, rate: primary.rate },
  baseRate: { weighting: "per-round, weighted by that round's classifiable findings", ...base },
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
  console.log(`fix commits: ${fixCommits.length} (${new Set(fixCommits.map((c) => c.sha)).size} distinct)`);
  console.log(`findings: ${findings.length}`);
  if (unmapped.length > 0) {
    console.log(`UNMAPPED ROUNDS (their findings can only land in unknown): ${unmapped.join(", ")}`);
  }
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
