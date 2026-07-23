# Concept Lineage

*Intellectual genealogy of the graph-generation strategies explored in this project.*

**Author:** Patrick Sharp (github: sharpTrick)
**Naming:** the algorithm library is published as **`ringweave`** (ring seed + greedy chord
weaving); **BuddyGraph** is the product name of the web app built on it.
**Contributions:** Project conception and the ring-greedy synthesis (Strategy C) are the work of
Patrick Sharp. The original `genreg_via_cycles` repository is Patrick Sharp's *port* of Markus
Meringer's freely-available GENREG (see §2); the underlying girth-first generator is Meringer's
work. The strategy bake-off, benchmarking framework, and the cached-greedy performance work (§8)
were developed collaboratively with Claude (Anthropic) during analysis sessions in 2026. See
Acknowledgments (§10).

This document traces where each algorithm in this repository comes from — the ideas it
descends from, the researchers who introduced them, and how they were re-aimed at our actual
objective: connecting a group of people so that everyone is, on average, as few hops from
everyone else as possible (minimum **average shortest path length**, ASPL) while each person
has a fixed, equal number of buddies (a **k-regular graph**).

The through-line: a 130-year-old question in pure graph theory, filtered through 1980s
interconnection-network design and probabilistic combinatorics, crossed with a general-purpose
1980s optimization metaheuristic, all re-pointed at the average-distance objective that a
2010s open competition formalized — converging on a single greedy synthesis.

---

## 0. The objective, and how it shifted

The project began chasing **large girth** (no short cycles back to yourself) and evolved to
chasing **low average distance**. These are related but not identical: girth is a *local*
property (it forbids short redundant loops), whereas ASPL is the *global* quantity we actually
care about. Large girth is a good *proxy* — a locally tree-like graph spends its limited edges
reaching new people rather than re-connecting neighbors — but it is a means, not the end. Every
strategy below is ultimately scored against the same yardstick:

> **ASPL gap** = (ASPL − Moore lower bound) / Moore lower bound. 0% = provably optimal.

This is the metric used by the Graph Golf competition (§6), and it needs no external reference
data — only the theoretical floor from §1.

---

## 1. Root: cages and the Moore bound (1890s–1960s)

The oldest ancestor is a pure-mathematics question: *what is the smallest k-regular graph with
a given girth?* Such extremal graphs are called **cages**, and the **Moore bound** is the
theoretical lower bound on how few vertices a graph of given degree and girth can have. The
same bound, read the other way, gives the best-possible (tree-like) neighborhood expansion, and
hence a lower bound on ASPL — which is exactly how we compute the 0%-reference in every results
table.

- The **Petersen graph** (Petersen, 1898) is the (3,5)-cage and a *Moore graph*: it meets the
  bound exactly. We use it as the primary calibration anchor in the test suite — our Moore
  lower bound reproduces its ASPL of 5/3 to the digit, which is the strongest possible check
  that the metric is correct.
- The term "cage" and the systematic study trace to **Tutte (1947)**; existence results to
  **Erdős & Sachs (1963)**.

This ancestry is literally still present in the original repository, encoded in its
feasibility checks (Moore-bound / cage-order references in `validate_arguments`).

**Key references**
- J. Petersen, "Die Theorie der regulären Graphs," *Acta Mathematica* 15 (1891), 193–220.
- W. T. Tutte, "A family of cubical graphs," *Proc. Cambridge Phil. Soc.* 43 (1947), 459–474.
- P. Erdős & H. Sachs, "Reguläre Graphen gegebener Taillenweite mit minimaler Knotenzahl,"
  *Wiss. Z. Univ. Halle* 12 (1963), 251–257.

---

## 2. Strategy B — girth-first backtracking generation (`gen_b.py`)

*The original repository's approach: `genreg_via_cycles` — a port by Patrick Sharp of Markus
Meringer's GENREG.*

This strategy is **Markus Meringer's work**. GENREG (Meringer, 1999) is the classical generator
for regular graphs — it does not merely count them but *constructs* the desired graphs — and
Meringer has generously made the source code and executables freely available for decades from
his university page at Bayreuth (via SourceForge and a ResearchGate source package, with a
makefile and English/German manuals included). The original repository, `genreg_via_cycles`, is
**Patrick Sharp's port** of that freely-offered work; the algorithm and its efficiency are
Meringer's.

