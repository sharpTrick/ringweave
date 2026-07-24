# Constraint Architecture — Bake-Off Findings

**Author:** Patrick Sharp (github: sharpTrick), analysis with Claude (Anthropic), 2026.

Directive tested: required and prohibited constraints are **hard** (sacrifice regularity to
satisfy them; refuse only when a graph is genuinely impossible). Priors (churn) are **soft**
with a hard toggle. Constraint types: prohibited pairs, required pairs, group tags (compiled),
preserve-priors. Scale: n ≤ 200.

## The three approaches

- **A — seat (label-assignment):** generate an anonymous optimal graph, then assign people to
  vertices (min-conflicts) so required pairs land on adjacent vertices and prohibited pairs
  don't. Core untouched.
- **B — constrained-greedy:** lay required edges first, forbid prohibited during greedy
  completion, force-connect components. Guarantees hard constraints by construction.
- **D — free + repair:** generate freely, then degree-preserving swaps to add missing required
  / remove present prohibited edges.
- **B+polish:** B followed by constraint-preserving swap-polish (never breaks a hard
  constraint; minimizes ASPL, plus a soft-prior penalty for churn).

## Decisive result: A cannot carry hard required constraints

| scenario | A_seat satisfied | B satisfied | D satisfied |
|----------|-----------------:|------------:|------------:|
| sparse_proh | 100% | 100% | 100% |
| tags_proh (dense prohibited) | 100% | 100% | 100% |
| req_matching (couples) | **0% at n≥120** | 100% | 100% |
| req_triangles | **0%** | 100% | 100% |
| mixed | **0% at n≥120** | 100% | 100% |
| churn_priors | 100% | 100% | 100% |

Label-assignment can only satisfy a required pattern if that pattern already exists in the
anonymous host graph. A required **triangle** never embeds in a girth-≥4 host — A fails 100%.
And at n ≥ 120 even a simple required **matching** fails, because the host is too sparse
(relative to n) to contain every demanded edge in some permutation. **A is eliminated as a
backbone.** (It remains fine for prohibited-only or tag-only rosters, but we won't special-case
that — B handles those equally well.)

## B vs D: both satisfy, B is better quality

Across every scenario D's repair swaps leave ASPL consistently worse than B
(e.g. tags_proh n=200: D 4.19 vs B 4.00; req_triangles n=120: D 3.85 vs B 3.65). D also keeps
priors no better than B pre-polish. B guarantees the hard constraints *by construction* rather
than by search, so it never risks residual violations. **D is eliminated.**

## B+polish is the quality layer, and the soft-prior penalty works

B+polish gives the lowest ASPL in essentially every scenario while never breaking a constraint
and staying near-regular (degree spread ≤ 1). The churn result is the proof the soft mechanism
works: raw B preserves ~27% of prior buddies; **B+polish with a prior penalty lifts that to
~64–98%** (98% at n=30, 86% at n=60, 64% at n=120 — tapering with scale as the optimizer has
more to juggle) — all while still satisfying hard constraints at negligible ASPL cost. The
dedicated M1b sweep (`churn-priors-weight.md`) supersedes the earlier bake-off estimate and
shows the penalty is effectively on/off: any weight ≥ ~0.5 saturates preservation.
Priors-as-penalty-weight is the right design for the soft/hard toggle.

Cost: polish is the only expensive step (full-ASPL per swap). ~3 s at n=60, ~16 s at n=120 for
4 k iters. For the product, cap polish by iteration budget and scale iters down with n, exactly
as in the unconstrained core.

## Recommended core architecture

```
buildConstrainedBuddyGraph(people, k, constraints):
  1. compile tags -> prohibited/required
  2. validate(constraints, k)               # refuse with specific reason if impossible
  3. graph = constrainedGreedy(...)          # B: hard required + prohibited guaranteed
  4. if polish enabled:
        graph = polishConstrained(graph, ... , priorWeight = soft ? w : 0)
     # priors hard? -> treat as required in step 3 instead
  5. return graph + report (satisfied, degree spread, ASPL, priors kept)
```

- **Required / prohibited:** enforced in `constrainedGreedy` (B). Required edges seeded first
  and never removed; prohibited never added; polish validity-checks both.
- **Tags:** compile to prohibited (`prohibit_same` for households/teams) before generation —
  no new core path.
- **Priors (churn):** soft by default via the polish penalty (kept ~half+ of prior buddies);
  hard toggle promotes them to required edges in step 3.
- **Feasibility:** `validate` refuses up front with a human reason — required-degree > k, a
  pair both required and prohibited, or a person prohibited from everyone. Everything else is
  handled by sacrificing regularity (degree spread stays ≤ 1 in tests).

## Infeasibility messages (from `validate`)

- "person X has N required buddies but each person gets k"
- "pair X–Y is both required and prohibited"
- "person X is prohibited from everyone — they'd have no buddies"

## What to port to TS

`constrainedGreedy` and `polishConstrained` mirror the existing greedy/polish with two added
predicates (prohibited-check, required-preserve) and a required-seed step — a small, contained
extension of the validated core, not a rewrite. Cross-language identity tests should add a few
constrained fixtures (deterministic given the same RNG-free greedy path; polish stays
JS-seed-deterministic only).

## Honest caveats

- ASPL gap here is measured against the *unconstrained* Moore bound, so constrained graphs look
  slightly worse than they are — constraints raise the true optimum. Fine for ranking approaches
  (all measured the same way); not an absolute optimality claim.
- Reruns show constrained-greedy occasionally leaves degree spread 1 (one person a buddy short)
  on tight prohibited/tag mixes — expected and acceptable per the directive; the report surfaces
  it so the UI can say "everyone got 4 buddies except Sam, who got 3."
- Priors-kept under churn degrades with n; if preservation matters more than ASPL at scale,
  raise the prior weight or make priors hard — a product dial worth exposing.
