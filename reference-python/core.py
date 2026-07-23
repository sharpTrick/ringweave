"""Core graph utilities, metrics, and lower bounds for the buddy-graph bake-off.

Graph representation: adjacency as list[set[int]], vertices 0..n-1.
Everything here is dependency-light (stdlib + numpy) so the winning core
ports to JS with minimal fuss.
"""
from collections import deque
import math
import random


# ----------------------------------------------------------------------------
# Graph container
# ----------------------------------------------------------------------------
class Graph:
    __slots__ = ("n", "adj")

    def __init__(self, n):
        self.n = n
        self.adj = [set() for _ in range(n)]

    def add_edge(self, u, v):
        if u == v:
            return False
        if v in self.adj[u]:
            return False
        self.adj[u].add(v)
        self.adj[v].add(u)
        return True

    def remove_edge(self, u, v):
        self.adj[u].discard(v)
        self.adj[v].discard(u)

    def has_edge(self, u, v):
        return v in self.adj[u]

    def degree(self, u):
        return len(self.adj[u])

    def degrees(self):
        return [len(a) for a in self.adj]

    def num_edges(self):
        return sum(len(a) for a in self.adj) // 2

    def edge_list(self):
        out = []
        for u in range(self.n):
            for v in self.adj[u]:
                if u < v:
                    out.append((u, v))
        return out

    def copy(self):
        g = Graph(self.n)
        g.adj = [set(a) for a in self.adj]
        return g


def ring(n):
    """Hamiltonian cycle on n vertices."""
    g = Graph(n)
    for i in range(n):
        g.add_edge(i, (i + 1) % n)
    return g


# ----------------------------------------------------------------------------
# BFS-based metrics
# ----------------------------------------------------------------------------
def bfs_distances(g, s):
    """Distance vector from s. Unreachable -> -1."""
    dist = [-1] * g.n
    dist[s] = 0
    q = deque([s])
    while q:
        u = q.popleft()
        du = dist[u]
        for w in g.adj[u]:
            if dist[w] == -1:
                dist[w] = du + 1
                q.append(w)
    return dist


def is_connected(g):
    if g.n == 0:
        return True
    d = bfs_distances(g, 0)
    return all(x != -1 for x in d)


def all_pairs_summary(g):
    """Single pass over all sources. Returns (aspl, diameter, connected).

    aspl = average shortest path length over all ordered reachable pairs
    (equivalently unordered; symmetric). If disconnected, connected=False and
    aspl/diameter computed over reachable pairs only (callers decide penalty).
    """
    n = g.n
    total = 0
    count = 0
    diameter = 0
    connected = True
    for s in range(n):
        dist = bfs_distances(g, s)
        reached = 0
        for t in range(n):
            d = dist[t]
            if d > 0:
                total += d
                count += 1
                reached += 1
                if d > diameter:
                    diameter = d
        if reached < n - 1:
            connected = False
    aspl = total / count if count else math.inf
    return aspl, diameter, connected


def largest_component_fraction(g):
    """Fraction of vertices in the largest connected component."""
    if g.n == 0:
        return 1.0
    seen = [False] * g.n
    best = 0
    for start in range(g.n):
        if seen[start]:
            continue
        size = 0
        q = deque([start])
        seen[start] = True
        while q:
            u = q.popleft()
            size += 1
            for w in g.adj[u]:
                if not seen[w]:
                    seen[w] = True
                    q.append(w)
        best = max(best, size)
    return best / g.n


def girth(g):
    """Length of shortest cycle, or math.inf if acyclic (forest).

    BFS from each vertex; when we meet an already-labeled non-parent vertex we
    close a cycle. Standard O(n*m) unweighted girth.
    """
    n = g.n
    best = math.inf
    for s in range(n):
        dist = [-1] * n
        parent = [-1] * n
        dist[s] = 0
        q = deque([s])
        while q:
            u = q.popleft()
            for w in g.adj[u]:
                if dist[w] == -1:
                    dist[w] = dist[u] + 1
                    parent[w] = u
                    q.append(w)
                elif parent[u] != w:
                    # found a cycle through s's BFS tree
                    cyc = dist[u] + dist[w] + 1
                    if cyc < best:
                        best = cyc
        if best == 3:
            break  # can't do better
    return best


# ----------------------------------------------------------------------------
# Lower bounds (Moore-style)
# ----------------------------------------------------------------------------
def moore_lower_bounds(n, k):
    """Return (aspl_lb, diameter_lb).

    Fill distance shells of size k, k(k-1), k(k-1)^2, ... from a vertex until
    n-1 other vertices are accounted for. This is the best-case (tree-like)
    neighborhood expansion; any k-regular graph's ASPL is >= this.
    """
    # n and k must be whole numbers: a non-integer k drives shell *= (k-1) into a
    # denormal floating-point fixed point that never reaches 0 (infinite loop).
    if (not isinstance(n, int) or isinstance(n, bool)
            or not isinstance(k, int) or isinstance(k, bool)
            or k <= 0 or n <= 1):
        return 0.0, 0
    remaining = n - 1
    total = 0
    shell = k
    dist = 1
    diameter_lb = 0
    while remaining > 0:
        take = min(shell, remaining)
        total += dist * take
        remaining -= take
        diameter_lb = dist
        dist += 1
        if k == 1:
            shell = 0  # degenerate; will just linearly fill (won't be regular)
        elif k == 2:
            shell = k  # a cycle: each shell is 2 (until wrap) -- approximation
        else:
            shell = shell * (k - 1)
        if shell == 0:
            # can't expand further but vertices remain: pad at current dist+
            # (keeps bound finite for infeasible params)
            total += dist * remaining
            diameter_lb = dist
            remaining = 0
    aspl_lb = total / (n - 1)
    return aspl_lb, diameter_lb


# ----------------------------------------------------------------------------
# Analytic references for tests
# ----------------------------------------------------------------------------
def cycle_aspl(n):
    """Exact ASPL of the cycle graph C_n."""
    if n < 2:
        return 0.0
    if n % 2 == 0:
        # distances 1..n/2, with n/2 appearing once per pair-direction
        # sum over one source of distances to all others:
        half = n // 2
        s = 2 * sum(range(1, half)) + half
    else:
        half = (n - 1) // 2
        s = 2 * sum(range(1, half + 1))
    return s / (n - 1)
