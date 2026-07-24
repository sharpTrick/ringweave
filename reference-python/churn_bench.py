"""M1b — churn-priors weight sweep.

Question this answers: when the roster changes (someone joins), how strongly should
the soft-prior penalty pull the recalculated graph toward keeping existing buddy
pairs — and what does that cost in connection quality (ASPL gap)? The answer sets
the product default `DEFAULT_PRIOR_WEIGHT` (lib/src/core/index.ts) and the honest
F9 ("recalculate with minimal disruption") claim in docs/PROJECT_PLAN.md.

Model (F9, "one person joins"): build the full-roster host graph, then treat one
RANDOM person as the newcomer — their existing links are formed fresh, and every
OTHER existing pair becomes a soft prior. We sweep the prior weight and measure the
fraction of those priors preserved after constrained-greedy + constraint-preserving
polish, alongside the ASPL gap it costs.

Why a randomized newcomer instead of constraint_bench.sc_churn (which fixes the
newcomer at vertex n-1 over a deterministic host): sc_churn yields ONE instance per
n, so seeds would only vary the polish RNG. Randomizing the newcomer gives genuine
instance diversity per seed, which is what an honest preservation claim needs. The
host is still the deterministic `_anon_greedy`; the diversity is in who joins.

Deterministic: every RNG is seeded (no bare `random`), so the CSV reproduces.

Run:  python3 churn_bench.py            # full sweep -> ../docs/churn_results.csv
      python3 churn_bench.py --quick    # smaller/faster sanity sweep
"""
import csv
import os
import random
import statistics
import sys

from core import all_pairs_summary, moore_lower_bounds
from constraints import Constraints
from constrained_gen import _anon_greedy, constrained_greedy, polish_constrained

# Prior weight is a soft polish penalty per dropped prior (see polish_constrained).
# 0 = no churn preference (baseline: whatever polish keeps incidentally).
WEIGHTS = [0.0, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0]
CELLS = [30, 60, 120]
K = 4
SEEDS = 5
POLISH_ITERS = 8000  # matches the production default (index.ts polishIters)


def churn_priors(n, k, rng):
    """One-newcomer churn instance. Priors = every existing pair not touching the
    randomly-chosen newcomer; the newcomer's own links are formed fresh."""
    host = _anon_greedy(n, k, mind=5)
    newbie = rng.randrange(n)
    cons = Constraints(n)
    for u in range(n):
        for v in host.adj[u]:
            if u < v and u != newbie and v != newbie:
                cons.add_prior(u, v)
    return cons


def one_run(n, k, cons, weight, seed):
    """Generate + polish at a given prior weight; return per-run metrics."""
    # constrained_greedy is RNG-free (deterministic); the rng only satisfies its
    # signature. Polish carries the only randomness, seeded per run.
    g = constrained_greedy(n, k, cons, rng=random.Random(200 + seed))
    gp = polish_constrained(
        g, cons, rng=random.Random(300 + seed), iters=POLISH_ITERS, prior_weight=weight
    )
    aspl, _diam, connected = all_pairs_summary(gp)
    lb, _ = moore_lower_bounds(n, k)
    gap = (aspl - lb) / lb if lb > 0 else 0.0
    priors = cons.priors
    kept = (sum(1 for p in priors if gp.has_edge(*p)) / len(priors)) if priors else 0.0
    degs = gp.degrees()
    return dict(
        kept=kept, aspl=aspl, gap=gap, connected=connected,
        deg_min=min(degs), deg_max=max(degs),
    )


def sweep(cells, weights, seeds):
    """Return aggregate rows (one per n x weight) plus a raw row list."""
    agg, raw = [], []
    for n in cells:
        # One churn instance per seed (varies the newcomer); the SAME instance is
        # reused across every weight so the weight is the only thing that changes.
        instances = [churn_priors(n, K, random.Random(100 + s)) for s in range(seeds)]
        for w in weights:
            runs = [one_run(n, K, instances[s], w, s) for s in range(seeds)]
            for s, r in enumerate(runs):
                raw.append(dict(n=n, k=K, weight=w, seed=s, **r))
            kept = [r["kept"] for r in runs]
            gaps = [r["gap"] for r in runs]
            aspls = [r["aspl"] for r in runs]
            conn_rate = sum(1 for r in runs if r["connected"]) / len(runs)
            agg.append(dict(
                n=n, k=K, weight=w, seeds=len(runs),
                kept_mean=round(statistics.mean(kept), 4),
                kept_min=round(min(kept), 4),
                kept_max=round(max(kept), 4),
                gap_mean=round(statistics.mean(gaps), 4),
                aspl_mean=round(statistics.mean(aspls), 4),
                connected_rate=round(conn_rate, 3),
            ))
    return agg, raw


def print_table(agg):
    print(f"\nchurn priors preserved vs weight (k={K}, {SEEDS} seeds, {POLISH_ITERS} polish iters)\n")
    header = f"{'n':>4} {'weight':>7} {'kept_mean':>10} {'kept_min':>9} {'gap_mean':>9} {'conn':>5}"
    for n in sorted({r['n'] for r in agg}):
        print(header)
        for r in [r for r in agg if r['n'] == n]:
            print(f"{r['n']:>4} {r['weight']:>7} {r['kept_mean']:>10} "
                  f"{r['kept_min']:>9} {r['gap_mean']:>9} {r['connected_rate']:>5}")
        print()


def write_csv(agg, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fields = ["n", "k", "weight", "seeds", "kept_mean", "kept_min", "kept_max",
              "gap_mean", "aspl_mean", "connected_rate"]
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in agg:
            w.writerow(r)
    print(f"wrote {len(agg)} rows -> {out}")


def mechanism():
    """Why preservation is a step function in weight (fast, single instance/cell).

    Shows the three regimes behind the sweep: (1) constrained-greedy keeps priors
    only incidentally; (2) weight-0 polish erodes them further chasing ASPL; (3) any
    positive weight actively RESTORES priors (each kept prior lowers energy), which
    is why every weight >= 0.5 lands on the same plateau."""
    print("\nmechanism: prior fraction by stage (single instance per n)\n")
    print(f"{'n':>4} {'greedy':>8} {'polish w=0':>11} {'polish w=0.5':>13}")
    for n in CELLS:
        cons = churn_priors(n, K, random.Random(101))
        g = constrained_greedy(n, K, cons, rng=random.Random(200))
        pre = sum(1 for p in cons.priors if g.has_edge(*p)) / len(cons.priors)
        g0 = polish_constrained(g, cons, rng=random.Random(300), iters=POLISH_ITERS, prior_weight=0.0)
        g5 = polish_constrained(g, cons, rng=random.Random(300), iters=POLISH_ITERS, prior_weight=0.5)
        k0 = sum(1 for p in cons.priors if g0.has_edge(*p)) / len(cons.priors)
        k5 = sum(1 for p in cons.priors if g5.has_edge(*p)) / len(cons.priors)
        print(f"{n:>4} {pre:>8.3f} {k0:>11.3f} {k5:>13.3f}")


if __name__ == "__main__":
    if "--mechanism" in sys.argv:
        mechanism()
        sys.exit(0)
    quick = "--quick" in sys.argv
    cells = [30, 60] if quick else CELLS
    seeds = 4 if quick else SEEDS
    out = os.path.join(os.path.dirname(__file__), "..", "docs",
                       "churn_results_quick.csv" if quick else "churn_results.csv")
    agg, _raw = sweep(cells, WEIGHTS, seeds)
    print_table(agg)
    write_csv(agg, os.path.abspath(out))