The GENREG philosophy is *feasibility-driven enumeration*: fix degree k and a girth floor g,
then construct graphs satisfying both. Its efficiency comes from **orderly generation** with a
fast **canonicity test** that avoids pairwise isomorphism checking — the machinery needed to
enumerate *all* such graphs (a harder problem than finding one), and the reason GENREG could
compute the large tables of regular-graph counts Meringer publishes. The largest cubic (k=3)
cases on that page were separately solved by **Gunnar Brinkmann** (Ghent) with a specialized
algorithm; later large values were contributed by **Jason Kimberley**.

The `gen_b.py` in *this* project is a lightweight reconstruction of the girth-first idea
(girth-floor-via-bounded-BFS + backtracking) built only for the bake-off — it is **not**
GENREG, nor as capable; any conclusions here about girth-first vs. greedy reflect that
reconstruction, not Meringer's optimized generator.

**Finding (this project):** at *our* objective — minimum ASPL, not exhaustive enumeration —
higher girth did not buy lower ASPL. The girth-first idea nonetheless lives on, in cheaper
soft-constraint form, as the `mind` distance floor inside Strategy C.

**Citation (as requested by the author of GENREG):**
> M. Meringer, "Fast Generation of Regular Graphs and Construction of Cages,"
> *Journal of Graph Theory* 30 (1999), 137–146.

GENREG source, executables, and manuals: Markus Meringer, Regular Graphs Page,
https://www.mathe2.uni-bayreuth.de/markus/reggraphs.html (maintained 1997–2024);
SourceForge: https://sourceforge.net/projects/genreg/

**Related**
- G. Brinkmann et al. (minibaum / snarkhunter) — efficient cubic-graph generation, Ghent.

---

## 3. Strategy D — circulant / chordal-ring graphs (`circulant`, 1980s)

A separate lineage, from **interconnection-network design** rather than pure graph theory: take
a ring and add chords at fixed offsets, exploiting perfect vertex-transitive symmetry so that
routing is a simple distributed rule. Arden & Lee introduced the degree-3 **chordal ring** and
showed its diameter is O(√n); the family generalizes to any degree via fixed offset sets, and
the "ring + one chord offset" case is the classic circulant.

**Finding:** the same rigid symmetry that makes routing trivial is *why it loses*. Every vertex
is identical, so a circulant cannot do the local distance-tuning the greedy and swap methods
exploit; its ASPL gap explodes with n (44% at n=100 k=4, >200% at n=100 k=3), and at k=3 it is
the only method that fragments under member churn. Retained only as an honest baseline.

**Key references**
- B. W. Arden & H. Lee, "Analysis of Chordal Ring Network," *IEEE Transactions on Computers*
  C-30(4) (1981), 291–295. doi:10.1109/TC.1981.1675777
- K. Doty, "New Designs for Dense Processor Interconnection Networks,"
  *IEEE Transactions on Computers* C-33(5) (1984), 447.

---

## 4. Strategy A — random regular graphs (`random_regular`, 1980)

The probabilistic turn. Rather than construct carefully, throw down edges at random (the
**configuration / pairing model**, Bollobás 1980) and reject draws that produce multi-edges,
self-loops, or disconnection. This is trivially fast at any scale.

The deep reason it is a serious contender: a uniformly random k-regular graph is, with high
probability, a **near-optimal expander** — Alon's second-eigenvalue conjecture, proved by
**Friedman (2008)**, shows the second-largest adjacency eigenvalue is at most 2√(k−1)+ε whp
("almost Ramanujan"). A small spectral gap implies short average distances. This is precisely
why random-regular, despite having a few short cycles, *quietly catches up to the structured
methods at large n* in our results.

**Key references**
- B. Bollobás, "A probabilistic proof of an asymptotic formula for the number of labelled
  regular graphs," *European Journal of Combinatorics* 1 (1980), 311–316.
- A. Broder & E. Shamir, "On the second eigenvalue of random regular graphs,"
  *Proc. 28th FOCS* (1987), 286–294.
