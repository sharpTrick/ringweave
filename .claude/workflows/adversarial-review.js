// One full adversarial review round, executable so scope/count/structure/convergence stop being
// judgment calls. See docs/REVIEW_PROTOCOL.md for the loop, the anti-patterns, and why this is
// executable rather than prose.
//
//   Workflow({ name: "adversarial-review", args: "app/src (the BuddyGraph app)" })
//   Workflow({ name: "adversarial-review", args: { target: "app/src", changedPaths: [...],
//                                                  saturation: {...}, round: 7 } })
//
// The string form is the original calling convention and still works. The object form adds
// saturation gating, which needs the previous round's state and the paths that changed.
//
// WHY THE CALLER OWNS THE STATE FILE: workflow scripts run without filesystem access, so this
// cannot read or write `.claude/review-state.json` itself (the review proposal specified that it
// would; the runtime does not allow it). Instead the caller passes `saturation` in and persists the
// `saturation` object this returns. The workflow stays pure; the state stays durable.

export const meta = {
  name: 'adversarial-review',
  description: 'Run one full adversarial review round: all non-saturated lenses, full-surface, structured findings, theme-clustered, computed convergence.',
  phases: [
    { title: 'Review', detail: 'independent lenses in parallel over the whole component' },
    { title: 'Triage', detail: 'cluster findings by theme so one root cause is fixed once' },
  ],
}

const input = typeof args === 'string' ? { target: args } : (args ?? {})
const TARGET = (input.target ?? '').trim() || 'app/src'
const changedPaths = input.changedPaths ?? []
const priorSaturation = input.saturation ?? {}
// Forces every lens onto one model, for the Sextant experiment's paired homogeneous arm. Holding the
// LENS SET fixed and varying only the backbone is what isolates model diversity from lens count —
// E1 ran four lenses all on opus, so a four-lens comparison would confound the two. Unset in normal
// operation, where each lens keeps the model declared in its frontmatter.
const modelOverride = input.modelOverride ?? null

// The executable copy of each lens's gating config. The critic .md frontmatter carries the same
// `surface`/`saturation_gate` for humans reading the agent definition; THIS is what actually runs,
// and `scripts/hygiene/run.mjs` fails the lint gate if the two ever disagree.
//
// Models are deliberately spread across families. Four personas on one backbone buy far less
// independence than they appear to — measured work on agent ensembles puts prompt-persona diversity
// at roughly a fifth the decorrelation of different backbone models, with homogeneous ensembles
// saturating around N=4. Correctness and security keep the strongest model because between them
// they caught 10 of the 13 blocking findings in the run we measured.
const CRITICS = [
  {
    type: 'critic-correctness',
    model: 'opus',
    saturationGate: 3,
    surface: ['lib/src/**', 'app/src/model.ts', 'app/src/state/**', 'app/src/graph/**', 'app/src/io/**', 'app/src/worker/**'],
    lens: 'correctness — determinism (including Set/Map iteration-order dependence), off-by-one, wrong output or wrong DISPLAYED numbers, contract violations, and whether the tests would actually catch the failure',
  },
  {
    type: 'critic-security',
    model: 'opus',
    saturationGate: 2,
    surface: ['**/io/**', '**/worker/**', '**/*parse*', '**/*import*', '**/*export*', '**/*download*', 'lib/src/core/graph.ts', 'lib/src/core/constraints.ts'],
    lens: 'robustness/DoS — unbounded work from attacker-chosen numbers, size gates that run after the work they should bound, untrusted names reaching a spreadsheet/clipboard sink, and any hang (incl. main-thread) reachable from hostile input',
  },
  {
    type: 'critic-solid',
    model: 'sonnet',
    saturationGate: 2,
    surface: ['lib/src/**', 'app/src/**'],
    lens: 'SOLID/architecture — responsibility boundaries, coupling, over-abstraction, and whether the declared extension seams are genuinely open for a change the project has actually committed to',
  },
  {
    type: 'critic-maintainability',
    model: 'haiku',
    saturationGate: 2,
    surface: ['lib/src/**', 'app/src/**'],
    lens: 'maintainability — comments that are now FALSE (not merely missing), misleading names, silently drifting duplication, and a public surface that is easy to misuse',
  },
  {
    type: 'critic-interaction',
    model: 'sonnet',
    saturationGate: 2,
    surface: ['app/src/**'],
    lens: 'interaction/accessibility — keyboard reachability across components, focus order and dead ends, live-region announcement, reduced motion, and the error/empty paths',
  },
]

