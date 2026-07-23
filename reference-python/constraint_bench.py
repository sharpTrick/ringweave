"""Constraint bake-off: pit the three approaches (+ polish) against each other
across constraint profiles at n <= 200.

Scenarios:
  sparse_proh     : a few random prohibited pairs
  tags_proh       : households of 3-5, never same-household (dense prohibited)
  req_matching    : required couples (a matching) — easy to embed
  req_triangles   : required triangles — CANNOT embed in girth>=4 host (stress)
  mixed           : required matching + moderate prohibited
  churn_priors    : generate, add a person, prefer keeping prior buddies (soft)

Metrics per run: satisfied (hard), req_viol, proh_viol, aspl, gap, deg spread,
connected, priors_kept, time.
"""
import math, random, time, csv
from core import Graph, all_pairs_summary, moore_lower_bounds
from constraints import Constraints, validate, pair
from constrained_gen import (constrained_greedy, seat, free_repair,
                             polish_constrained, _anon_greedy)


def metrics(g, cons, n, k, t):
    pv = sum(1 for e in cons.prohibited if g.has_edge(*e))
    rv = sum(1 for e in cons.required if not g.has_edge(*e))
    a, d, conn = all_pairs_summary(g)
    lb, _ = moore_lower_bounds(n, k)
    gap = (a - lb) / lb if lb > 0 else 0
    degs = g.degrees()
    kept = None
    if cons.priors:
        kept = sum(1 for p in cons.priors if g.has_edge(*p)) / len(cons.priors)
    return dict(satisfied=(pv == 0 and rv == 0 and conn),
                proh_viol=pv, req_viol=rv, aspl=round(a, 4), gap=round(gap, 4),
                deg_min=min(degs), deg_max=max(degs), connected=conn,
                priors_kept=(round(kept, 3) if kept is not None else ""),
                time=round(t, 4))


# ---- scenario builders (return Constraints) ----
def sc_sparse_proh(n, k, rng):
    c = Constraints(n)
    for _ in range(max(2, n // 10)):
        a, b = rng.randrange(n), rng.randrange(n)
        if a != b: c.prohibit(a, b)
    return c

def sc_tags_proh(n, k, rng):
    # random households of size 3-5
    tags = [None] * n; g = 0; i = 0
    while i < n:
        sz = rng.randint(3, 5)
        for j in range(i, min(i + sz, n)): tags[j] = g
        g += 1; i += sz
    return Constraints.from_tags(n, tags, "prohibit_same")

def sc_req_matching(n, k, rng):
    c = Constraints(n)
    verts = list(range(n)); rng.shuffle(verts)
    for i in range(0, (n // 2) // 2 * 2, 2):  # ~n/4 couples
        c.require(verts[i], verts[i + 1])
    return c

def sc_req_triangles(n, k, rng):
    c = Constraints(n)
    verts = list(range(n)); rng.shuffle(verts)
    for i in range(0, min(n, (n // 6) * 3), 3):  # a handful of triangles
        a, b, cc = verts[i], verts[i + 1], verts[i + 2]
        c.require(a, b); c.require(b, cc); c.require(a, cc)
    return c

def sc_mixed(n, k, rng):
    c = sc_req_matching(n, k, rng)
    for _ in range(max(2, n // 12)):
        a, b = rng.randrange(n), rng.randrange(n)
        if a != b and pair(a, b) not in c.required: c.prohibit(a, b)
    return c

def sc_churn(n, k, rng):
    # generate base on n-1, capture its edges as priors, then add 1 person
    base = _anon_greedy(n - 1, k, mind=5)
    c = Constraints(n)
    for u in range(n - 1):
        for v in base.adj[u]:
            if u < v: c.add_prior(u, v)
    return c

SCENARIOS = {
    "sparse_proh": sc_sparse_proh,
    "tags_proh": sc_tags_proh,
    "req_matching": sc_req_matching,
    "req_triangles": sc_req_triangles,
    "mixed": sc_mixed,
    "churn_priors": sc_churn,
}


def run(cells=((30,4),(60,4),(120,4),(200,4)), seeds=3, out="constraint_results.csv"):
    rows = []
    for (n, k) in cells:
        for sname, builder in SCENARIOS.items():
            for s in range(seeds):
                rng = random.Random(100 + s)
                cons = builder(n, k, rng)
                errs = validate(cons, k)
                if errs:
                    rows.append(dict(scenario=sname, n=n, k=k, approach="(infeasible)",
                                     seed=s, satisfied=False, note=errs[0][:60]))
                    continue

                # A seat
                t0 = time.perf_counter(); gA, _ = seat(n, k, cons, rng=random.Random(200+s))
                rows.append(dict(scenario=sname, n=n, k=k, approach="A_seat", seed=s,
                                 **metrics(gA, cons, n, k, time.perf_counter()-t0)))
                # B constrained
                t0 = time.perf_counter(); gB = constrained_greedy(n, k, cons, rng=random.Random(200+s))
                rows.append(dict(scenario=sname, n=n, k=k, approach="B_constrained", seed=s,
                                 **metrics(gB, cons, n, k, time.perf_counter()-t0)))
                # D free_repair
                t0 = time.perf_counter(); gD = free_repair(n, k, cons, rng=random.Random(200+s))
                rows.append(dict(scenario=sname, n=n, k=k, approach="D_free_repair", seed=s,
                                 **metrics(gD, cons, n, k, time.perf_counter()-t0)))
                # B + polish (soft prior weight for churn)
                pw = 2.0 if sname == "churn_priors" else 0.0
                t0 = time.perf_counter()
                gBp = polish_constrained(gB, cons, rng=random.Random(200+s), iters=4000, prior_weight=pw)
                m = metrics(gBp, cons, n, k, time.perf_counter()-t0)
                rows.append(dict(scenario=sname, n=n, k=k, approach="B+polish", seed=s, **m))

    # write
    fields = ["scenario","n","k","approach","seed","satisfied","req_viol","proh_viol",
              "aspl","gap","deg_min","deg_max","connected","priors_kept","time","note"]
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows: w.writerow(r)
    print(f"wrote {len(rows)} rows -> {out}")
    return rows


if __name__ == "__main__":
    import sys
    quick = "--quick" in sys.argv
    if quick:
        run(cells=((30,4),(60,4)), seeds=2, out="constraint_results_quick.csv")
    else:
        run()