- J. Friedman, "A proof of Alon's second eigenvalue conjecture and related problems,"
  *Memoirs of the AMS* 195(910) (2008).

---

## 5. Strategy C — ring-greedy (`generators.ring_greedy`; the project's synthesis)

*The rewrite where the separate lineages fuse — the project's central contribution
(Patrick Sharp).*

Strategy C keeps the **ring seed** (a nod to the chordal-ring lineage of §3) but replaces fixed
offsets with a **greedy augmentation rule**: repeatedly add the chord joining the pair that is
(in strict lexicographic priority) lowest max-degree, then lowest min-degree, then farthest
apart, with a ring-proximity tiebreak — subject to endpoints being at distance ≥ `mind` and
below the degree cap.

Two ideas from the earlier lineages survive here in cheaper form:
- The **`mind` parameter is the girth idea reborn** (§1–2): a *soft distance floor* instead of a
  hard search constraint. Connecting only far-apart pairs guarantees any new cycle is long, so
  girth emerges as a by-product rather than a target.
- The **ring** provides guaranteed connectivity and a natural incremental structure (splice in a
  newcomer, add a few chords) — inherited from §3 without the rigidity.

Greedy augmentation also cannot paint itself into a corner the way backtracking (§2) can: it
simply stops when no legal pair remains, gracefully yielding a "mostly regular" graph — which
is exactly the right failure mode for a real buddy roster.

**Finding:** best *un-polished* seed at every size, landing 2–5% from optimal, and — once the
metric bookkeeping is fixed (§7) — the best standalone pipeline at large n.

---

## 6. The objective, formalized — the order/degree problem & Graph Golf (2015–)

Somewhere between the original repo and the Julia rewrite, the true objective clarified from
"large girth" to "small average distance." That is exactly the **order/degree problem**: over
all graphs with n vertices and degree ≤ d, minimize diameter, breaking ties by minimum ASPL. It
was run as an open competition, **Graph Golf**, by Japan's National Institute of Informatics,
motivated by designing low-latency interconnection topologies for parallel computers (the same
application domain as §3, now with an explicit distance objective). Our **ASPL-gap** metric and
the entire benchmarking framing come from this line of work.

**Key references**
- Graph Golf: The Order/degree Problem Competition, National Institute of Informatics.
  https://research.nii.ac.jp/graphgolf/
- V. S. Nittoor et al. — GENREG adapted to supercomputers to discover minimal-ASPL regular
  graphs for interconnection networks (the bridge tying §2's generator to §6's objective).

---

## 7. Strategy E — edge-swap simulated annealing (`polish`, 1983)

A general-purpose **metaheuristic** layer, orthogonal to how the starting graph was built. Take
any graph and locally rewire it with a **double edge swap** — replace edges (a–b, c–d) with
(a–c, b–d) — which *preserves every vertex's degree automatically*, so the whole space of
k-regular graphs is reachable and regularity is never broken. Accept swaps that lower ASPL, and
(annealing-style) occasionally accept worse ones to escape local minima, per **Kirkpatrick,
Gelatt & Vecchi (1983)**. The degree-preserving swap itself is the classic **edge-switching**
Markov-chain move used for sampling and randomizing graphs with a fixed degree sequence.

This was the dominant technique among Graph Golf entrants, and it dominated in our tests too:
it reaches the *provable optimum* (0% gap) at small sizes and stays within 2–4% up to n≈200.
Its limit is exploration — at very large n it cannot search enough of the space in reasonable
time, which is where a good structured seed (§5) wins instead.

**Key references**
- S. Kirkpatrick, C. D. Gelatt, M. P. Vecchi, "Optimization by Simulated Annealing,"
  *Science* 220(4598) (1983), 671–680.
- Degree-preserving edge switching: standard in the configuration-model / graph-randomization
  literature (see e.g. Milo et al. on network motif null models, 2003).

---

## 8. Cached greedy — incremental all-pairs distance maintenance (`gen_c_cached.py`)

*A performance contribution developed in the course of this project's analysis (2026).*

