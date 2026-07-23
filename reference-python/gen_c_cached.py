"""Cached ring-greedy: maintain an all-pairs distance matrix and update it
incrementally on each edge insertion, instead of re-running BFS from every
deficient vertex every round.

Key identity for inserting edge (u,v) into a graph (distances can only shrink):
    new[i,j] = min( old[i,j], old[i,u]+1+old[v,j], old[i,v]+1+old[u,j] )

This is a rank-1-style update done as numpy broadcast ops = O(n^2) per edge,
replacing O(n * BFS) = O(n^2 k) per edge. Same asymptotics up to the k factor,
but the constant is enormously smaller (vectorized array math vs Python-level
BFS with deque/set overhead).

Correctness contract: because ring-greedy is deterministic, this MUST produce
byte-identical graphs to generators.ring_greedy. That equality is the test.
"""
import numpy as np
from core import Graph, ring, bfs_distances
from generators import _repair_degrees


def ring_greedy_cached(n, k, mind=5, demote=True, repair=False):
    g = ring(n)
    INF = n + 5

    # initial all-pairs matrix (one BFS per source, one time)
    dist = np.full((n, n), INF, dtype=np.int32)
    for s in range(n):
        d = bfs_distances(g, s)
        row = dist[s]
        for t in range(n):
            row[t] = d[t] if d[t] >= 0 else INF
    np.fill_diagonal(dist, 0)

    cur_mind = min(mind, n // 2)

    def update_after_edge(u, v):
        # distances only decrease; two shortcut routes through the new edge
        col_u = dist[:, u][:, None]      # dist[i,u]
        col_v = dist[:, v][:, None]      # dist[i,v]
        row_v = dist[v, :][None, :]      # dist[v,j]
        row_u = dist[u, :][None, :]      # dist[u,j]
        np.minimum(dist, col_u + 1 + row_v, out=dist)
        np.minimum(dist, col_v + 1 + row_u, out=dist)

    def find_pair():
        degs = np.fromiter((len(g.adj[i]) for i in range(n)), dtype=np.int32, count=n)
        under = np.where(degs < k)[0]
        if under.size == 0:
            return None
        best = None
        for va in under:
            va = int(va)
            row = dist[va]
            finite = row[row < INF]
            ecc = int(finite.max())
            if ecc < cur_mind:
                continue
            far = np.where(row == ecc)[0]
            va_ne = int(degs[va])
            for vb in far:
                vb = int(vb)
                if vb <= va:
                    continue
                if int(degs[vb]) >= k:
                    continue
                if g.has_edge(va, vb):
                    continue
                ne_min, ne_max = sorted((va_ne, int(degs[vb])))
                perim = min(abs(va - vb), abs(va - vb - n), abs(vb - va - n))
                key = (ne_max, ne_min, -ecc, -perim, va, vb)
                if best is None or key < best[:6]:
                    best = (ne_max, ne_min, -ecc, -perim, va, vb, va, vb)
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
        u, v = pair
        g.add_edge(u, v)
        update_after_edge(u, v)

    if repair:
        _repair_degrees(g, k, min_dist=3)

    return g, cur_mind
