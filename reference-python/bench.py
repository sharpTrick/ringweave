"""Benchmark harness for the buddy-graph bake-off.

Runs strategies A-E across the parameter grid, emits results.csv.
Usage: python3 bench.py [--quick]
"""
import argparse
import csv
import math
import random
import time

from core import all_pairs_summary, girth, moore_lower_bounds, largest_component_fraction
from generators import (
    random_regular, ring_greedy, best_circulant, polish, Graph,
)
from gen_b import girth_first_descending


def metrics_row(g):
    aspl, diam, conn = all_pairs_summary(g)
    return {
        "aspl": aspl,
        "diameter": diam,
        "connected": int(conn),
        "girth": girth(g) if g.num_edges() else 0,
        "deg_min": min(g.degrees()),
        "deg_max": max(g.degrees()),
    }


def aspl_gap(aspl, n, k):
    lb, _ = moore_lower_bounds(n, k)
    if lb <= 0:
        return 0.0
    return (aspl - lb) / lb


def run_grid(cells, budgets, n_seeds, out_path):
    rows = []
    rid = 0

    for (n, k) in cells:
        if (n * k) % 2 != 0:
            print(f"skip n={n} k={k} (parity)")
            continue
        lb_aspl, lb_diam = moore_lower_bounds(n, k)
        print(f"\n### n={n} k={k}  (lb aspl={lb_aspl:.4f} diam={lb_diam})")

        # ---- A: random regular (stochastic, n_seeds runs) ----
        for s in range(n_seeds):
            rng = random.Random(1000 + s)
            t0 = time.perf_counter()
            g = random_regular(n, k, rng)
            dt = time.perf_counter() - t0
            if g is None:
                continue
            m = metrics_row(g)
            rows.append(dict(rid=rid, method="A_random", seed_method="-", n=n, k=k,
                             rng=1000 + s, time=dt, gap=aspl_gap(m["aspl"], n, k), **m))
            rid += 1

        # ---- B: girth-first descending (stochastic) ----
        for s in range(min(n_seeds, 5)):  # B is slow; fewer seeds
            rng = random.Random(2000 + s)
            t0 = time.perf_counter()
            gb, gf = girth_first_descending(n, k, rng, time_budget=budgets["B"])
            dt = time.perf_counter() - t0
            if gb is None:
                continue
            m = metrics_row(gb)
            rows.append(dict(rid=rid, method="B_girthfirst", seed_method="-", n=n, k=k,
                             rng=2000 + s, time=dt, gap=aspl_gap(m["aspl"], n, k), **m))
            rid += 1

        # ---- C: ring-greedy (deterministic core; repair variant) ----
        t0 = time.perf_counter()
        gc, mind_c = ring_greedy(n, k, mind=5, repair=True)
        dt = time.perf_counter() - t0
        m = metrics_row(gc)
        rows.append(dict(rid=rid, method="C_greedy", seed_method="-", n=n, k=k,
                         rng=-1, time=dt, gap=aspl_gap(m["aspl"], n, k), **m))
        rid += 1
        c_graph = gc.copy()

        # ---- D: best circulant (deterministic search) ----
        rng = random.Random(3000)
        t0 = time.perf_counter()
        gd, aspl_d, off = best_circulant(n, k, rng)
        dt = time.perf_counter() - t0
        d_graph = None
        if gd is not None:
            m = metrics_row(gd)
            rows.append(dict(rid=rid, method="D_circulant", seed_method="-", n=n, k=k,
                             rng=-1, time=dt, gap=aspl_gap(m["aspl"], n, k), **m))
            rid += 1
            d_graph = gd.copy()

        # ---- E: polish (anneal) on top of A-best, C, D ----
        # seed from best random for a fair "polish from cheap seed" baseline
        for seed_name, seed_graph, seed_rng in [
            ("C", c_graph, 4000),
            ("D", d_graph, 4100),
            ("A", None, 4200),  # generate a fresh random seed
        ]:
            for budget_name, budget in budgets["E"].items():
                rng = random.Random(seed_rng)
                if seed_graph is None:
                    sg = random_regular(n, k, rng)
                    if sg is None:
                        continue
                else:
                    sg = seed_graph.copy()
                t0 = time.perf_counter()
                # use sampled ASPL energy for large n to keep proposals cheap
                srcs = None
                if n >= 500:
                    srcs = rng.sample(range(n), max(20, int(math.isqrt(n))))
                ge, aspl_e, iters = polish(sg, rng, budget_s=budget,
                                           mode="anneal", sampled_aspl_srcs=srcs)
                dt = time.perf_counter() - t0
                m = metrics_row(ge)
                rows.append(dict(rid=rid, method="E_polish", seed_method=seed_name,
                                 n=n, k=k, rng=seed_rng, time=dt,
                                 gap=aspl_gap(m["aspl"], n, k),
                                 budget=budget_name, iters=iters, **m))
                rid += 1
        print(f"  rows so far: {len(rows)}")

    # write csv
    fields = ["rid", "method", "seed_method", "n", "k", "rng", "budget",
              "iters", "time", "aspl", "gap", "diameter", "girth",
              "deg_min", "deg_max", "connected"]
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print(f"\nwrote {len(rows)} rows -> {out_path}")
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="small grid, short budgets")
    args = ap.parse_args()

    if args.quick:
        cells = [(20, 3), (20, 4), (50, 4)]
        budgets = {"B": 2.0, "E": {"quick": 1.0}}
        n_seeds = 5
        out = "results_quick.csv"
    else:
        cells = [
            (10, 3), (16, 4),            # sanity
            (20, 3), (20, 4),
            (50, 3), (50, 4),
            (100, 3), (100, 4),
            (200, 4),
            (500, 4), (1000, 4),         # scaling probe
        ]
        budgets = {"B": 5.0, "E": {"quick": 1.0, "thorough": 20.0}}
        n_seeds = 10
        out = "results.csv"

    t0 = time.perf_counter()
    run_grid(cells, budgets, n_seeds, out)
    print(f"total wall: {time.perf_counter()-t0:.1f}s")
