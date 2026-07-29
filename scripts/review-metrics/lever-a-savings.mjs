#!/usr/bin/env node
/**
 * E4, measured in-run: what the three cost levers actually saved. Reported SEPARATELY, because they
 * differ in evidential strength and pooling them would hide that:
 *
 *   A1 · lint preemption      how much of a critic's output the lint gate now owns
 *   A2 · triage theme-collapse  duplicate findings the clustering phase merged
 *   A3 · saturation skipping    critic-rounds not spent, × the measured mean cost
 *
 * A1 replays TODAY's rule set over E1's history at two refs: the baseline (violations the critics
 * would have been handed for free) and the converged head (violations adversarial review did not
 * file — a claim about CAPABILITY, with no model anywhere in it).
 *
 * A1 is a LOWER bound, not an estimate: only oxlint can be replayed historically. knip needs a
 * repo-root config and an install that did not exist at those refs, and the custom hygiene checks
 * are coupled to the current tree's identifiers.
 *
 * Usage: node scripts/review-metrics/lever-a-savings.mjs [dataDir]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const dataDir = resolve(
  process.argv[2] ?? "docs/findings/critical-review/2026-07-25-sextant/data",
);
const roundsDir = join(dataDir, "rounds");
const REPO = resolve(process.cwd());

if (!existsSync(roundsDir)) {
  console.error(`no rounds directory at ${roundsDir}`);
  process.exit(1);
}

const e1 = JSON.parse(readFileSync(join(dataDir, "e1-commits.json"), "utf8"));

function git(...argv) {
  return execFileSync("git", argv, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// ───────────────────────────── A1 · lint preemption ─────────────────────────────

/** Run the CURRENT oxlint config over a historical ref. The config path is absolute and outside the
 *  worktree on purpose: oxlint resolves `--config` against its own cwd, and the historical tree has
 *  no config at all — the question being asked is what today's oracle says about that code. */