This is **not a new algorithm** — it is Strategy C (§5) with the distance bookkeeping done
right. The naive greedy re-runs a BFS from every deficient vertex every round, which is where
its apparent O(n³) wall came from. The fix maintains an all-pairs distance matrix and updates
it incrementally on each edge insertion, using the classical identity that inserting edge (u,v)
can only *shorten* distances:

> new[i,j] = min( old[i,j], old[i,u] + 1 + old[v,j], old[i,v] + 1 + old[u,j] )

applied as a vectorized array update. The **underlying technique — incremental all-pairs
shortest paths under edge insertion — is decades-old** dynamic-graph theory (see e.g. the
incremental/decremental APSP literature, Even & Shiloach 1981 onward, through Demetrescu &
Italiano 2004); the contribution here is *applying it to the ring-greedy generator* and
demonstrating that it removes the scaling wall entirely.

**Result:** byte-identical output to §5 (verified: same edge sets, same ASPL at every tested
cell), while running ~11× faster at n=500 (22 s → 2 s) and making n=1000 practical (10 s, vs
>60 s abandoned). At n=1000 the cached greedy alone (4.17% gap) beats random+polish.

*Attribution note:* the incremental-distance identity is not original to this work; its
application to Patrick Sharp's ring-greedy pipeline, the correctness verification, and the
demonstrated scaling result were produced collaboratively (Patrick Sharp with Claude, Anthropic)
during this project's 2026 analysis, and may be cited as such.

**Background references**
- S. Even & Y. Shiloach, "An on-line edge-deletion problem," *J. ACM* 28(1) (1981), 1–4.
- C. Demetrescu & G. F. Italiano, "A new approach to dynamic all pairs shortest paths,"
  *J. ACM* 51(6) (2004), 968–992.

---

## 9. Summary genealogy

```
 cages / Moore bound (1890s–1960s)  ── theoretical floor & girth idea
        │
        ├──► GENREG / girth-first enumeration (Meringer 1999) ──► Strategy B
        │
        │        chordal rings (Arden & Lee 1981) ──► Strategy D
        │              │
 random regular /      │  (ring seed inherited)
 config model          │
 (Bollobás 1980;       ▼
  Friedman 2008) ──► Strategy A        girth-as-`mind` soft floor
        │                    ╲        ╱
        │                     ▼      ▼
        │                  Strategy C  (ring-greedy synthesis)
        │                        │
        │                        ├──► cached greedy (incremental APSP; this project)
        │                        │
 simulated annealing             │
 (Kirkpatrick 1983) +            ▼
 edge switching ───────────► Strategy E (swap-polish, applied to any seed)

 objective re-aimed by: order/degree problem & Graph Golf (NII, 2015–) ── ASPL-gap metric
```

**Landing point.** For the buddy-system use case: **ring-greedy (C), with the cached distance
update (§8)**, as the default — deterministic, explainable ("build a ring, add connections
greedily"), regular, and fast at every realistic size — with **swap-polish (E)** available as a
regularity-repair / re-roll option. Girth lives on as a user-facing "minimum degrees of
separation" knob (`mind`), but ASPL is the quantity actually optimized.

---

*Note on references: bibliographic details above were verified against public sources where
possible. A few foundational entries (Petersen 1891, Tutte 1947, Erdős–Sachs 1963, Milo 2003)
are given from standard attribution and should be confirmed against the primary source before
formal publication.*

---

## 10. Acknowledgments

This project stands on freely-shared prior work, and one debt is primary:

**Markus Meringer** (Universität Bayreuth) created **GENREG** and has kept its source code,
executables, and manuals freely available on his university page for over two decades
(1997–2024). The project's original girth-first generator (`genreg_via_cycles`) is a port of
that work, and GENREG remains the reference generator for regular graphs. Per Meringer's own
request, work building on GENREG cites:

> M. Meringer, "Fast Generation of Regular Graphs and Construction of Cages,"
> *Journal of Graph Theory* 30 (1999), 137–146.

Thanks are also due to the broader lineage documented above — **Gunnar Brinkmann** and the
Ghent group (cubic-graph generation, House of Graphs), the **Graph Golf / NII** organizers
(for formalizing the order/degree objective and its ASPL metric), and the authors of the
foundational results in §§1, 4, 7 — whose openly-published methods made this exploration
possible.
