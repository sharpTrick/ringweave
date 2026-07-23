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
        if allowed <= 0 and n > 1:
            errs.append(f"person {v} is prohibited from everyone — they'd have no buddies")

    # global edge budget sanity: required edges alone must fit under degree caps
    # (already covered per-vertex by reqd[v] <= k)
    return sorted(set(errs))
