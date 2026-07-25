/**
 * Did the review loop find its own output? Measured with git rather than judgement.
 *
 * E1's headline "66.7% self-induced" was a hand-label, invented post-hoc and applied by the same
 * agent that had authored the fixes being judged. Its own corrections section calls it an upper
 * bound rather than a measurement and says the honest number needs blind coding. This replaces the
 * judgement with an oracle: for each finding, ask `git blame` whether the line it cites was written
 * by an earlier round of the same loop.
 *
 * This is SZZ (Śliwerski, Zimmermann & Zeller, MSR 2005) with the hard parts removed — we already
 * know the fix commits and the critic hands us the line, so only the blame step remains. Plain
 * `git blame -L n,n` is R-SZZ, the highest-precision variant measured (P≈0.73 in Rosa et al.'s
 * developer-informed evaluation), but no blame-based attribution has been pushed past F1≈0.7. So
 * this is an instrument with an error bar, not ground truth, and it reports accordingly:
 *
 *   - a SENSITIVITY TABLE across blame configurations, because the choice moves published precision
 *     from 0.42 to 0.73 and we should show how much it moves ours;
 *   - an explicit UNKNOWN bucket. This matters more than it sounds. SZZ runs backwards and goes
 *     blind on addition-only fixes; we run FORWARD from a line that exists, so we always get an
 *     answer — including for "missing guard / missing bound" findings where no line is wrong and
 *     blame merely names whoever wrote the neighbourhood. An oracle that can never say "I can't
 *     tell" is not more rigorous than a hand label, just differently overconfident;
 *   - LIFT over the base rate, not the raw fraction. If ~22% of all product lines were written by
 *     fix commits, then ~22% of randomly-located findings land on fix-authored code by chance. The
 *     raw percentage is meaningless without that denominator.
 *
 * Usage:  node scripts/review-metrics/blame-attribution.mjs [--json]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEXTANT = join(ROOT, "docs/findings/critical-review/2026-07-25-sextant/data");
const OUROBOROS = join(ROOT, "docs/findings/critical-review/2026-07-24-ouroboros/data");

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const tryGit = (...a) => {
  try {
    return git(...a);
  } catch {
    return null;
  }
};

const manifest = JSON.parse(readFileSync(join(SEXTANT, "e1-commits.json"), "utf8"));
const findings = JSON.parse(readFileSync(join(OUROBOROS, "findings_full.json"), "utf8"));

/** Fix commits by round label. Round N's fix commit is titled "M2 review round N". */
const fixByRound = new Map(manifest.fixCommits.map((c) => [String(c.round), c.sha]));
const fixShas = new Set(manifest.fixCommits.map((c) => c.sha));
const OUTLIER = manifest.outlier?.sha;

/**
 * E1's dataset mixes relative (`app/src/io/importGraph.ts`) and absolute
 * (`/home/user/ringweave/app/src/model.ts`) paths — a known inconsistency. Normalize before use, or
 * every absolute-path finding silently becomes unknown.
 */
