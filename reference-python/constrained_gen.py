"""Constrained buddy-graph generators — three approaches to test against each other.

A  seat            : generate anonymous graph, then assign people to vertices
                     (min-conflicts) so constraints land right. Core untouched.
B  constrained     : lay required edges first, forbid prohibited in greedy,
                     complete + force-connect. Guarantees hard constraints.
D  free_repair     : generate freely, then degree-preserving swaps to add
                     missing required / remove present prohibited.

Plus:
  polish_constrained : swap-polish that never breaks a hard constraint,
                       minimizing ASPL (+ optional soft-prior penalty).
"""
import math
import random
from core import Graph, ring, bfs_distances, all_pairs_summary, is_connected
from constraints import pair


# ---------------------------------------------------------------------------
# shared: BFS distance + farthest helpers
# ---------------------------------------------------------------------------
def _ecc_and_far(g, s, prohibited, k):
    dist = bfs_distances(g, s)
    n = g.n
    # farthest reachable; unreachable (-1) treated as +inf to prefer joining
    best = -1
    far = []
    for t in range(n):
        d = dist[t]
        val = d if d >= 0 else 10**9
        if t == s: continue
        if val > best:
            best = val; far = [t]
        elif val == best:
            far.append(t)
    return best, far, dist


def _components(g):
    seen = [False] * g.n
    comps = []
    for s in range(g.n):
        if seen[s]: continue
        stack = [s]; seen[s] = True; comp = []
        while stack:
            u = stack.pop(); comp.append(u)
            for w in g.adj[u]:
                if not seen[w]:
                    seen[w] = True; stack.append(w)
        comps.append(comp)
    return comps


