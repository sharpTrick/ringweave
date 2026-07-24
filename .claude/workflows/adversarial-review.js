// One full adversarial review round, executable so scope/count/structure/convergence stop
// being judgment calls. Spawns all four committed critics (.claude/agents/critic-*.md)
// FULL-SURFACE in parallel over the named target, collects structured findings, and returns
// a computed `converged` flag (true iff zero CONFIRMED findings). Re-run after each fix batch
// until a run made AFTER your last code change reports converged:true. See
// docs/REVIEW_PROTOCOL.md for the loop, the anti-patterns, and why this is executable.
//
//   Workflow({ name: "adversarial-review", args: "app/src (the BuddyGraph app)" })

export const meta = {
  name: 'adversarial-review',
  description: 'Run one full adversarial review round: all four critics, full-surface, structured findings, computed convergence.',
  phases: [{ title: 'Review', detail: 'four critics in parallel over the whole component' }],
}

const TARGET = typeof args === 'string' && args.trim() ? args.trim() : 'app/src'

// Shared finding shape so rounds are diffable and convergence is machine-detectable.
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
          severity: { enum: ['blocking', 'suggestion'] },
          verdict: { enum: ['CONFIRMED', 'PLAUSIBLE'] },
          class: { type: 'string', description: 'kebab slug of the finding TYPE (ratchet the class)' },
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          failure: { type: 'string', description: 'concrete input -> wrong output / hang' },
          remediation: { type: 'string' },
          testUpgrade: { type: 'string', description: 'parameterized/fuzz test guarding the class' },
        },
        required: ['severity', 'verdict', 'class', 'file', 'summary', 'failure', 'remediation'],
      },
    },
  },
  required: ['nothingFound', 'findings'],
}

const CRITICS = [
  { type: 'critic-correctness', lens: 'correctness — determinism, off-by-one, wrong output/derived numbers, contract violations, and whether tests actually catch the failure' },
  { type: 'critic-solid', lens: 'SOLID/architecture — responsibility boundaries, coupling, and whether the extension seams are genuinely open for the next reasonable change' },
  { type: 'critic-security', lens: 'robustness/DoS — unbounded loops, pathological/untrusted input, numeric overflow, and any hang (incl. main-thread) reachable from hostile input' },
  { type: 'critic-maintainability', lens: 'maintainability — dead code, duplication, misleading or stale names/comments, and unclear APIs' },
]

function prompt(lens) {
  return [
    `Full-surface adversarial ${lens} review of: ${TARGET}.`,
    `Review the WHOLE component AS IT STANDS NOW — NOT a diff, and NOT "only what changed since the last round." A diff-scoped review hides everything the current anchors sit on top of.`,
    `Read every relevant file under the target (and its tests). Try hard to BREAK it. VERIFY each issue against the code (trace or reproduce) before reporting — mark verdict CONFIRMED only when you traced/reproduced it, otherwise PLAUSIBLE.`,
    `Return the structured schema. If a genuine attempt to break it found nothing, set nothingFound=true and describe what you checked. Otherwise list findings; for each, give the concrete failing input -> wrong/hang, a remediation, and a testUpgrade that guards the CLASS (a parameterized or fuzz case), not just the one input.`,
  ].join(' ')
}

phase('Review')
const results = await parallel(
  CRITICS.map((c) => () =>
    agent(prompt(c.lens), { label: c.type, phase: 'Review', agentType: c.type, schema: SCHEMA })
      .then((r) => ({ critic: c.type, nothingFound: !!(r && r.nothingFound), findings: (r && r.findings) || [] }))
      .catch(() => ({ critic: c.type, nothingFound: false, findings: [], errored: true })),
  ),
)

const all = results.flatMap((r) => r.findings.map((f) => ({ critic: r.critic, ...f })))
const confirmed = all.filter((f) => f.verdict === 'CONFIRMED')
const blocking = confirmed.filter((f) => f.severity === 'blocking')
const plausible = all.filter((f) => f.verdict === 'PLAUSIBLE')
const errored = results.filter((r) => r.errored).map((r) => r.critic)

if (errored.length) log(`WARNING: critics errored (not a clean round): ${errored.join(', ')}`)
log(`Round over ${TARGET}: ${confirmed.length} confirmed (${blocking.length} blocking), ${plausible.length} plausible.`)

// A round with an errored critic is never "converged" — a missing lens can't be a clean signal.
const converged = confirmed.length === 0 && errored.length === 0

return {
  target: TARGET,
  converged,
  counts: { confirmed: confirmed.length, blocking: blocking.length, plausible: plausible.length },
  byCritic: results.map((r) => ({ critic: r.critic, nothingFound: r.nothingFound, findings: r.findings.length, errored: !!r.errored })),
  confirmed,
  plausible,
}
