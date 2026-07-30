#!/usr/bin/env node
/**
 * Derive each lens's saturation streak per target from the round record, and write
 * `.claude/review-state.json` for the next round to pass back in. The review workflow is pure — it
 * cannot touch the filesystem — so the caller owns this state, and a round invoked without it
 * restarts every streak at zero, silently skipping nothing and logging no reason.
 *
 * The state is DERIVED, never hand-maintained: the round files are the record, so the streaks are a
 * function of them and can be recomputed from scratch at any time.
 *
 * Streak rule, matching the workflow's own: +1 when a lens returns `nothingFound` and did not error,
 * 0 on any finding, and UNCHANGED when the lens was skipped — a skipped lens learned nothing.
 *
 * Usage: node scripts/review-metrics/saturation-state.mjs [dataDir] [stateFile]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dataDir = resolve(
  process.argv[2] ?? "docs/findings/critical-review/2026-07-25-sextant/data",
);
const stateFile = resolve(process.argv[3] ?? ".claude/review-state.json");
const roundsDir = join(dataDir, "rounds");

if (!existsSync(roundsDir)) {
  console.error(`no rounds directory at ${roundsDir}`);
  process.exit(1);
}

/** Rounds must be replayed in the order they RAN: the filename carries that order and the mtime does
 *  not, so re-saving a round file to fix a field would reorder history. */
const rounds = readdirSync(roundsDir)
  .filter((f) => f.endsWith(".json"))
  .map((file) => {
    const raw = JSON.parse(readFileSync(join(roundsDir, file), "utf8"));
    const m = /-round-(\d+)\.json$/.exec(file);
    return { file, round: m ? Number(m[1]) : Number.POSITIVE_INFINITY, raw };
  })
  .sort((a, b) => a.round - b.round);

/** `target` carries the whole JSON arg blob in the rounds run before the workflow learned to parse a
 *  JSON-string arg; recovering it beats discarding those rounds, which are most of the record. */
function targetOf(raw) {
  const t = typeof raw.target === "string" ? raw.target : "";
  const text = t.trim().startsWith("{") ? (JSON.parse(t).target ?? "") : t;
  return /^lib\b|^lib\//.test(text) ? "lib/src" : "app/src";
}

const state = {};
const timeline = [];
for (const { file, round, raw } of rounds) {
  const target = targetOf(raw);
  state[target] ??= {};
  const critics = Array.isArray(raw.byCritic) ? raw.byCritic : Object.values(raw.byCritic ?? {});
  const skippedNames = new Set((raw.skipped ?? []).map((s) => s.critic ?? s.lens ?? s));
  for (const c of critics) {
    if (!c.critic || skippedNames.has(c.critic)) continue;
    const prev = state[target][c.critic]?.nothingFoundStreak ?? 0;
    state[target][c.critic] = {
      nothingFoundStreak: c.nothingFound && !c.errored ? prev + 1 : 0,
      lastRound: round,
    };
  }
  timeline.push({
    file,
    target,
    round,
    quiet: critics.filter((c) => c.nothingFound && !c.errored).map((c) => c.critic),
  });
}

writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n");

// A SECOND COPY of the gates the runner applies, kept so this script can say "skippable" without
// spawning a workflow. Nothing checks the two agree, so change both together.
const GATES = {
  "critic-correctness": 3,
  "critic-security": 2,
  "critic-solid": 2,
  "critic-maintainability": 2,
  "critic-interaction": 2,
};

for (const [target, lenses] of Object.entries(state)) {
  console.log(`${target}`);
  for (const [critic, s] of Object.entries(lenses)) {
    const gate = GATES[critic] ?? 2;
    const at = s.nothingFoundStreak >= gate ? "  <- AT GATE, skippable when its surface is untouched" : "";
    console.log(`   ${critic.padEnd(24)} streak ${s.nothingFoundStreak}/${gate}  (last ran round ${s.lastRound})${at}`);
  }
}
console.log(`\nwrote ${stateFile}`);