# ---------------------------------------------------------------------------
# B: constrained greedy  (the hard-guarantee backbone)
# ---------------------------------------------------------------------------
def constrained_greedy(n, k, cons, mind=5, rng=None):
    rng = rng or random.Random(0)
    g = Graph(n)
    proh = cons.prohibited
    # 1) required edges first — hard, never removed
    for a, b in cons.required:
        g.add_edge(a, b)
    cur_mind = min(mind, n // 2)

    def allowed(u, v):
        return (u != v and not g.has_edge(u, v)
                and pair(u, v) not in proh
                and g.degree(u) < k and g.degree(v) < k)

    # 2) greedy completion: lowest-degree vertex connects to farthest allowed partner
    guard = 0
    while guard < n * k * 6:
        guard += 1
        # most-deficient vertex
        under = [v for v in range(n) if g.degree(v) < k]
        if not under:
            break
        under.sort(key=lambda v: (g.degree(v), v))
        u = under[0]
        _, far, dist = _ecc_and_far(g, u, proh, k)
        # candidate partners: allowed, farthest first (prefer joining components),
        # then lower degree
        cands = [v for v in range(n) if allowed(u, v)]
        if not cands:
            break
        def score(v):
            d = dist[v]
            far_val = d if d >= 0 else 10**9
            near_enough = far_val >= min(cur_mind, far_val)  # soft
            return (-far_val, g.degree(v), v)
        cands.sort(key=score)
        # respect mind softly: prefer dist>=cur_mind, else demote
        good = [v for v in cands if (dist[v] == -1 or dist[v] >= cur_mind)]
        pick = (good or cands)[0]
        g.add_edge(u, pick)

    # 3) force-connect components under the degree cap. Connectivity beats
    #    girth/regularity, but never exceed k: repeatedly add any legal
    #    (non-prohibited, both-under-k) cross-component edge until one component
    #    remains or no such edge exists. Residual disconnection is honest — it
    #    means the roster cannot be connected within k buddies each.
    for _ in range(n):
        comps = _components(g)
        if len(comps) <= 1:
            break
        if not _join_any(g, comps, proh, k):
            break
    return g


def _join_any(g, comps, proh, k):
    """Add one legal edge bridging two distinct components; True if one was added."""
    for i in range(len(comps)):
        for j in range(i + 1, len(comps)):
            for u in comps[i]:
                if g.degree(u) >= k:
                    continue
                for v in comps[j]:
                    if (g.degree(v) < k and pair(u, v) not in proh
                            and not g.has_edge(u, v)):
                        g.add_edge(u, v)
                        return True
    return False


# ---------------------------------------------------------------------------
# A: seat / label-assignment  (generate anonymous graph, then permute people)
# ---------------------------------------------------------------------------
def _anon_greedy(n, k, mind=5):
    """Unconstrained ring-greedy (anonymous host graph)."""
    g = ring(n)
    cur_mind = min(mind, n // 2)
    while True:
        under = [v for v in range(n) if g.degree(v) < k]
        if not under: break
        under.sort(key=lambda v: (g.degree(v), v))
        u = under[0]
        dist = bfs_distances(g, u)
        ecc = max(dist)
        cands = [v for v in range(n) if v != u and g.degree(v) < k
                 and not g.has_edge(u, v) and dist[v] >= min(cur_mind, ecc)]
        if not cands:
            if cur_mind > 2: cur_mind -= 1; continue
            break
        cands.sort(key=lambda v: (-dist[v], g.degree(v), v))
        g.add_edge(u, cands[0])
    return g


def seat(n, k, cons, mind=5, rng=None, iters=4000):
    """Min-conflicts seat assignment on an anonymous host graph.
    Returns (graph_in_people_labels, unsatisfied_count)."""
    rng = rng or random.Random(0)
    host = _anon_greedy(n, k, mind)
    # adjacency lookup on host
    hostadj = host.adj

    # perm[p] = host vertex assigned to person p ; start identity, shuffle
    perm = list(range(n)); rng.shuffle(perm)

    def violations(perm):
        v = 0
        for a, b in cons.required:
            if perm[b] not in hostadj[perm[a]]: v += 1
        for a, b in cons.prohibited:
            if perm[b] in hostadj[perm[a]]: v += 1
        return v

    cur = violations(perm)
    T = 1.0
    for it in range(iters):
        if cur == 0: break
        i = rng.randrange(n); j = rng.randrange(n)
        if i == j: continue
        perm[i], perm[j] = perm[j], perm[i]
        nv = violations(perm)  # (n small enough; could be incremental)
        d = nv - cur
        if d <= 0 or rng.random() < math.exp(-d / max(T, 1e-3)):
            cur = nv
        else:
            perm[i], perm[j] = perm[j], perm[i]
        T *= 0.999

    # build people-labeled graph
    g = Graph(n)
    inv = [0] * n
    for p in range(n): inv[perm[p]] = p  # host vertex -> person
    for u in range(n):
        for w in hostadj[u]:
            if u < w:
                g.add_edge(inv[u], inv[w])
    return g, cur


# ---------------------------------------------------------------------------
# D: free generate + degree-preserving swap repair
# ---------------------------------------------------------------------------
def free_repair(n, k, cons, mind=5, rng=None, max_passes=6000):
    rng = rng or random.Random(0)
    g = _anon_greedy(n, k, mind)  # anonymous, but here vertices ARE people
    proh, req = cons.prohibited, cons.required

    def edges():
        return [(u, v) for u in range(n) for v in g.adj[u] if u < v]

    def viol():
        pv = sum(1 for e in proh if g.has_edge(*e))
        rv = sum(1 for e in req if not g.has_edge(*e))
        return pv, rv

    for _ in range(max_passes):
        pv, rv = viol()
        if pv == 0 and rv == 0:
            break
        E = edges()
        # try to remove a prohibited edge via swap, or add a required edge via swap
        target = None
        for e in proh:
            if g.has_edge(*e): target = ("remove", e); break
        if target is None:
            for e in req:
                if not g.has_edge(*e): target = ("add", e); break
        if target is None:
            break
        kind, (a, b) = target
        if kind == "remove":
            # a-b present; pick another edge c-d; rewire to a-c,b-d (removes a-b)
            rng.shuffle(E)
            done = False
            for (c, d) in E:
                if len({a, b, c, d}) < 4: continue
                if g.has_edge(a, c) or g.has_edge(b, d): continue
                if pair(a, c) in proh or pair(b, d) in proh: continue
                # don't destroy a required edge
                if pair(a, b) in req or pair(c, d) in req: continue
                g.remove_edge(a, b); g.remove_edge(c, d)
                g.add_edge(a, c); g.add_edge(b, d); done = True; break
            if not done:
                # fallback: just delete (sacrifice regularity)
                g.remove_edge(a, b)
        else:
            # need a-b; both may be at degree k. Find edges a-x and b-y, rewire to a-b + x-y
            adjA = [x for x in g.adj[a]]
            adjB = [y for y in g.adj[b]]
            done = False
            rng.shuffle(adjA); rng.shuffle(adjB)
            for x in adjA:
                for y in adjB:
                    if len({a, b, x, y}) < 4: continue
                    if g.has_edge(x, y): continue
                    if pair(x, y) in proh: continue
                    if pair(a, x) in req or pair(b, y) in req: continue
                    g.remove_edge(a, x); g.remove_edge(b, y)
                    g.add_edge(a, b); g.add_edge(x, y); done = True; break
                if done: break
            if not done:
                g.add_edge(a, b)  # fallback: sacrifice regularity
    return g


# ---------------------------------------------------------------------------
# constraint-preserving polish (shared optimizer)
# ---------------------------------------------------------------------------
def polish_constrained(g, cons, rng=None, iters=8000, prior_weight=0.0):
    rng = rng or random.Random(0)
    g = g.copy()
    proh, req = cons.prohibited, cons.required
    priors = cons.priors

    def energy():
        aspl, _, conn = all_pairs_summary(g)
        e = aspl if conn else aspl + 10 * g.n
        if prior_weight and priors:
            kept = sum(1 for p in priors if g.has_edge(*p))
            e += prior_weight * (len(priors) - kept)
        return e

    def edges():
        return [(u, v) for u in range(g.n) for v in g.adj[u] if u < v]

    cur = energy()
    best = g.copy(); beste = cur
    for _ in range(iters):
        E = edges()
        if len(E) < 2: break
        e1, e2 = rng.sample(E, 2)
        a, b = e1; c, d = e2
        if rng.random() < 0.5:
            x1, y1, x2, y2 = a, c, b, d
        else:
            x1, y1, x2, y2 = a, d, b, c
        if len({a, b, c, d}) < 4: continue
        if g.has_edge(x1, y1) or g.has_edge(x2, y2): continue
        # never break a required edge or create a prohibited one
        if pair(a, b) in req or pair(c, d) in req: continue
        if pair(x1, y1) in proh or pair(x2, y2) in proh: continue
        g.remove_edge(a, b); g.remove_edge(c, d)
        g.add_edge(x1, y1); g.add_edge(x2, y2)
        ne = energy()
        if ne < cur - 1e-12:
            cur = ne
            if ne < beste: beste = ne; best = g.copy()
        else:
            g.remove_edge(x1, y1); g.remove_edge(x2, y2)
            g.add_edge(a, b); g.add_edge(c, d)
    return best
