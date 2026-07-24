"""Emit constrained oracle fixtures for the TypeScript cross-language tests.

Byte-identity with the TS port is not required, so we record the *constraint
sets* plus the Python reference's *aggregate metrics* (ASPL, diameter, degree
spread, satisfied/connected). The TS test rebuilds the same constraints, runs
its own `constrainedGreedy`, and asserts it satisfies the constraints and lands
within a small tolerance of these metrics — parity of quality, not structure.

Run from `reference-python/`:  python3 gen_fixtures.py
Writes the `constrained` key into both copies of reference.json.
"""
import json
import os
import random

from core import Graph, all_pairs_summary
from constraints import Constraints, validate, pair
from constrained_gen import constrained_greedy

HERE = os.path.dirname(os.path.abspath(__file__))
REF_LOCAL = os.path.join(HERE, "reference.json")
REF_LIB = os.path.join(HERE, "..", "lib", "test", "fixtures", "reference.json")

MIND = 5
CELLS = [(30, 4), (60, 4), (120, 4)]


def sc_sparse_proh(n, k, rng):
    c = Constraints(n)
    for _ in range(max(2, n // 10)):
        a, b = rng.randrange(n), rng.randrange(n)
        if a != b:
            c.prohibit(a, b)
    return c


def sc_tags_proh(n, k, rng):
    tags = [None] * n
    g = 0
    i = 0
    while i < n:
        sz = rng.randint(3, 5)
        for j in range(i, min(i + sz, n)):
            tags[j] = g
        g += 1
        i += sz
    return Constraints.from_tags(n, tags, "prohibit_same")


def sc_req_matching(n, k, rng):
    c = Constraints(n)
    verts = list(range(n))
    rng.shuffle(verts)
    for i in range(0, (n // 2) // 2 * 2, 2):  # ~n/4 disjoint couples
        c.require(verts[i], verts[i + 1])
    return c


SCENARIOS = {
    "sparse_proh": sc_sparse_proh,
    "tags_proh": sc_tags_proh,
    "req_matching": sc_req_matching,
}


def sorted_pairs(pairset):
    return sorted([list(pair(a, b)) for (a, b) in pairset])


def make_fixture(name, n, k):
    rng = random.Random(100)  # fixed => reproducible constraints
    cons = SCENARIOS[name](n, k, rng)
    errs = validate(cons, k)
    assert not errs, f"{name} n={n} unexpectedly infeasible: {errs}"

    g = constrained_greedy(n, k, cons, mind=MIND)
    aspl, diameter, connected = all_pairs_summary(g)
    degs = g.degrees()
    proh_viol = sum(1 for e in cons.prohibited if g.has_edge(*e))
    req_viol = sum(1 for e in cons.required if not g.has_edge(*e))

    return {
        "scenario": name,
        "n": n,
        "k": k,
        "mind": MIND,
        "required": sorted_pairs(cons.required),
        "prohibited": sorted_pairs(cons.prohibited),
        "aspl": round(aspl, 12),
        "diameter": diameter,
        "deg_min": min(degs),
        "deg_max": max(degs),
        "connected": connected,
        "satisfied": (proh_viol == 0 and req_viol == 0 and connected),
    }


def main():
    fixtures = []
    for (n, k) in CELLS:
        for name in SCENARIOS:
            fx = make_fixture(name, n, k)
            fixtures.append(fx)
            print(
                f"  {name:12s} n={n:<3} k={k}  aspl={fx['aspl']:.4f} "
                f"diam={fx['diameter']} deg=[{fx['deg_min']},{fx['deg_max']}] "
                f"satisfied={fx['satisfied']}"
            )

    with open(REF_LOCAL, "r") as f:
        ref = json.load(f)
    ref["constrained"] = fixtures

    for path in (REF_LOCAL, REF_LIB):
        with open(path, "w") as f:
            json.dump(ref, f, indent=2)
            f.write("\n")
        print(f"wrote {len(fixtures)} constrained fixtures -> {os.path.relpath(path, HERE)}")


if __name__ == "__main__":
    main()