// Shared finding shape. `additionalProperties: false` at both levels, so a field a critic invents
// is rejected rather than silently dropped.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nothingFound: {
      type: 'boolean',
      description: 'true iff a genuine attempt to break it found nothing (name what you checked)',
    },
    checked: { type: 'string', description: 'what you examined, so a clean result is auditable' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: {
            enum: ['blocking', 'suggestion', 'deferral'],
            description: 'deferral = an abstraction/seam with NO caller in the current tree; logged, never gating',
          },
          verdict: { enum: ['CONFIRMED', 'PLAUSIBLE'] },
          class: { type: 'string', description: 'kebab slug of the finding TYPE (a filing label only)' },
          theme: {
            type: 'string',
            description: 'the underlying concern in plain language, stable across labels — e.g. "untrusted names reach a spreadsheet sink". The runner clusters on this, so two lenses reporting one root cause get fixed once.',
          },
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          failure: { type: 'string', description: 'concrete input -> wrong output / hang' },
          remediation: { type: 'string' },
          invariant: {
            type: 'string',
            description: 'a MACHINE-CHECKABLE property that must hold for ALL inputs — not a list of inputs to try',
          },
          caseOnly: {
            type: 'boolean',
            description: 'true iff no invariant could be stated; the finding is filed but does not gate convergence',
          },
        },
        required: ['severity', 'verdict', 'class', 'theme', 'file', 'summary', 'failure', 'remediation'],
      },
    },
  },
  required: ['nothingFound', 'findings'],
}

const CLUSTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          theme: { type: 'string' },
          severity: { enum: ['blocking', 'suggestion', 'deferral'] },
          critics: { type: 'array', items: { type: 'string' } },
          findingSummaries: { type: 'array', items: { type: 'string' } },
          remediation: { type: 'string', description: 'ONE fix that closes the theme, by subtraction' },
        },
        required: ['theme', 'severity', 'findingSummaries', 'remediation'],
      },
    },
  },
  required: ['themes'],
}

/** Minimal glob matcher — `**` spans separators, `*` does not. No minimatch dependency exists here
    (lib is zero-dep by contract and app has no glob library), and gating must not be approximate. */
function globMatch(path, pattern) {
  let rx = ""
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          rx += "(?:.*/)?" // `**/` may match zero directories, so `**/io/**` matches `app/io/x`
          i += 2
        } else {
          rx += ".*"
          i += 1
        }
      } else {
        rx += "[^/]*" // a single `*` never crosses a path separator
      }
    } else if (".+^${}()|[]\\?".includes(c)) {
      rx += "\\" + c
    } else {
      rx += c
    }
  }
  return new RegExp("^" + rx + "$").test(path)
}

// A lens is skipped only when it has been quiet for its full gate AND nothing it is responsible for
// changed. Both halves matter: quiet alone means the LENS saturated, not that the SURFACE is clean.
const active = []
const skipped = []
for (const c of CRITICS) {
  const streak = priorSaturation[c.type]?.nothingFoundStreak ?? 0
  if (streak < c.saturationGate) {
    active.push(c)
    continue
  }
  const touched = changedPaths.some((p) => c.surface.some((g) => globMatch(p, g)))
  if (touched) {
    active.push(c)
  } else {
    skipped.push({ critic: c.type, reason: `saturated (${streak} quiet rounds), surface untouched` })
    log(`skipping ${c.type} — saturated (${streak} quiet rounds), no changed path on its surface`)
  }
}

function prompt(c) {
  return [
    `Full-surface adversarial ${c.lens} review of: ${TARGET}.`,
    `Review the WHOLE component AS IT STANDS NOW — NOT a diff, and NOT "only what changed since the last round." A diff-scoped review hides everything the current anchors sit on top of.`,
    `Read every relevant file under the target (and its tests). Try hard to BREAK it. VERIFY each issue against the code (trace or reproduce) before reporting — mark verdict CONFIRMED only when you traced/reproduced it, otherwise PLAUSIBLE.`,
    ``,
    `REPORTING CONTRACT (this is the authoritative copy):`,
    `1. For every finding, name the THEME — the underlying concern in plain language, stable across labels ("untrusted names reach a spreadsheet sink"). Two lenses reporting one root cause must be fixed once; the runner clusters on this field, and clustering is for DEDUPLICATION ONLY. Agreement between lenses is NOT corroboration and must not raise your confidence.`,
    `2. State an INVARIANT: a machine-checkable property that must hold for ALL inputs. Good: "quality === 0 whenever aspl === null"; "no cell reaching a spreadsheet sink begins with =,+,-,@ after any embedded delimiter split". Bad: "parameterize over n in [1,4,50]" — that is a case table, and a fix written for those cases passes it by construction. If you genuinely cannot state one, set caseOnly=true; the finding is still filed but does not gate convergence.`,
    `3. OUT OF SCOPE, do not file: (a) LINT CLASSES — stale comments, unused exports/params, dead CSS hooks, a literal mirroring a constant, committed scratch files. \`npm run lint\` at the repo root owns these and is clean before you were spawned; filing one wastes a round. (b) SEAMS FOR UNBUILT FEATURES — if a proposed abstraction has no caller in the current tree, file it with severity "deferral", never blocking/suggestion. The test is mechanical: grep for a live reference.`,
    `4. If a genuine attempt to break it found nothing, set nothingFound=true and describe what you checked in \`checked\`. An honest empty round is a useful signal; a manufactured finding is worse than silence.`,
  ].join(' ')
}

