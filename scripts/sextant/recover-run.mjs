/**
 * Reconstruct a scoring run from its transcripts, when the run itself cannot finish.
 *
 * `resumeFromRunId` handles the ordinary case: completed agents replay from cache and only the
 * killed ones re-run. This is the backstop for when that is not enough — repeated usage-limit
 * halts, a run that can never complete, or simply wanting the partial picture *now* without
 * spending more agents.
 *
 * Everything needed is already on disk and survives container restarts, because it lives under
 * ~/.claude/projects rather than in the repo:
 *   journal.jsonl              — one {type:"result", agentId, result} per completed agent
 *   agent-<id>.jsonl           — first line is the prompt, which names the lens AND the worktree
 *
 * Joining those two gives seed -> lens -> findings without re-running anything.
 *
 * Usage:
 *   node scripts/sextant/recover-run.mjs <runId> [--json]
 *
 * IMPORTANT — it reports COMPLETENESS, not just results. A round missing a lens is marked
 * `complete: false` and excluded from any recall figure, for the same reason the runner now treats
 * a null agent as errored: a partial round scored as if whole produces a false blind spot, which is
 * the most misleading output this harness can emit.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECTS = "/root/.claude/projects";

const runId = process.argv[2];
if (!runId) {
  console.error("usage: node scripts/sextant/recover-run.mjs <runId> [--json]");
  process.exit(2);
}

/** Find the transcript dir for a run id, wherever the project hash puts it. */
function findRunDir(id) {
  // Layout is PROJECTS/<projectHash>/<sessionId>/subagents/workflows/<runId>, but the session level
  // is not guaranteed, so try both depths rather than hardcoding one.
  const candidates = [];
  for (const proj of readdirSync(PROJECTS, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const base = join(PROJECTS, proj.name);
    candidates.push(join(base, "subagents/workflows", id));
    let sessions = [];
    try {
      sessions = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      /* unreadable project dir */
    }
    for (const s of sessions) candidates.push(join(base, s.name, "subagents/workflows", id));
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

const dir = findRunDir(runId);
if (!dir) {
  console.error(`no transcript dir for ${runId} under ${PROJECTS}`);
  process.exit(1);
}

const jsonl = (p) =>
  readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

// agentId -> { lens, worktree } parsed out of the prompt the agent was given.
const LENSES = ["correctness", "security", "SOLID/architecture", "maintainability", "interaction/accessibility"];
const LENS_KEY = { "SOLID/architecture": "critic-solid", "interaction/accessibility": "critic-interaction" };
const agents = new Map();
for (const f of readdirSync(dir)) {
  if (!f.startsWith("agent-") || !f.endsWith(".jsonl")) continue;
  const id = f.slice("agent-".length, -".jsonl".length);
  const first = jsonl(join(dir, f))[0];
  const text = typeof first?.message?.content === "string" ? first.message.content : JSON.stringify(first?.message?.content ?? "");
  const wt = /\.sextant-worktrees\/(wt-\d+)/.exec(text)?.[1] ?? null;
  const lensName = LENSES.find((l) => text.includes(`adversarial ${l}`)) ?? null;
  const lens = lensName ? (LENS_KEY[lensName] ?? `critic-${lensName}`) : text.includes("Cluster these findings") ? "triage" : null;
  if (wt || lens) agents.set(id, { worktree: wt, lens });
}

const results = jsonl(join(dir, "journal.jsonl")).filter((e) => e.type === "result");

// worktree -> lens -> result
const rounds = new Map();
let unmapped = 0;
for (const r of results) {
  const meta = agents.get(r.agentId);
  if (!meta?.worktree || !meta.lens || meta.lens === "triage") {
    if (!meta?.worktree) unmapped++;
    continue;
  }
  const round = rounds.get(meta.worktree) ?? new Map();
  round.set(meta.lens, r.result);
  rounds.set(meta.worktree, round);
}

const EXPECTED_LENSES = ["critic-correctness", "critic-security", "critic-solid", "critic-maintainability", "critic-interaction"];

const out = {
  runId,
  transcriptDir: dir,
  note: "Reconstructed from transcripts, not from the workflow's return value. A round missing a lens is complete:false and MUST be excluded from any recall figure — a partial round scored as whole produces a false blind spot.",
  totals: { agentResults: results.length, mappedRounds: rounds.size, unmappedResults: unmapped },
  rounds: [...rounds.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([worktree, byLens]) => {
      const present = EXPECTED_LENSES.filter((l) => byLens.has(l));
      const missing = EXPECTED_LENSES.filter((l) => !byLens.has(l));
      const findings = [];
      for (const l of present) {
        const res = byLens.get(l);
        for (const f of res?.findings ?? []) findings.push({ critic: l, ...f });
      }
      return {
        worktree,
        complete: missing.length === 0,
        lensesPresent: present,
        lensesMissing: missing,
        nothingFoundLenses: present.filter((l) => byLens.get(l)?.nothingFound === true),
        findingCount: findings.length,
        findings,
      };
    }),
};

const complete = out.rounds.filter((r) => r.complete);
out.summary = {
  completeRounds: complete.length,
  partialRounds: out.rounds.length - complete.length,
  usable: complete.length > 0,
  warning:
    out.rounds.length > complete.length
      ? `${out.rounds.length - complete.length} round(s) are missing at least one lens and are NOT scoreable. Resume the run rather than scoring these.`
      : null,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const dest = join(ROOT, "docs/findings/critical-review/2026-07-25-sextant/data", `recovered-${runId}.json`);
  writeFileSync(dest, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Recovered ${runId} from transcripts\n`);
  console.log(`  agent results: ${out.totals.agentResults}   rounds seen: ${out.rounds.length}   unmapped: ${out.totals.unmappedResults}\n`);
  for (const r of out.rounds) {
    console.log(
      `  ${r.worktree}  ${r.complete ? "COMPLETE" : "partial "}  ${String(r.lensesPresent.length)}/5 lenses  ` +
        `${String(r.findingCount).padStart(3)} findings` +
        (r.complete ? "" : `   missing: ${r.lensesMissing.map((l) => l.replace("critic-", "")).join(", ")}`),
    );
  }
  console.log(`\n  ${out.summary.completeRounds} complete, ${out.summary.partialRounds} partial`);
  if (out.summary.warning) console.log(`  ${out.summary.warning}`);
  console.log(`\n  written to ${dest.replace(ROOT + "/", "")}`);
}
