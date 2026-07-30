#!/usr/bin/env node
/**
 * Normalize the review runner's raw per-round output into E1/Ouroboros's dataset shapes, so
 * Sextant's numbers can be compared with E1's rather than merely placed beside them.
 *
 * Reads every `data/rounds/*.json` and writes `perRound.json`, `rounds.json` and
 * `findings_full.json` next to them. Lens names are normalized to the SHORT form and paths to
 * repo-relative, because E1's committed dataset mixes both and a joint query needs one of each.
 *
 * Usage: node scripts/review-metrics/round-log.mjs <dataDir>
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dataDir = resolve(process.argv[2] ?? "docs/findings/critical-review/2026-07-25-sextant/data");
const roundsDir = join(dataDir, "rounds");

if (!existsSync(roundsDir)) {
  console.error(`no rounds directory at ${roundsDir}`);
  process.exit(1);
}

const REPO_ROOT = resolve(process.cwd());

function relPath(file) {
  if (typeof file !== "string" || file === "") return "";
  const normalized = file.replaceAll("\\", "/");
  const root = REPO_ROOT.replaceAll("\\", "/") + "/";
  return normalized.startsWith(root) ? normalized.slice(root.length) : normalized;
}

/** `critic-correctness` and `correctness` are the same lens; E1 used both. */
function shortLens(name) {
  return typeof name === "string" ? name.replace(/^critic-/, "") : "";
}

const files = readdirSync(roundsDir).filter((f) => f.endsWith(".json")).sort();
const rounds = [];
const perRound = [];
const findings = [];

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(roundsDir, file), "utf8"));
  // The runner returns a null `round` when its args arrived as a string, so the
  // filename is the fallback of record.
  const round = raw.round ?? Number(/(\d+)/.exec(file)?.[1] ?? 0);
  const target = raw.target ?? "";

  const confirmed = raw.confirmed ?? [];
  const deferrals = raw.deferrals ?? [];
  const plausible = raw.plausible ?? [];

  for (const [bucket, verdict] of [
    [confirmed, "CONFIRMED"],
    [deferrals, "CONFIRMED"], // a deferral is a confirmed finding that does not gate
    [plausible, "PLAUSIBLE"],
  ]) {
    for (const f of bucket) {
      findings.push({
        round,
        target,
        verdict,
        severity: f.severity ?? "",
        critic: shortLens(f.critic),
        class: f.class ?? "",
        theme: f.theme ?? "",
        file: relPath(f.file),
        line: f.line ?? null,
        summary: f.summary ?? "",
        failure: f.failure ?? "",
        remediation: f.remediation ?? "",
        invariant: f.invariant ?? null,
        caseOnly: f.caseOnly === true,
      });
    }
  }

  const roundFindings = findings.filter((f) => f.round === round && f.target === target);
  const files_ = [...new Set(roundFindings.map((f) => f.file).filter(Boolean))];
  const classes = [...new Set(roundFindings.map((f) => f.class).filter(Boolean))];

  perRound.push({
    round,
    target,
    converged: raw.converged === true,
    confirmed: confirmed.length,
    blocking: raw.counts?.blocking ?? confirmed.filter((f) => f.severity === "blocking").length,
    deferrals: deferrals.length,
    plausible: plausible.length,
    themes: raw.counts?.themes ?? (raw.themes ?? []).length,
    totalFindings: confirmed.length + deferrals.length + plausible.length,
    files: files_,
    classes,
    // The E4 cost series — recorded per round so it never has to be reconstructed after the fact.
    subagentTokens: raw.tokens?.subagentTokens ?? null,
    agents: raw.tokens?.agents ?? null,
    toolCalls: raw.tokens?.toolCalls ?? null,
  });

  rounds.push({
    file,
    runId: raw.runId ?? null,
    round,
    target,
    converged: raw.converged === true,
    counts: raw.counts ?? {},
    byCritic: (raw.byCritic ?? []).map((c) => ({
      critic: shortLens(c.critic),
      model: c.model ?? null,
      nothingFound: c.nothingFound === true,
      findings: c.findings ?? 0,
      // A dead lens that reads as a clean one is the one failure mode that can fabricate a
      // convergence.
      errored: c.errored === true,
      erroredReason: c.erroredReason ?? null,
    })),
    skipped: raw.skipped ?? [],
    saturation: raw.saturation ?? {},
  });
}

const write = (name, value) => {
  writeFileSync(join(dataDir, name), JSON.stringify(value, null, 2) + "\n");
};
write("perRound.json", perRound);
write("rounds.json", rounds);
write("findings_full.json", findings);

const dead = rounds.flatMap((r) => r.byCritic.filter((c) => c.errored).map((c) => `${r.file}:${c.critic}`));
console.log(
  `round-log: ${files.length} round(s), ${findings.length} finding(s), ` +
    `${perRound.reduce((a, r) => a + (r.subagentTokens ?? 0), 0).toLocaleString()} subagent tokens`,
);
if (dead.length > 0) {
  // Loud, not a footnote: a round with a dead lens cannot support an absence claim, and "0
  // findings" from a lens that never ran looks identical to a clean one downstream.
  console.log(`round-log: WARNING — ${dead.length} dead lens/lenses: ${dead.join(", ")}`);
}