phase('Review')
const results = await parallel(
  active.map((c) => () =>
    agent(prompt(c), { label: c.type, phase: 'Review', agentType: c.type, model: modelOverride ?? c.model, schema: SCHEMA })
      .then((r) => ({
        critic: c.type,
        model: modelOverride ?? c.model,
        nothingFound: !!(r && r.nothingFound),
        checked: (r && r.checked) || '',
        findings: (r && r.findings) || [],
      }))
      .catch(() => ({ critic: c.type, model: modelOverride ?? c.model, nothingFound: false, checked: '', findings: [], errored: true })),
  ),
)

const all = results.flatMap((r) => r.findings.map((f) => ({ critic: r.critic, ...f })))
const errored = results.filter((r) => r.errored).map((r) => r.critic)

// Deferrals are a logged decision, not open work, so they do not gate. Neither do case-only
// findings: without an invariant there is nothing durable to ratchet, and gating on them is what
// let a non-saturating lens set the stopping point last time.
const confirmed = all.filter((f) => f.verdict === 'CONFIRMED')
const gating = confirmed.filter((f) => f.severity !== 'deferral' && !f.caseOnly)
const blocking = confirmed.filter((f) => f.severity === 'blocking')
const deferrals = all.filter((f) => f.severity === 'deferral')
const plausible = all.filter((f) => f.verdict === 'PLAUSIBLE')

phase('Triage')
let themes = all.map((f) => ({ theme: f.theme, severity: f.severity, critics: [f.critic], findingSummaries: [f.summary], remediation: f.remediation }))
if (all.length > 1) {
  const clustered = await agent(
    [
      `Cluster these findings by THEME (the underlying concern), not by class label. Findings sharing a root cause must land in one cluster even when their labels, files and reporting lenses differ.`,
      `For each cluster give: theme, the single highest severity in it, which critics reported it, the finding summaries, and ONE remediation that closes the theme BY SUBTRACTION — remove a code path, tighten a boundary check, or unify two call sites. Never by adding an abstraction.`,
      `Return only the clustering. Do NOT invent, merge away, or re-grade findings, and do not treat multiple lenses reporting one theme as evidence it is more severe — that is duplication, not corroboration.`,
      ``,
      JSON.stringify(all.map((f) => ({ critic: f.critic, severity: f.severity, class: f.class, theme: f.theme, file: f.file, summary: f.summary, remediation: f.remediation }))),
    ].join(' '),
    { label: 'triage:theme-dedup', phase: 'Triage', model: 'sonnet', schema: CLUSTER_SCHEMA },
  ).catch(() => null)
  if (clustered && Array.isArray(clustered.themes)) themes = clustered.themes
}

if (errored.length) log(`WARNING: lenses errored (not a clean round): ${errored.join(', ')}`)
log(
  `Round over ${TARGET}: ${gating.length} gating (${blocking.length} blocking), ` +
    `${deferrals.length} deferral, ${plausible.length} plausible, across ${themes.length} theme(s).`,
)

// A skipped lens is a recorded decision and does not block; an ERRORED lens does, because a missing
// lens cannot be a clean signal.
const converged = gating.length === 0 && errored.length === 0

// Updated streaks for the caller to persist to .claude/review-state.json. A skipped lens keeps its
// streak (it did not run, so it learned nothing).
const saturation = {}
for (const c of CRITICS) {
  const prior = priorSaturation[c.type]?.nothingFoundStreak ?? 0
  const result = results.find((r) => r.critic === c.type)
  saturation[c.type] = {
    nothingFoundStreak: result ? (result.nothingFound && !result.errored ? prior + 1 : 0) : prior,
    lastRound: input.round ?? null,
    skipped: !result,
  }
}

return {
  target: TARGET,
  round: input.round ?? null,
  modelOverride,
  converged,
  counts: {
    gating: gating.length,
    confirmed: confirmed.length,
    blocking: blocking.length,
    deferrals: deferrals.length,
    plausible: plausible.length,
    themes: themes.length,
  },
  byCritic: results.map((r) => ({
    critic: r.critic,
    model: r.model,
    nothingFound: r.nothingFound,
    findings: r.findings.length,
    checked: r.checked,
    errored: !!r.errored,
  })),
  skipped,
  themes,
  gating,
  confirmed,
  deferrals,
  plausible,
  saturation,
}