function normalizePath(p) {
  if (!p) return null;
  const cleaned = p.replace(/^\/home\/[^/]+\/[^/]+\//, "").replace(/^\.\//, "");
  return cleaned.startsWith("lib/") || cleaned.startsWith("app/") ? cleaned : null;
}

/** Blame configurations, weakest to strongest mitigation. */
const CONFIGS = [
  { name: "bare", flags: [] },
  { name: "-w", flags: ["-w"] },
  { name: "-w -M -C", flags: ["-w", "-M", "-C"] },
  { name: "-w -M -CCC", flags: ["-w", "-M", "-CCC"] },
];

/** A line that is blank, a lone brace, or comment-only carries no attribution signal (AG-SZZ). */
function isUninformative(text) {
  const t = (text ?? "").trim();
  return t === "" || /^[{}[\]();,]+$/.test(t) || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function blameLine(rev, file, line, flags) {
  const out = tryGit("blame", ...flags, "--porcelain", "-L", `${line},${line}`, rev, "--", file);
  if (!out) return null;
  const sha = /^([0-9a-f]{40})/.exec(out)?.[1];
  const text = out.split("\n").find((l) => l.startsWith("\t"))?.slice(1);
  return sha ? { sha, text } : null;
}

/** Share of product lines at `rev` written by fix commits — the chance denominator. */
const baseRateCache = new Map();
function baseRateAt(rev, flags, key) {
  const ck = `${rev}:${key}`;
  if (baseRateCache.has(ck)) return baseRateCache.get(ck);
  const files = (tryGit("ls-tree", "-r", "--name-only", rev) ?? "")
    .split("\n")
    .filter((p) => (p.startsWith("lib/src/") || p.startsWith("app/src/")) && !/\.(test|spec)\.[tj]sx?$/.test(p));
  let total = 0;
  let fromFix = 0;
  for (const file of files) {
    const blame = tryGit("blame", ...flags, "--porcelain", rev, "--", file);
    if (!blame) continue;
    let pending = null;
    for (const l of blame.split("\n")) {
      const m = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/.exec(l);
      if (m) {
        pending = m[1];
        continue;
      }
      if (l.startsWith("\t") && pending) {
        if (!isUninformative(l.slice(1))) {
          total++;
          if (fixShas.has(pending)) fromFix++;
        }
        pending = null;
      }
    }
  }
  const rate = total === 0 ? 0 : fromFix / total;
  baseRateCache.set(ck, { rate, total, fromFix });
  return baseRateCache.get(ck);
}

// ---------------------------------------------------------------------------------------------

const results = [];
for (const cfg of CONFIGS) {
  let selfInduced = 0;
  let preExisting = 0;
  let unknown = 0;
  const unknownReasons = {};
  const perFinding = [];

  for (const f of findings) {
    const file = normalizePath(f.file);
    const fixSha = fixByRound.get(String(f.round));
    const bump = (r) => {
      unknown++;
      unknownReasons[r] = (unknownReasons[r] ?? 0) + 1;
    };

    if (!file) {
      bump("unrecognized-path");
      continue;
    }
    if (f.line == null) {
      // ~Half of E1's findings carry no line. Blaming the whole file would attribute a finding to
      // whoever last touched anything in it, which is not what "this finding targets fix-authored
      // code" means. Honest answer: unknown.
      bump("no-line-recorded");
      continue;
    }
    if (!fixSha) {
      bump("round-not-in-manifest");
      continue;
    }
    // Round N reviewed the tree as it stood BEFORE round N's fix, i.e. that commit's parent. Any
    // fix commit appearing in the blame is therefore necessarily from an earlier round.
    const rev = `${fixSha}^`;
    const b = blameLine(rev, file, f.line, cfg.flags);
    if (!b) {
      bump("unblamable");
      continue;
    }
    if (isUninformative(b.text)) {
      bump("uninformative-line");
      continue;
    }
    const isFix = fixShas.has(b.sha);
    if (isFix) selfInduced++;
    else preExisting++;
    perFinding.push({ round: f.round, class: f.class, file, line: f.line, blamed: b.sha.slice(0, 7), selfInduced: isFix });
  }

  const classified = selfInduced + preExisting;
  // Base rate measured at the last reviewed revision, under the same blame configuration.
  const lastRev = `${fixByRound.get("21")}^`;
  const base = baseRateAt(lastRev, cfg.flags, cfg.name);
  const rate = classified === 0 ? 0 : selfInduced / classified;

  results.push({
    config: cfg.name,
    classified,
    selfInduced,
    preExisting,
    unknown,
    unknownReasons,
    selfInducedRate: Number(rate.toFixed(4)),
    baseRate: Number(base.rate.toFixed(4)),
    lift: base.rate === 0 ? null : Number((rate / base.rate).toFixed(2)),
    perFinding: cfg.name === "-w -M -C" ? perFinding : undefined,
  });
}

const primary = results.find((r) => r.config === "-w -M -C");
const out = {
  note: "SZZ-style forward blame attribution. Report LIFT over base rate, not the raw rate. The unknown bucket is not a failure of the instrument, it is the instrument declining to guess.",
  ref: manifest.ref,
  fixCommits: manifest.fixCommits.length,
  excludedFromFixSet: manifest.excludedFromFixSet.map((c) => ({ sha: c.sha.slice(0, 7), reason: c.reason })),
  outlierReportedSeparately: OUTLIER?.slice(0, 7) ?? null,
  totalFindings: findings.length,
  primaryConfig: "-w -M -C",
  // Strip the bulky per-finding rows from the sensitivity table; they are kept once, under `primary`.
  sensitivity: results.map(({ perFinding: _perFinding, ...r }) => r),
  primary,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`E1 self-induction, measured by blame (${findings.length} findings, ${manifest.fixCommits.length} fix commits)\n`);
  console.log("  config          classified  self  pre  unknown   rate   base   lift");
  for (const r of results) {
    console.log(
      `  ${r.config.padEnd(14)} ${String(r.classified).padStart(10)} ${String(r.selfInduced).padStart(5)} ${String(r.preExisting).padStart(4)} ${String(r.unknown).padStart(8)}  ${(100 * r.selfInducedRate).toFixed(0).padStart(4)}%  ${(100 * r.baseRate).toFixed(0).padStart(4)}%  ${r.lift == null ? "  —" : r.lift.toFixed(2) + "x"}`,
    );
  }
  console.log(`\n  unknown breakdown (${primary.config}):`);
  for (const [k, v] of Object.entries(primary.unknownReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(3)}  ${k}`);
  }
  console.log(
    `\n  READ THIS AS: of the findings this oracle could classify, ${(100 * primary.selfInducedRate).toFixed(0)}% cite a line an` +
      `\n  earlier round wrote, against a ${(100 * primary.baseRate).toFixed(0)}% chance baseline — a ${primary.lift}x enrichment.` +
      `\n  ${primary.unknown} of ${findings.length} findings are UNKNOWN and are excluded from the rate rather than` +
      `\n  guessed. Blame attribution is also documented as sub-optimal for non-functional` +
      `\n  findings, which are the majority here — see the method section of the write-up.\n`,
  );
}
