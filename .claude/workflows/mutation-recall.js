// Score a review configuration against SEEDED defects, so "we found more bugs" stops being
// unfalsifiable. This is the keystone of the external-oracle proposal (Lever B1): without known
// defects, every outcome has two readings, and a seeded defect that survives to convergence is a
// blind spot by definition.
//
//   Workflow({ name: "mutation-recall", args: { seeds: [...], controls: [...], config: "proposed" } })
//
// WORKTREES ARE CREATED BY THE CALLER. Workflow scripts have no filesystem access, so this cannot
// apply patches or run `git worktree` (the proposal assumed it could). The caller prepares one
// worktree per seed — one defect each, so seeds can never interact — and passes the paths in.
//
// args: {
//   seeds:    [{ id, worktree, file, line, stratum, class, theme, note }],
//   controls: [{ id, worktree }],        // unseeded, known-good: every finding here is a false positive
//   config:   "proposed" | "baseline",   // recorded, not interpreted
//   saturation: {...}                    // optional, passed through to each round
// }

export const meta = {
  name: 'mutation-recall',
  description: 'Score a review configuration on recall against a seeded-defect corpus, and on precision against unseeded controls.',
  phases: [
    { title: 'Recall', detail: 'one review round per seeded worktree' },
    { title: 'Precision', detail: 'one review round per clean control worktree' },
    { title: 'Score', detail: 'mechanical seed matching, no agent judgement' },
  ],
}

const seeds = args?.seeds ?? []
const controls = args?.controls ?? []
const config = args?.config ?? 'unspecified'

if (seeds.length === 0) throw new Error('mutation-recall: args.seeds is empty — nothing to score')

