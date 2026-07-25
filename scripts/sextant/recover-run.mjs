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
 * WHAT PARTIAL DATA CAN AND CANNOT SUPPORT. Incomplete does not mean worthless — the observations
 * are real and are never discarded. The asymmetry is between two kinds of claim:
 *
 *   EXISTENCE  "critic-correctness found sd-13"  — VALID from a partial round. A positive
 *              observation stands alone; it does not matter that another lens never ran.
 *   ABSENCE    "the ensemble missed sd-15"       — INVALID. Absence requires that the whole
 *              ensemble actually looked. This is the fabricated blind spot that the first
 *              contaminated run nearly published.
 *   RATIO      "recall = 4/5"                    — INVALID, because it is an absence claim wearing
 *              a ratio's clothes: the denominator asserts the ensemble looked at all five.
 *
 * So per seed this reports `found` (a lens matched it — durable), or `indeterminate` (nothing
 * matched YET and the ensemble is incomplete — say nothing), and only ever `missed` once every lens
 * has reported. Resume remains the primary path; this is the backstop that keeps the confirmed hits
 * while refusing to invent the misses.
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

/** Mirrors the matcher in .claude/workflows/mutation-recall.js. The duplication is forced: workflow
    scripts cannot import. Kept textually identical so the two cannot disagree about what a hit is. */
const STOP = new Set(["that", "with", "from", "when", "this", "code", "test", "tests", "value", "values", "into"]);
const normPath = (p) => String(p ?? "").replace(/^.*?((?:lib|app)\/)/, "$1").replace(/^\.\//, "");
const tokens = (x) => new Set(String(x ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3 && !STOP.has(t)));
function matches(finding, seed) {
  if (normPath(finding.file) !== normPath(seed.file)) return { strict: false, loose: false };
  const nearby = finding.line != null && seed.line != null && Math.abs(finding.line - seed.line) <= 10;
  const seedT = new Set([...tokens(seed.class), ...tokens(seed.theme)]);
  const shared = [...tokens(finding.class), ...tokens(finding.theme)].some((t) => seedT.has(t));
  // Both levels, because the pre-registration commits to reporting both: quoting only the
  // flattering one would be the same error as quoting a single blame configuration.
  return { strict: !!nearby, loose: !!nearby || shared };
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

// Per-seed status, honouring the existence/absence asymmetry above.
let seedStatus = [];
try {
  const alloc = JSON.parse(readFileSync(join(ROOT, "docs/findings/critical-review/2026-07-25-sextant/data/allocation.json"), "utf8"));
  const bySlot = new Map(alloc.proseSubset.map((s) => [s.worktree.split("/").pop(), s]));
  seedStatus = out.rounds
    .filter((r) => bySlot.has(r.worktree))
    .map((r) => {
      const seed = bySlot.get(r.worktree);
      const scored = r.findings.map((f) => ({ f, m: matches(f, seed) }));
      const looseHits = scored.filter((h) => h.m.loose);
      const strictHits = scored.filter((h) => h.m.strict);
      const st = (hits) => (hits.length > 0 ? "found" : r.complete ? "missed" : "indeterminate");
      return {
        id: seed.id,
        worktree: r.worktree,
        // FOUND is durable even from a partial round — a missing lens can only ADD hits, never
        // remove one. MISSED is assertable only once every lens has reported; until then it is
        // INDETERMINATE and must never be called a blind spot.
        status: st(looseHits),
        statusStrict: st(strictHits),
        foundBy: [...new Set(looseHits.map((h) => h.f.critic))],
        foundByStrict: [...new Set(strictHits.map((h) => h.f.critic))],
        lensesMissing: r.lensesMissing,
      };
    });
} catch {
  /* allocation.json absent — skip per-seed status rather than guess */
}
out.seedStatus = seedStatus;

out.summary = {
  completeRounds: complete.length,
  partialRounds: out.rounds.length - complete.length,
  confirmedFound: seedStatus.filter((s) => s.status === "found").length,
  confirmedFoundStrict: seedStatus.filter((s) => s.statusStrict === "found").length,
  indeterminate: seedStatus.filter((s) => s.status === "indeterminate").length,
  indeterminateStrict: seedStatus.filter((s) => s.statusStrict === "indeterminate").length,
  confirmedMissed: seedStatus.filter((s) => s.status === "missed").length,
  seeds: seedStatus.length,
  recallComputable: seedStatus.length > 0 && seedStatus.every((s) => s.status !== "indeterminate"),
  recallComputableStrict: seedStatus.length > 0 && seedStatus.every((s) => s.statusStrict !== "indeterminate"),
  warning:
    out.rounds.length > complete.length
      ? `${out.rounds.length - complete.length} round(s) are missing a lens. FOUND results below are durable and may be cited; INDETERMINATE seeds must NOT be reported as misses or blind spots, and no recall ratio may be computed until every lens has reported. Resume the run to resolve them.`
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
  if (out.seedStatus.length) {
    console.log("\n  per seed:");
    for (const s of out.seedStatus) {
      const tag = (v) => (v === "found" ? "FOUND" : v === "missed" ? "missed" : "indet.");
      console.log(
        `    loose=${tag(s.status).padEnd(6)} strict=${tag(s.statusStrict).padEnd(6)}  ${s.id}` +
          (s.foundBy.length ? `  <- ${s.foundBy.map((c) => c.replace("critic-", "")).join(", ")}` : ""),
      );
    }
  }
  console.log(`\n  ${out.summary.completeRounds} complete, ${out.summary.partialRounds} partial` +
    `\n  loose : found ${out.summary.confirmedFound}/${out.summary.seeds}, indeterminate ${out.summary.indeterminate}  -> recall ${out.summary.recallComputable ? "computable" : "NOT computable"}` +
    `\n  strict: found ${out.summary.confirmedFoundStrict}/${out.summary.seeds}, indeterminate ${out.summary.indeterminateStrict}  -> recall ${out.summary.recallComputableStrict ? "computable" : "NOT computable"}`);
  if (out.summary.warning) console.log(`  ${out.summary.warning}`);
  console.log(`\n  written to ${dest.replace(ROOT + "/", "")}`);
}
