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
from core import penalized_aspl, Graph, ring, bfs_distances, all_pairs_summary, is_connected
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

    # 2) greedy completion: most-deficient vertex connects to farthest allowed
    #    partner. If that vertex has no legal partner, skip it and try the next
    #    most-deficient one — a single stuck vertex must not starve the rest.
    guard = 0
    while guard < n * k * 6:
        guard += 1
        under = [v for v in range(n) if g.degree(v) < k]
        if not under:
            break
        under.sort(key=lambda v: (g.degree(v), v))
        progressed = False
        for u in under:
            cands = [v for v in range(n) if allowed(u, v)]
            if not cands:
                continue
            _, far, dist = _ecc_and_far(g, u, proh, k)
            # allowed partners, farthest first (prefer joining components), then
            # lower degree, then index. Completion MAXIMISES separation; it does
            # not aim at `mind`.
            #
            # The `good = [...] or cands` filter that used to sit here was provably
            # a no-op and is removed rather than kept as decoration: cands[0] is the
            # farthest (unreachable sorts to 10**9), so if it passes the filter it
            # is good[0], and if it fails then nothing passes — it is the maximum —
            # and the fallback returns cands[0] anyway. `mind` therefore cannot
            # change the output of this function. Mirrored in
            # constrainedGreedy.ts's `choosePartner`.
            cands.sort(key=lambda v: (-(dist[v] if dist[v] >= 0 else 10**9),
                                      g.degree(v), v))
            g.add_edge(u, cands[0])
            progressed = True
            break
        if not progressed:
            break

    # 3) force-connect components under the degree cap: repeatedly ADD any legal
    #    (non-prohibited, both-under-k) cross-component edge.
    for _ in range(n):
        comps = _components(g)
        if len(comps) <= 1:
            break
        if not _join_any(g, comps, proh, k):
            break

    # 4) REWIRE, because adding is not enough. _join_any needs BOTH endpoints under
    #    k, so a component whose whole boundary is saturated cannot be joined however
    #    many legal pairs exist elsewhere -- and the old comment here claimed residual
    #    disconnection "means the roster cannot be connected within k buddies each",
    #    which is false. Witness: n=7, k=2, prohibit (3,5) and (3,4). validate accepts
    #    it, completion leaves {0,1,2,3,6} and {4,5} with every vertex at degree 2, and
    #    the 7-cycle 0-1-2-3-6-4-5-0 is a connected graph at the same k under the same
    #    prohibitions -- one double edge swap away. A degree-preserving swap can reach
    #    it where an addition cannot, because it frees the degree it spends.
    _repair_connectivity(g, cons, k)
    return g


def _bridges(g):
    """Edges whose removal disconnects their component, as a set of pair() keys.

    Needed because a swap between two components merges them IFF at least one of the
    two dropped edges is NOT a bridge. If both are bridges, dropping them splits both
    components and the two new edges reconnect the halves crosswise into two pieces
    again -- the count does not fall. That makes this an exact test, so the repair
    never has to apply a swap speculatively and measure.

    Iterative Tarjan. The result is a property of the graph, not of the traversal, so
    the arbitrary set-iteration order here cannot make it differ from the TS mirror.
    """
    disc = [-1] * g.n
    low = [0] * g.n
    out = set()
    timer = 0
    for root in range(g.n):
        if disc[root] != -1:
            continue
        stack = [(root, -1, iter(sorted(g.adj[root])))]
        disc[root] = low[root] = timer
        timer += 1
        while stack:
            u, parent, it = stack[-1]
            advanced = False
            for w in it:
                if w == parent:
                    continue
                if disc[w] == -1:
                    disc[w] = low[w] = timer
                    timer += 1
                    stack.append((w, u, iter(sorted(g.adj[w]))))
                    advanced = True
                    break
                low[u] = min(low[u], disc[w])
                stack[-1] = (u, parent, it)
            if not advanced:
                stack.pop()
                if stack:
                    pu = stack[-1][0]
                    low[pu] = min(low[pu], low[u])
                    if low[u] > disc[pu]:
                        out.add(pair(pu, u))
            else:
                stack[-2] = (u, parent, it)
    return out


def _repair_connectivity(g, cons, k):
    """Merge components with degree-preserving, constraint-preserving double edge swaps.

    Deterministic and RNG-free like the rest of this generator: components are visited
    in ascending-minimum-vertex order and edges in sorted order, so the first legal
    rewiring found is a function of the graph alone.

    BOUNDED, and the bound is part of the contract. Each pass costs O(n + m) for the
    component/bridge scan plus at most `budget` candidate pairs; the budget is charged
    across the WHOLE repair so a pathological input cannot make this quadratic in m.
    If it runs out, the graph is returned as it stands -- residual disconnection now
    means "no legal rewiring was found within the budget", which is what the docblock
    says, rather than a claim about the roster.
    """
    proh = cons.prohibited
    req = cons.required
    budget = [8 * (g.n + 2 * g.num_edges()) + 64]
    for _ in range(g.n):
        comps = _components(g)
        if len(comps) <= 1:
            return
        bridges = _bridges(g)
        if _swap_join(g, comps, proh, req, bridges, budget):
            continue
        # A swap needs one droppable edge from EACH component, so a component with no
        # edges at all -- a single stranded person -- is beyond it however much slack
        # the rest of the graph has. _steal_slot is tried second because it MOVES a
        # degree rather than preserving every one, which is the strictly larger
        # concession; it is only reached when the cheaper repair found nothing.
        if not _steal_slot(g, comps, proh, req, bridges, k, budget):
            return


