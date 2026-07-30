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
    structural = _structural_errors(cons)
    if structural:
        return sorted(set(structural))

    # Refuse an oversized roster before the O(n^2) connectivity walk and
    # generation: the constrained path is O(n^2) in time, so a legal-but-huge
    # roster would hang rather than crash. Well under MAX_ROSTER.
    if cons.n > MAX_CONSTRAINED_N:
        return [
            f"roster size {cons.n} exceeds the constrained maximum of {MAX_CONSTRAINED_N} (generation is O(n²))"
        ]

    errs = []
    n = cons.n

    if not isinstance(k, int) or isinstance(k, bool) or k < 0:
        return [f"buddy count {k} must be a non-negative whole number"]

    # Dense k blows generation up past the n-cap (one BFS per edge, ~n*min(k,n-1)/2
    # edges); refuse when the estimated work exceeds the budget. Mirrors the TS port.
    if _constrained_work(cons.n, k, len(cons.prohibited)) > MAX_CONSTRAINED_WORK:
        return [
            f"roster size {cons.n} with {k} buddies each is too large to generate in reasonable time — reduce the roster size or the buddy count"
        ]

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


# Far beyond product scale but bounded so n-sized allocation can't blow up.
MAX_ROSTER = 1_000_000

# Constrained generation runs one BFS per edge added (O(n^2) in time), so it is
# capped far tighter than MAX_ROSTER to keep worst-case generation bounded.
MAX_CONSTRAINED_N = 5000

# Work budget bounding the dense-k blow-up that MAX_CONSTRAINED_N misses. Wall-clock
# tracks n^2 * min(k, n-1); this ceiling holds worst-case generation to tens of
# seconds. Mirrors the TS port (see MAX_CONSTRAINED_WORK in graph.ts).
MAX_CONSTRAINED_WORK = 100_000_000

# Mirrors MAX_STRUCTURAL_REASONS in the TS port — see there for why the list is capped.
MAX_STRUCTURAL_REASONS = 16


# Cost charged per prohibited pair. A FLOOR, not a model of the shape: every legality decision
# in the generator probes the prohibited set, and a dense set makes more candidates fail, so more
# are scanned per edge added. Calibrated as a rate on the shape with headroom to measure (n=3000,
# k=4: 11.7 s more with a million pairs, 77 units/pair at that roster's 6.55e6 units/s, rounded
# up). Mirrors PROHIBITED_PROBE_COST in the TS port.
PROHIBITED_PROBE_COST = 80


def _constrained_work(n, k, prohibited_count):
    """Estimated constrained-generation cost: vertices x edges-added, plus the constraint set.

    `prohibited_count` is required rather than defaulted — the caller holds the Constraints, and
    an optional argument is how the dimension went missing the first time.
    """
    return n * n * min(k, max(0, n - 1)) + PROHIBITED_PROBE_COST * prohibited_count


def _structural_errors(cons):
    """Ill-formed roster size or constraint endpoints (unknown ids, self-pairs).
    Mirrors the TypeScript port's structural validation layer."""
    n = cons.n
    if not isinstance(n, int) or isinstance(n, bool) or n < 0:
        return [f"roster size {n} is not a valid count"]
    if n > MAX_ROSTER:
        return [f"roster size {n} exceeds the maximum of {MAX_ROSTER}"]
    errs = []
    # Faulty CONSTRAINTS, not faulty endpoints: a pair with two unknown people is one invalid
    # constraint, and counting notes made the refusal say "4 constraints are invalid" about two.
    faulty = [0]
    # Set when a distinct message could not be listed, which is the only thing "only some are
    # listed" can honestly mean. Counting notes fired it whenever duplicates deduped, so a
    # refusal that listed every distinct reason still claimed it had held some back.
    suppressed = [False]

    # Counted always, listed up to the cap. The list used to be unbounded in both work and
    # output; see MAX_STRUCTURAL_REASONS in the TS port for the measurements.
    # WHICH messages survive the cap is the alphabetically smallest DISTINCT ones, not the first
    # encountered: this mirror iterates its sets in hash order and the TS port iterates its Sets
    # in insertion order, so "the first 16" made a refusal's text a function of how the constraint
    # set was built, breaking the message parity the two are held to. Deduping here also stops a
    # thousand copies of one fault from filling every slot.
    def note(msg):
        if len(errs) == MAX_STRUCTURAL_REASONS and msg >= errs[-1]:
            suppressed[0] = True
            return
        at = 0
        while at < len(errs) and errs[at] < msg:
            at += 1
        if at < len(errs) and errs[at] == msg:
            return
        errs.insert(at, msg)
        if len(errs) > MAX_STRUCTURAL_REASONS:
            errs.pop()
            suppressed[0] = True

    def scan(pairs):
        for (a, b) in pairs:
            bad = False
            for x in (a, b):
                if not isinstance(x, int) or isinstance(x, bool) or x < 0 or x >= n:
                    note(f"constraint references unknown person {x} (roster has {n})")
                    bad = True
            if a == b:
                note(f"person {a} cannot be paired with themselves")
                bad = True
            if bad:
                faulty[0] += 1

    scan(cons.required)
    scan(cons.prohibited)
    scan(cons.priors)
    if suppressed[0]:
        errs.append(f"{faulty[0]} constraints are invalid — only some are listed")
    return errs


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
