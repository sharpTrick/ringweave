#!/usr/bin/env node
/**
 * E4, measured in-run: what the three cost levers actually saved.
 *
 * The proposal claimed a ≥40% token reduction with no loss of recall. A second
 * full baseline run of E1's configuration would cost more than the experiment,
 * so the saving is measured from the run's own bookkeeping instead — three
 * components, reported SEPARATELY, because they have very different evidential
 * strength and pooling them would hide that:
 *
 *   A1 · lint preemption      how much of a critic's output the lint gate now owns
 *   A2 · triage theme-collapse  duplicate findings the clustering phase merged
 *   A3 · saturation skipping    critic-rounds not spent, × the measured mean cost
 *
 * A1 is the only one measured against E1 rather than inside Sextant, and it is
 * measured the strongest way available: run TODAY's rule set over E1's own
 * history. Two refs matter and they answer different questions.
 *   - at E1's BASELINE: violations the critics would have been handed for free.
 *   - at E1's CONVERGED HEAD: violations that 21 rounds of five-lens adversarial
 *     review did not file. This is the load-bearing number, because it is not a
 *     claim about cost at all — it is a claim about CAPABILITY, and it has no
 *     model anywhere in it.
 *
 * Honest scope limit on A1: only the oxlint rule set can be replayed historically.
 * knip needs the repo-root config and an install that did not exist at those refs,
 * and the custom hygiene checks are coupled to the current tree's identifiers. So
 * A1 is a LOWER bound on lint preemption, not an estimate of it.
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

/** E1's history, from the committed manifest rather than hardcoded here. */
const e1 = JSON.parse(readFileSync(join(dataDir, "e1-commits.json"), "utf8"));

function git(...argv) {
  return execFileSync("git", argv, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// ───────────────────────────── A1 · lint preemption ─────────────────────────────

/**
 * Run the CURRENT oxlint config over a historical ref, via a detached worktree.
 *
 * The config path is absolute and outside the worktree on purpose: oxlint resolves
 * `--config` relative to its own cwd, and the historical tree has no config at all
 * (the lint gate is a Sextant artifact). Passing the live one is exactly the
 * intended question — "what would today's oracle have said about that code."
 */
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
      // oxlint exits non-zero WHEN IT FINDS SOMETHING, which is the normal case
      // here. Its findings are on stdout; only a missing binary or an unparseable
      // config would leave stdout empty, and that must not read as "clean".
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
    // A "site" is one place in the code, which is what a critic would have filed
    // ONE finding about. Two rules firing on the same JSX element is one defect,
    // and counting rule-hits instead would double it.
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

// The baseline is not a named field — it is the commit the manifest EXCLUDED from
// the fix set for being the baseline. Read it from there rather than restating the
// sha here, so the two can never disagree; and fail loudly if the shape changes,
// because silently falling back to some other ref would compare the wrong code.
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

/**
 * Did a converged-head site SURVIVE from the baseline, or is it new?
 *
 * Not by path and line — E1 renamed `GraphView.tsx` to `GraphCanvas.tsx` and
 * extracted an inline element into its own component, so both moved. Match on the
 * rule set plus the offending source line's text, which is what actually stayed
 * the same. Anything that fails to match is reported as UNMATCHED rather than
 * silently classified either way.
 */
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
    // Duplicate findings that triage merged. Note this is a DEDUPLICATION figure
    // and nothing else: several critics reporting one theme is not corroboration,
    // and this number must never be read as a severity signal.
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
// Per AGENT, not per critic: each round spends its critics plus one triage agent,
// and dividing by critics alone would inflate the unit cost of a skip.
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
    // What "introduced" does and does not assert. The match is on the offending
    // source line's TEXT, so this bucket means "this line did not exist at the
    // baseline" — a fact. It does NOT assert the defect class is new. In this run
    // the one entry is `Notice.tsx:5`, which is the baseline's `App.tsx:153`
    // notice element extracted into its own component during review: a new line
    // carrying an equivalent defect. Both readings are in the data above; the
    // stronger claim is `survivedAll21Rounds`, which needs no interpretation.
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
