"""Generation strategies A-E for the bake-off.

A: random k-regular (configuration model with rejection)
B: genreg_via_cycles (girth-first, cycle stacking + backtracking) -- port of user's repo
C: ring-greedy (port of the Julia algorithm)
D: circulant (ring + fixed chord offsets, searched)
E: swap-polish (double edge swap; hill-climb and simulated annealing)
"""
import math
import random
import time
from collections import deque
from core import penalized_aspl, Graph, ring, bfs_distances, all_pairs_summary, is_connected


# ----------------------------------------------------------------------------
# A: Random k-regular
# ----------------------------------------------------------------------------
def random_regular(n, k, rng, max_tries=200):
    """Configuration/pairing model with rejection of multigraph & disconnected."""
    if (n * k) % 2 != 0:
        return None
    for _ in range(max_tries):
        stubs = []
        for v in range(n):
            stubs.extend([v] * k)
        rng.shuffle(stubs)
        g = Graph(n)
        ok = True
        # pair up stubs greedily
        it = iter(stubs)
        pairs = list(zip(it, it))
        for u, v in pairs:
            if u == v or g.has_edge(u, v):
                ok = False
                break
            g.add_edge(u, v)
        if not ok:
            continue
        if all(g.degree(v) == k for v in range(n)) and is_connected(g):
            return g
    return None


# ----------------------------------------------------------------------------
# C: Ring-greedy (port of the Julia find_next_paring / add_edges!)
# ----------------------------------------------------------------------------
def _farthest_set(g, s):
    """(max_dist, [vertices at max_dist]) from s via BFS."""
    dist = bfs_distances(g, s)
    md = max(dist)
    return md, [v for v in range(g.n) if dist[v] == md]