/** E1's dataset mixes absolute and relative paths; normalize both sides before comparing. */
function normPath(p) {
  if (!p) return ''
  return String(p)
    .replace(/^.*?((?:lib|app)\/)/, '$1')
    .replace(/^\.\//, '')
}

/** Significant tokens from a class/theme label, for overlap matching. */
function tokens(s) {
  return new Set(
    String(s ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3 && !STOP.has(t)),
  )
}
const STOP = new Set(['that', 'with', 'from', 'when', 'this', 'code', 'test', 'tests', 'value', 'values', 'into'])

/**
 * MECHANICAL seed matching. Deliberately not an agent judging whether a finding "counts" — that
 * would put self-grading back at the centre of the one instrument built to remove it.
 *
 * Two strictness levels are reported, because the choice is a real degree of freedom and hiding it
 * would be the same sin as quoting a single blame configuration:
 *   - `strict`: same file AND the cited line within ±LINE_WINDOW of the seeded line.
 *   - `loose` : same file AND (line window OR a shared significant token with the seed's class/theme).
 * `loose` can over-credit when a file has unrelated real defects; `strict` can under-credit when a
 * critic cites the symptom line rather than the seeded one. Publish both.
 *
 * Verified against six cases before first use — exact hit, absolute-path hit, same-file/far-line
 * with a shared token (loose only), same-file/far-line without overlap (miss), different file
 * (miss), and no line recorded (miss) — so the matcher is known to be able to report a MISS, not
 * just a hit. A scorer that only ever says "found" would make recall meaningless.
 *
 * Accepted limitation: workflow scripts cannot import, so this logic cannot be shared with a unit
 * test in `lib/` or `app/` without keeping two copies that could drift. Given the choice between a
 * permanent test over a duplicated copy and a verified single copy, the single copy wins — the same
 * trade the critic gating config makes, except there the duplication was forced and here it is not.
 */
const LINE_WINDOW = 10
function matches(finding, seed) {
  if (normPath(finding.file) !== normPath(seed.file)) return { strict: false, loose: false }
  const nearby = finding.line != null && seed.line != null && Math.abs(finding.line - seed.line) <= LINE_WINDOW
  const seedTokens = new Set([...tokens(seed.class), ...tokens(seed.theme)])
  const findTokens = new Set([...tokens(finding.class), ...tokens(finding.theme)])
  const shared = [...findTokens].some((t) => seedTokens.has(t))
  return { strict: !!nearby, loose: !!nearby || shared }
}

/** Every finding a round reported, at any severity or verdict. Recall asks "did any lens SEE it",
    which is a different question from "did it gate convergence" — a seed spotted but graded
    PLAUSIBLE was still found. Both are reported. */
function allFindings(round) {
  const out = []
  for (const key of ['gating', 'confirmed', 'deferrals', 'plausible']) {
    for (const f of round?.[key] ?? []) out.push(f)
  }
  // De-duplicate: `gating` is a subset of `confirmed`.
  const seen = new Set()
  return out.filter((f) => {
    const k = `${f.critic}|${f.class}|${f.file}|${f.line}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

phase('Recall')
const seedRuns = await pipeline(
  seeds,
  (s) =>
    workflow('adversarial-review', {
      target: s.worktree,
      saturation: args?.saturation ?? {},
      modelOverride: args?.modelOverride ?? null,
      round: 1,
    }).catch(() => null),
  (round, s) => {
    if (!round) return { seed: s, errored: true, found: { strict: false, loose: false }, byLens: [], findings: 0 }
    const found = allFindings(round)
    const hits = found.map((f) => ({ f, m: matches(f, s) }))
    const strictHits = hits.filter((h) => h.m.strict)
    const looseHits = hits.filter((h) => h.m.loose)
    return {
      seed: s,
      errored: false,
      findings: found.length,
      found: { strict: strictHits.length > 0, loose: looseHits.length > 0 },
      // Which lenses found it — the substrate for leave-one-lens-out and marginal-recall-per-lens.
      byLens: [...new Set(looseHits.map((h) => h.f.critic))],
      gatedBy: [...new Set(looseHits.filter((h) => (round.gating ?? []).includes(h.f)).map((h) => h.f.critic))],
      converged: round.converged,
      counts: round.counts,
      skipped: round.skipped ?? [],
    }
  },
)

phase('Precision')
const controlRuns = controls.length
  ? await pipeline(
      controls,
      (c) => workflow('adversarial-review', { target: c.worktree, saturation: args?.saturation ?? {}, modelOverride: args?.modelOverride ?? null, round: 1 }).catch(() => null),
      (round, c) => ({
        control: c.id,
        errored: !round,
        // There is no seeded defect here, so every finding is a candidate false positive. Whether it
        // is an EFFECTIVE false positive (Google's definition: nobody took a positive action) can
        // only be settled by adjudication afterwards — this records the raw count honestly.
        findings: round ? allFindings(round).length : 0,
        gating: round?.counts?.gating ?? 0,
        byCritic: round?.byCritic ?? [],
      }),
    )
  : []

phase('Score')
const scored = seedRuns.filter((r) => r && !r.errored)
const errored = seedRuns.filter((r) => !r || r.errored)

function recallOf(pick) {
  return scored.length === 0 ? 0 : scored.filter(pick).length / scored.length
}

/** Leave-one-lens-out: retiring lens L costs recall only on seeds L ALONE found. Valid because the
    lenses run in parallel and independently, so one lens's absence cannot make another find more. */
const lenses = [...new Set(scored.flatMap((r) => r.byLens))]
const leaveOneOut = lenses.map((lens) => {
  const soleSource = scored.filter((r) => r.byLens.length === 1 && r.byLens[0] === lens)
  return {
    lens,
    seedsFound: scored.filter((r) => r.byLens.includes(lens)).length,
    soleSourceSeeds: soleSource.map((r) => r.seed.id),
    recallWithoutIt: scored.length === 0 ? 0 : Number(((scored.filter((r) => r.found.loose).length - soleSource.length) / scored.length).toFixed(4)),
  }
})

/** Per-stratum, never pooled: hand-authored defects are measurably harder to detect than real ones,
    so a lower figure on that stratum is an artifact, not a signal. */
const strata = [...new Set(scored.map((r) => r.seed.stratum ?? 'unspecified'))]
const byStratum = strata.map((stratum) => {
  const rows = scored.filter((r) => (r.seed.stratum ?? 'unspecified') === stratum)
  return {
    stratum,
    n: rows.length,
    foundStrict: rows.filter((r) => r.found.strict).length,
    foundLoose: rows.filter((r) => r.found.loose).length,
  }
})

const blindSpots = scored.filter((r) => !r.found.loose).map((r) => ({ id: r.seed.id, stratum: r.seed.stratum, class: r.seed.class, file: r.seed.file }))

log(
  `mutation-recall (${config}): ${scored.filter((r) => r.found.loose).length}/${scored.length} seeds found (loose), ` +
    `${scored.filter((r) => r.found.strict).length}/${scored.length} strict, ${blindSpots.length} blind spots, ` +
    `${controlRuns.reduce((a, c) => a + c.findings, 0)} findings on ${controlRuns.length} clean controls.`,
)
if (errored.length) log(`WARNING: ${errored.length} seed run(s) errored and are excluded from the denominator`)

return {
  config,
  seedCount: seeds.length,
  scoredCount: scored.length,
  erroredSeeds: errored.map((r) => r?.seed?.id ?? 'unknown'),
  recall: { strict: Number(recallOf((r) => r.found.strict).toFixed(4)), loose: Number(recallOf((r) => r.found.loose).toFixed(4)) },
  matching: { lineWindow: LINE_WINDOW, note: 'strict = same file + line window; loose = strict OR shared class/theme token. Mechanical; no agent judges whether a finding counts.' },
  byStratum,
  leaveOneOut,
  blindSpots,
  controls: controlRuns,
  perSeed: scored.map((r) => ({ id: r.seed.id, stratum: r.seed.stratum, found: r.found, byLens: r.byLens, findings: r.findings, converged: r.converged })),
  caveats: [
    'Recall is a RELATIVE discriminator between configurations, not an absolute capability estimate. Never state "the loop finds N% of defects".',
    'At n~12 a Wilson 95% CI is roughly +/-25 points; existence and zero-loss claims are supportable, effect-size comparisons are not.',
    'Strata are reported separately on purpose: hand-authored seeds are harder to detect than real faults, so cross-stratum comparison is invalid.',
    'Controls measure raw false positives. Whether each is an EFFECTIVE false positive needs adjudication after the run.',
  ],
}