function lintAtRef(ref) {
  const wt = mkdtempSync(join(tmpdir(), "sextant-lint-"));
  try {
    git("worktree", "add", "--detach", wt, ref);
    const targets = ["app/src", "lib/src"].map((p) => join(wt, p)).filter(existsSync);
    if (targets.length === 0) return { ref, violations: [], sites: [] };
    let out = "";
    try {
      out = execFileSync(
        "npx",
        ["oxlint", "--config", join(REPO, ".oxlintrc.json"), ...targets],
        { cwd: REPO, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (err) {
      // oxlint exits non-zero when it FINDS something, the normal case here. Only a
      // missing binary or an unparseable config leaves the output empty, and that
      // must not read as "clean".
      out = (err.stdout ?? "") + (err.stderr ?? "");
      if (!out.includes(":")) throw err;
    }
    const violations = [];
    for (const line of out.split("\n")) {
      const m = /^(.*?):(\d+):(\d+): error (\S+): (.*)$/.exec(line.trim());
      if (!m) continue;
      violations.push({
        file: m[1].startsWith(wt) ? m[1].slice(wt.length + 1) : m[1],
        line: Number(m[2]),
        rule: m[4],
        message: m[5],
      });
    }
    // A "site" is one place in the code — what a critic would have filed ONE
    // finding about. Two rules on the same element is one defect; counting rule
    // hits instead would double it.
    const sites = [...new Set(violations.map((v) => `${v.file}:${v.line}`))].sort();
    return { ref, violations, sites };
  } finally {
    rmSync(wt, { recursive: true, force: true });
    try {
      git("worktree", "prune");
    } catch {
      /* prune is cleanup; a failure here must not lose the measurement */
    }
  }
}

// The baseline is not a named field — it is the commit the manifest EXCLUDED from the fix set for
// being the baseline. Derived rather than restated so the two cannot disagree, and fatal if the
// shape changes, because falling back to another ref would compare the wrong code.
const baselineEntry = (e1.excludedFromFixSet ?? []).find((c) => /baseline/i.test(c.reason ?? ""));
const baselineRef = baselineEntry?.sha;
const convergedRef = e1.head;
if (!baselineRef || !convergedRef) {
  console.error(
    "e1-commits.json: could not resolve the baseline (excludedFromFixSet entry whose reason mentions 'baseline') and head. Cannot measure A1.",
  );
  process.exit(1);
}

const atBaseline = lintAtRef(baselineRef);
const atConverged = lintAtRef(convergedRef);

/** Did a converged-head site SURVIVE from the baseline, or is it new? Not matched by path and line
 *  — review renamed files and extracted components, so both moved. Matched on the offending line's
 *  TEXT; anything that fails to match is reported UNMATCHED, not classified either way. */
function sourceLine(ref, file, line) {
  try {
    const body = git("show", `${ref}:${file}`);
    return (body.split("\n")[line - 1] ?? "").trim();
  } catch {
    return null;
  }
}

const baselineTexts = new Map();
for (const site of atBaseline.sites) {
  const [file, line] = [site.slice(0, site.lastIndexOf(":")), Number(site.slice(site.lastIndexOf(":") + 1))];
  const text = sourceLine(baselineRef, file, line);
  if (text) baselineTexts.set(text, site);
}

const survived = [];
const introduced = [];
const unmatched = [];
for (const site of atConverged.sites) {
  const file = site.slice(0, site.lastIndexOf(":"));
  const line = Number(site.slice(site.lastIndexOf(":") + 1));
  const text = sourceLine(convergedRef, file, line);
  if (text === null) unmatched.push(site);
  else if (baselineTexts.has(text)) survived.push({ site, from: baselineTexts.get(text), text });
  else introduced.push({ site, text });
}

// ───────────────────── A2 / A3 · from Sextant's own round data ─────────────────────

const roundFiles = readdirSync(roundsDir).filter((f) => f.endsWith(".json")).sort();
const perRound = [];
for (const f of roundFiles) {
  const d = JSON.parse(readFileSync(join(roundsDir, f), "utf8"));
  const critics = Array.isArray(d.byCritic) ? d.byCritic : Object.values(d.byCritic ?? {});
  const rawFindings = critics.reduce((sum, c) => sum + (Number(c.findings) || 0), 0);
  const themes = d.counts?.themes ?? (d.themes ?? []).length;
  perRound.push({
    file: f,
    target: d.target,
    round: d.round,
    lensesRun: critics.length,
    rawFindings,
    themes,
    // A DEDUPLICATION figure and nothing else: several critics on one theme is not
    // corroboration, and this must never be read as a severity signal.
    collapsed: Math.max(0, rawFindings - themes),
    skipped: (d.skipped ?? []).length,
    skippedLenses: (d.skipped ?? []).map((s) => s.critic ?? s.lens ?? s),
    subagentTokens: d.tokens?.subagentTokens ?? null,
    agents: d.tokens?.agents ?? null,
  });
}

const measuredTokens = perRound.filter((r) => r.subagentTokens && r.agents);
const totalTokens = measuredTokens.reduce((s, r) => s + r.subagentTokens, 0);
const totalAgents = measuredTokens.reduce((s, r) => s + r.agents, 0);
// Per AGENT, not per critic: a round spends its critics plus one triage agent, and dividing by
// critics alone would inflate the unit cost of a skip.
const meanAgentCost = totalAgents === 0 ? null : Math.round(totalTokens / totalAgents);

const totalSkips = perRound.reduce((s, r) => s + r.skipped, 0);
const a3Tokens = meanAgentCost === null ? null : totalSkips * meanAgentCost;

const report = {
  generatedFrom: { dataDir, rounds: roundFiles.length },
  a1LintPreemption: {
    what: "today's oxlint rule set, replayed over E1's own history",
    scopeLimit:
      "oxlint rules only — knip and the custom hygiene checks cannot be replayed at those refs, so this is a LOWER bound",
    baseline: {
      ref: baselineRef,
      sites: atBaseline.sites.length,
      ruleHits: atBaseline.violations.length,
      detail: atBaseline.sites,
    },
    converged: {
      ref: convergedRef,
      sites: atConverged.sites.length,
      ruleHits: atConverged.violations.length,
      detail: atConverged.sites,
    },
    survivedAll21Rounds: survived,
    introducedDuringReview: introduced,
    // `introduced` asserts the offending LINE did not exist at the baseline, NOT that the defect
    // class is new — an extracted component carries its defect to a new line. The stronger claim is
    // `survivedAll21Rounds`, which needs no interpretation.
    introducedMeaning:
      "the offending line is new code, not necessarily a new defect class — check the text against the baseline sites before claiming injection",
    unmatched,
    rules: [...new Set(atConverged.violations.map((v) => v.rule))].sort(),
  },
  a2TriageCollapse: {
    what: "raw per-critic findings merged into themes by the triage phase",
    perRound: perRound.map((r) => ({
      target: r.target,
      round: r.round,
      rawFindings: r.rawFindings,
      themes: r.themes,
      collapsed: r.collapsed,
    })),
    totalRaw: perRound.reduce((s, r) => s + r.rawFindings, 0),
    totalThemes: perRound.reduce((s, r) => s + r.themes, 0),
    totalCollapsed: perRound.reduce((s, r) => s + r.collapsed, 0),
    caveat:
      "a deduplication figure only; multiple critics on one theme is not corroboration and carries no severity information",
  },
  a3SaturationSkipping: {
    what: "critic-rounds not spent because a lens was gated, × the measured mean agent cost",
    skippedCriticRounds: totalSkips,
    meanAgentCostTokens: meanAgentCost,
    tokensSaved: a3Tokens,
    perRound: perRound.map((r) => ({
      target: r.target,
      round: r.round,
      lensesRun: r.lensesRun,
      skipped: r.skipped,
      skippedLenses: r.skippedLenses,
    })),
  },
  tokenTotals: {
    subagentTokens: totalTokens,
    agents: totalAgents,
    meanAgentCostTokens: meanAgentCost,
    roundsWithTokenData: measuredTokens.length,
  },
};

writeFileSync(join(dataDir, "leverSavings.json"), JSON.stringify(report, null, 2) + "\n");

const pct = (a, b) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);
console.log(`A1 · lint preemption (oxlint rules only, LOWER bound)`);
console.log(
  `   E1 baseline  ${baselineRef.slice(0, 7)}: ${atBaseline.sites.length} sites / ${atBaseline.violations.length} rule hits`,
);
console.log(
  `   E1 converged ${convergedRef.slice(0, 7)}: ${atConverged.sites.length} sites / ${atConverged.violations.length} rule hits`,
);
console.log(
  `   survived all 21 review rounds: ${survived.length}   introduced during review: ${introduced.length}   unmatched: ${unmatched.length}`,
);
for (const s of survived) console.log(`     survived  ${s.from}  ->  ${s.site}`);
for (const s of introduced) console.log(`     new       ${s.site}`);
console.log(`\nA2 · triage theme-collapse`);
console.log(
  `   ${report.a2TriageCollapse.totalRaw} raw findings -> ${report.a2TriageCollapse.totalThemes} themes` +
    `  (${report.a2TriageCollapse.totalCollapsed} merged, ${pct(report.a2TriageCollapse.totalCollapsed, report.a2TriageCollapse.totalRaw)})`,
);
console.log(`\nA3 · saturation skipping`);
console.log(
  `   ${totalSkips} critic-rounds skipped × ${meanAgentCost ?? "?"} mean tokens/agent = ${a3Tokens ?? "?"} tokens`,
);
if (totalSkips === 0) {
  console.log(
    `   NOTE: zero. No lens reached its saturation gate in this run, so A3 saved nothing —` +
      ` the lever is built and unexercised, not proven.`,
  );
}
console.log(
  `\ntotals: ${totalTokens} subagent tokens over ${totalAgents} agents in ${measuredTokens.length} rounds` +
    ` (mean ${meanAgentCost ?? "?"}/agent)`,
);
console.log(`\nwrote ${join(dataDir, "leverSavings.json")}`);