def _edges_by_component(g, comps):
    """Edges bucketed by the component their lower endpoint belongs to."""
    owner = {}
    for ci, comp in enumerate(comps):
        for v in comp:
            owner[v] = ci
    per = [[] for _ in comps]
    for (a, b) in sorted(g.edge_list()):
        per[owner[a]].append((a, b))
    return per


def _swap_join(g, comps, proh, req, bridges, budget):
    per = _edges_by_component(g, comps)
    for i in range(len(comps)):
        for j in range(i + 1, len(comps)):
            for (a, b) in per[i]:
                if pair(a, b) in req:
                    continue
                for (c, d) in per[j]:
                    if pair(c, d) in req:
                        continue
                    if budget[0] <= 0:
                        return False
                    budget[0] -= 1
                    # Both bridges cannot merge -- see _bridges.
                    if pair(a, b) in bridges and pair(c, d) in bridges:
                        continue
                    for (x, y) in ((c, d), (d, c)):
                        if a == x or b == y:
                            continue
                        if g.has_edge(a, x) or g.has_edge(b, y):
                            continue
                        if pair(a, x) in proh or pair(b, y) in proh:
                            continue
                        g.remove_edge(a, b)
                        g.remove_edge(c, d)
                        g.add_edge(a, x)
                        g.add_edge(b, y)
                        return True
    return False


def _steal_slot(g, comps, proh, req, bridges, k, budget):
    """Join two components by MOVING a degree: drop a non-bridge edge (a,b) inside one
    component and spend the freed slot on an under-k vertex u in another.

    Why this exists on top of _swap_join. A double edge swap needs a droppable edge in
    each of the two components, so it cannot touch a component that has no edges --
    exactly the shape a saturated boundary produces at small k. Witness: n=4, k=2,
    prohibiting (1,3) and (2,3). Completion builds the triangle 0-1-2 and leaves person
    3 alone with no legal partner (0 is full, 1 and 2 are prohibited); _join_any cannot
    add, _swap_join has nothing to swap, and the result reported connected=False with
    largest-component 0.75 -- while 0-1, 0-3, 1-2 is a connected graph at the same k
    under the same prohibitions.

    Dropping non-bridge (a,b) keeps a and b connected to each other, so the only
    component change is the merge. Edge COUNT is preserved (one removed, one added);
    what moves is a single degree, from b to u. That is a real concession -- the result
    is less regular than the input -- and it is why this runs only after _swap_join,
    which concedes nothing, has failed.

    Deterministic and RNG-free: components ascending, vertices ascending, edges in
    sorted order, so the first legal move is a function of the graph alone.
    """
    per = _edges_by_component(g, comps)
    for i in range(len(comps)):
        for u in sorted(comps[i]):
            if g.degree(u) >= k:
                continue
            for j in range(len(comps)):
                if j == i:
                    continue
                for (a, b) in per[j]:
                    if pair(a, b) in req or pair(a, b) in bridges:
                        continue
                    if budget[0] <= 0:
                        return False
                    budget[0] -= 1
                    for keep in (a, b):
                        if pair(u, keep) in proh or g.has_edge(u, keep):
                            continue
                        g.remove_edge(a, b)
                        g.add_edge(u, keep)
                        return True
    return False


def _join_any(g, comps, proh, k):
    """Add one legal edge bridging two distinct components; True if one was added.

    Adding needs BOTH endpoints under k. _repair_connectivity runs after this and can rewire;
    what survives both is disconnection no single constraint-preserving swap can remove.
    """
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

    def measure():
        _, _, conn = all_pairs_summary(g)
        e = penalized_aspl(g)
        if prior_weight and priors:
            kept = sum(1 for p in priors if g.has_edge(*p))
            e += prior_weight * (len(priors) - kept)
        return e, conn

    def edges():
        return [(u, v) for u in range(g.n) for v in g.adj[u] if u < v]

    cur, was_connected = measure()
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
        ne, conn = measure()
        # never trade connectivity away, however large the prior weight
        if was_connected and not conn:
            g.remove_edge(x1, y1); g.remove_edge(x2, y2)
            g.add_edge(a, b); g.add_edge(c, d)
            continue
        if ne < cur - 1e-12:
            cur = ne
            if ne < beste: beste = ne; best = g.copy()
        else:
            g.remove_edge(x1, y1); g.remove_edge(x2, y2)
            g.add_edge(a, b); g.add_edge(c, d)
    return best