def ring_greedy(n, k, mind=5, demote=True, repair=False):
    """Hamiltonian ring, then add chords by lexicographic rule:
      1. lowest max-endpoint-degree
      2. lowest min-endpoint-degree
      3. largest BFS distance
      4. largest ring-proximity (mirrors Julia's vab_perim_d tiebreak)
    subject to endpoint distance >= mind and both degrees < k.
    If demote and no pair qualifies, lower mind and retry (records final mind).
    """
    g = ring(n)
    cur_mind = min(mind, n // 2)

    def find_pair():
        best = None  # (ne_max, ne_min, -d, perim, va, vb)
        for va in range(n):
            va_ne = g.degree(va)
            if va_ne >= k:
                continue
            d_far, far = _farthest_set(g, va)
            if d_far < cur_mind:
                continue
            for vb in far:
                if vb <= va:
                    continue
                vb_ne = g.degree(vb)
                if vb_ne >= k:
                    continue
                if g.has_edge(va, vb):
                    continue
                ne_min, ne_max = sorted((va_ne, vb_ne))
                perim = min(abs(va - vb), abs(va - vb - n), abs(vb - va - n))
                key = (ne_max, ne_min, -d_far, -perim, va, vb)
                if best is None or key < best[:6]:
                    best = (ne_max, ne_min, -d_far, -perim, va, vb, va, vb)
        if best is None:
            return None
        return best[6], best[7]

    while True:
        pair = find_pair()
        if pair is None:
            if demote and cur_mind > 3:
                cur_mind -= 1
                continue
            break
        g.add_edge(*pair)

    if repair:
        _repair_degrees(g, k, min_dist=3)

    return g, cur_mind


def _repair_degrees(g, k, min_dist=3):
    """Greedily connect lowest-degree vertices that are at least min_dist apart."""
    changed = True
    while changed:
        changed = False
        under = sorted((v for v in range(g.n) if g.degree(v) < k),
                       key=lambda v: g.degree(v))
        if len(under) < 2:
            break
        for va in under:
            if g.degree(va) >= k:
                continue
            dist = bfs_distances(g, va)
            # candidate: another under-degree vertex far enough away
            cands = [v for v in under
                     if v != va and g.degree(v) < k
                     and not g.has_edge(va, v) and dist[v] >= min_dist]
            if cands:
                vb = max(cands, key=lambda v: dist[v])
                g.add_edge(va, vb)
                changed = True
                break


# ----------------------------------------------------------------------------
# D: Circulant (ring + chord offsets)
# ----------------------------------------------------------------------------
def circulant(n, offsets):
    """Circulant graph C_n(offsets). Each vertex i connects to i +/- s for s in offsets."""
    g = Graph(n)
    for i in range(n):
        for s in offsets:
            g.add_edge(i, (i + s) % n)
    return g


def best_circulant(n, k, rng=None, sample_cap=400):
    """Search chord offsets to minimize ASPL for a k-regular circulant.

    k=4: offsets {1, s}, s in 2..n//2
    k=3: ring + antipodal matching (needs even n): offsets {1, n//2}
    k=6: offsets {1, s, t}
    Even-degree k uses k//2 offsets (including 1). Odd k adds the n//2 matching.
    """
    best_g = None
    best_aspl = math.inf
    best_off = None

    half = n // 2

    def eval_offsets(offs):
        nonlocal best_g, best_aspl, best_off
        g = circulant(n, offs)
        if not all(g.degree(v) == k for v in range(n)):
            return
        if not is_connected(g):
            return
        aspl, _, _ = all_pairs_summary(g)
        if aspl < best_aspl:
            best_aspl, best_g, best_off = aspl, g, tuple(offs)

    if k % 2 == 0:
        num_chords = k // 2  # includes offset 1
        if num_chords == 1:
            eval_offsets([1])
        elif num_chords == 2:
            for s in range(2, half + 1):
                eval_offsets([1, s])
        elif num_chords == 3:
            combos = [(s, t) for s in range(2, half + 1) for t in range(s + 1, half + 1)]
            if len(combos) > sample_cap and rng is not None:
                combos = rng.sample(combos, sample_cap)
            for s, t in combos:
                eval_offsets([1, s, t])
        else:
            # general: 1 plus (num_chords-1) sampled distinct offsets
            pool = list(range(2, half + 1))
            for _ in range(sample_cap):
                if len(pool) < num_chords - 1:
                    break
                chosen = (rng or random).sample(pool, num_chords - 1)
                eval_offsets([1] + chosen)
    else:
        # odd k: needs even n for the n//2 matching
        if n % 2 != 0:
            return None, None, None
        num_chords = (k - 1) // 2
        if num_chords == 1:
            eval_offsets([1, half])
        elif num_chords == 2:
            for s in range(2, half):
                eval_offsets([1, s, half])
        else:
            pool = list(range(2, half))
            for _ in range(sample_cap):
                if len(pool) < num_chords - 1:
                    break
                chosen = (rng or random).sample(pool, num_chords - 1)
                eval_offsets([1] + chosen + [half])

    return best_g, best_aspl, best_off


# ----------------------------------------------------------------------------
# E: Swap-polish (double edge swap preserving degrees)
# ----------------------------------------------------------------------------
def _try_swap(g, e1, e2, rng):
    """Attempt a degree-preserving double edge swap. Returns the new edge pair
    (as ((a,c),(b,d)) style) to apply, or None if invalid."""
    a, b = e1
    c, d = e2
    # two rewiring options; pick one at random
    if rng.random() < 0.5:
        x1, y1, x2, y2 = a, c, b, d
    else:
        x1, y1, x2, y2 = a, d, b, c
    if len({a, b, c, d}) < 4:
        return None
    if g.has_edge(x1, y1) or g.has_edge(x2, y2):
        return None
    if x1 == y1 or x2 == y2:
        return None
    return (a, b), (c, d), (x1, y1), (x2, y2)


def polish(g, rng, budget_s, mode="anneal", sampled_aspl_srcs=None):
    """Improve ASPL by double edge swaps within a wall-clock budget.

    mode: "hill" (accept only improvements) or "anneal" (Metropolis).
    Returns (best_graph, best_aspl, iters).
    """
    g = g.copy()
    edges = g.edge_list()

    def energy(gr):
        if sampled_aspl_srcs:
            return _sampled_aspl(gr, sampled_aspl_srcs)
        return penalized_aspl(gr)

    cur_e = energy(g)
    best_g = g.copy()
    best_e = cur_e

    # temperature calibration for anneal
    T = None
    if mode == "anneal":
        deltas = []
        for _ in range(min(100, max(10, len(edges)))):
            if len(edges) < 2:
                break
            e1, e2 = rng.sample(edges, 2)
            sw = _try_swap(g, e1, e2, rng)
            if sw is None:
                continue
            (a, b), (c, d), (x1, y1), (x2, y2) = sw
            g.remove_edge(a, b); g.remove_edge(c, d)
            g.add_edge(x1, y1); g.add_edge(x2, y2)
            deltas.append(abs(energy(g) - cur_e))
            g.remove_edge(x1, y1); g.remove_edge(x2, y2)
            g.add_edge(a, b); g.add_edge(c, d)
        T0 = (sum(deltas) / len(deltas)) if deltas else 0.1
        T0 = max(T0, 1e-3)
        T = T0
        T_floor = 1e-4 * T0
        alpha = 0.995

    t_start = time.perf_counter()
    iters = 0
    rejects = 0
    reject_cap = 200 * g.n
    while time.perf_counter() - t_start < budget_s:
        iters += 1
        edges = g.edge_list()
        if len(edges) < 2:
            break
        e1, e2 = rng.sample(edges, 2)
        sw = _try_swap(g, e1, e2, rng)
        if sw is None:
            continue
        (a, b), (c, d), (x1, y1), (x2, y2) = sw
        g.remove_edge(a, b); g.remove_edge(c, d)
        g.add_edge(x1, y1); g.add_edge(x2, y2)
        new_e = energy(g)
        delta = new_e - cur_e

        if mode == "hill":
            accept = delta < -1e-12
        else:
            if delta < 0:
                accept = True
            else:
                accept = rng.random() < math.exp(-delta / T) if T > 0 else False

        if accept:
            cur_e = new_e
            if new_e < best_e - 1e-12:
                best_e = new_e
                best_g = g.copy()
                rejects = 0
            else:
                rejects += 1
        else:
            # revert
            g.remove_edge(x1, y1); g.remove_edge(x2, y2)
            g.add_edge(a, b); g.add_edge(c, d)
            rejects += 1

        if mode == "anneal" and T > T_floor:
            T *= alpha
        if mode == "hill" and rejects >= reject_cap:
            break

    # final exact aspl of best (in case sampled was used)
    aspl, diam, conn = all_pairs_summary(best_g)
    return best_g, aspl, iters


def _sampled_aspl(g, srcs):
    total, count = 0, 0
    for s in srcs:
        dist = bfs_distances(g, s)
        for t in range(g.n):
            d = dist[t]
            if d > 0:
                total += d
                count += 1
    return total / count if count else math.inf
