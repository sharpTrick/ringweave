"""Constraint model for buddy-graph generation.

Types:
  prohibited  (a,b) : a and b must NOT be buddies              [HARD]
  required    (a,b) : a and b MUST be buddies                  [HARD]
  priors      (a,b) : prefer a and b remain buddies (churn)    [SOFT, toggle HARD]
  tags        person -> label, compiled to prohibited/required by a policy

Directive: required/prohibited are hard. We sacrifice regularity to satisfy
them where possible, and refuse (with a specific reason) only when a graph is
genuinely impossible.
"""


def pair(a, b):
    return (a, b) if a < b else (b, a)


class Constraints:
    def __init__(self, n):
        self.n = n
        self.required = set()
        self.prohibited = set()
        self.priors = set()
        self.prior_hard = False

    def require(self, a, b):
        self.required.add(pair(a, b)); return self

    def prohibit(self, a, b):
        self.prohibited.add(pair(a, b)); return self

    def add_prior(self, a, b):
        self.priors.add(pair(a, b)); return self

    # ---- tag compilation ----
    @classmethod
    def from_tags(cls, n, tags, policy="prohibit_same"):
        """tags: list of length n (group labels).
        policy 'prohibit_same': members of the same group are never buddies
               (households, teams that shouldn't self-pair)."""
        c = cls(n)
        if policy == "prohibit_same":
            for i in range(n):
                for j in range(i + 1, n):
                    if tags[i] is not None and tags[i] == tags[j]:
                        c.prohibit(i, j)
        else:
            raise ValueError(f"unknown tag policy {policy}")
        return c

    def merge(self, other):
        self.required |= other.required
        self.prohibited |= other.prohibited
        self.priors |= other.priors
        return self

    # ---- derived helpers ----
    def required_degree(self):
        d = [0] * self.n
        for a, b in self.required:
            d[a] += 1; d[b] += 1
        return d

    def prohibited_degree(self):
        d = [0] * self.n
        for a, b in self.prohibited:
            d[a] += 1; d[b] += 1
        return d


def validate(cons, k):
    """Return list of human-readable infeasibility reasons (empty = feasible).
    These are the cases where NO valid graph exists; everything else we handle
    by sacrificing regularity."""
    errs = []
    n = cons.n

    if not isinstance(k, int) or isinstance(k, bool) or k < 0:
        return [f"buddy count {k} must be a non-negative whole number"]

    reqd = cons.required_degree()
    prod = cons.prohibited_degree()

    for v in range(n):
        if reqd[v] > k:
            errs.append(f"person {v} has {reqd[v]} required buddies but each person gets {k}")

    for e in cons.required:
        if e in cons.prohibited:
            errs.append(f"pair {e[0]}–{e[1]} is both required and prohibited")

    for v in range(n):
        allowed = (n - 1) - prod[v]
        if allowed < reqd[v]:
            errs.append(f"person {v} cannot meet required buddies within their prohibited set")
        # only a real problem when people actually need buddies (k > 0)
        if allowed <= 0 and n > 1 and k > 0:
            errs.append(f"person {v} is prohibited from everyone — they'd have no buddies")

    # connectivity feasibility: if prohibited pairs split the roster so that some
    # people can never be linked to the rest (even ignoring degree caps), no
    # connected buddy graph exists. Necessary condition; degree-budget shortfalls
    # are handled by sacrificing regularity, not refused here.
    if k > 0 and n > 1:
        errs += _connectivity_errors(cons)

    return sorted(set(errs))


def _connectivity_errors(cons):
    """Refuse when the allowed-pairs graph (all non-prohibited pairs) is itself
    disconnected — then no edge selection can ever connect everyone."""
    n = cons.n
    proh = cons.prohibited
    if not proh:
        return []  # nothing prohibited => allowed graph is complete, connected
    seen = [False] * n
    seen[0] = True
    stack = [0]
    while stack:
        u = stack.pop()
        for v in range(n):
            if not seen[v] and v != u and pair(u, v) not in proh:
                seen[v] = True
                stack.append(v)
    if all(seen):
        return []
    stranded = next(v for v in range(n) if not seen[v])
    return [f"prohibited pairs split the group — person {stranded} can never be connected to everyone"]
