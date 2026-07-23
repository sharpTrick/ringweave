"""Strategy B: girth-first k-regular generation (reconstruction of
genreg_via_cycles).

The original builds a k-regular graph as edge-disjoint cycles, incrementing
degree by 2 per pass (plus a final matching pass for odd k), validating each
candidate edge by BFS to depth < g from the source: if the target is already
reachable in < g steps, the edge would create a cycle shorter than the girth
floor, so it's rejected. Backtracking unwinds recent edges when a vertex has
no valid partner.

This reconstruction keeps that spirit but uses a robust randomized-restart
backtracking search so we can fairly benchmark it. It tries to achieve exact
k-regularity with girth >= g. Returns None on failure within the time budget.
"""
import math
import random
import time
from collections import deque
from core import Graph


def _within_girth_floor(g, u, v, g_floor):
    """True if adding edge (u,v) keeps girth >= g_floor, i.e. current distance
    (u->v) >= g_floor - 1 (or infinite)."""
    if g_floor <= 2:
        return True
    # BFS from u up to depth g_floor-2; if v reached, edge closes a short cycle
    limit = g_floor - 2
    dist = {u: 0}
    q = deque([u])
    while q:
        x = q.popleft()
        if dist[x] >= limit:
            continue
        for w in g.adj[x]:
            if w not in dist:
                dist[w] = dist[x] + 1
                if w == v:
                    return False
                q.append(w)
    return v not in dist


def girth_first(n, k, g_floor, rng, time_budget=5.0):
    """Backtracking search for a k-regular graph with girth >= g_floor."""
    if (n * k) % 2 != 0:
        return None
    deadline = time.perf_counter() + time_budget

    best = None  # keep best partial in case we never hit full regularity

    def attempt():
        g = Graph(n)
        # order of vertices to fill
        order = list(range(n))
        # edge stack for backtracking
        stack = []
        # greedy fill with limited backtracking
        steps = 0
        max_steps = 50 * n * k
        while steps < max_steps:
            steps += 1
            if time.perf_counter() > deadline:
                return g
            # pick the vertex with the smallest remaining need (>0), most
            # constrained first
            deficient = [v for v in order if g.degree(v) < k]
            if not deficient:
                return g  # success: fully regular
            deficient.sort(key=lambda v: g.degree(v))
            u = deficient[0]
            # candidate partners: deficient, not self, not already adjacent,
            # keeping girth
            cands = [v for v in deficient
                     if v != u and not g.has_edge(u, v)
                     and _within_girth_floor(g, u, v, g_floor)]
            if not cands:
                # backtrack: remove last edge and forbid it this round
                if not stack:
                    return g  # stuck at root; return partial
                a, b = stack.pop()
                g.remove_edge(a, b)
                # random restart-ish: shuffle order to avoid same dead end
                rng.shuffle(order)
                continue
            # prefer partners that are themselves most constrained & far
            rng.shuffle(cands)
            cands.sort(key=lambda v: g.degree(v))
            v = cands[0]
            g.add_edge(u, v)
            stack.append((u, v))
        return g

    for _ in range(40):
        if time.perf_counter() > deadline:
            break
        g = attempt()
        regular = all(g.degree(v) == k for v in range(n))
        if best is None or g.num_edges() > best.num_edges():
            best = g
        if regular:
            return g
    return best  # may be sub-regular partial


def girth_first_descending(n, k, rng, time_budget=5.0, max_girth=None):
    """Try girth floors from high to low until a full k-regular graph is found.
    Mirrors 'choose g descending from Moore-bound max until feasible'."""
    if max_girth is None:
        # crude upper cap on girth to try
        max_girth = max(3, int(2 * math.log(n) / math.log(max(2, k - 1))) + 2)
    per_attempt = time_budget / max(1, (max_girth - 2))
    per_attempt = max(per_attempt, 0.3)
    best = None
    best_girth = 0
    for gf in range(max_girth, 2, -1):
        g = girth_first(n, k, gf, rng, time_budget=per_attempt)
        if g is None:
            continue
        if all(g.degree(v) == k for v in range(n)):
            return g, gf
        # keep best partial
        if g.num_edges() > (best.num_edges() if best else -1):
            best, best_girth = g, gf
    return best, best_girth
