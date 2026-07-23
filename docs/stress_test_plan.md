# Buddy-Graph Strategy Bake-Off — Execution Plan

**Prototype language: Python 3** (stdlib + numpy/scipy optional). The original genreg repo is
already Python, BFS at our scales is fast enough, and the surviving core ports to JS trivially.

## 1. Objective

Determine which generation pipeline produces the best "buddy graphs" — minimize **ASPL**
(primary) and **diameter** (secondary) subject to **degree ≤ k** — at product-relevant sizes,
within time budgets plausible for client-side JS. Quantify the marginal value of a swap-polish
phase, and test whether girth-first generation offers anything over distance-greedy.

## 2. Contenders

| ID | Strategy | Notes |
|----|----------|-------|
| A | Random k-regular | Pairing/configuration model; reject multi-edges, self-loops, disconnected. Baseline. |
| B | genreg_via_cycles | Port user's original Python repo as-is. Choose g: try descending from Moore-bound max girth until a graph is found within a per-attempt timeout (5 s). |
| C | Ring-greedy | Port of the Julia algorithm: Hamiltonian ring, then repeatedly add the chord chosen by lexicographic rule (lowest max endpoint degree → lowest min degree → largest distance → ring-proximity tiebreak), subject to distance ≥ mind and degree < k. Stop when no valid pair remains. |
| D | Circulant search | Ring + chord offsets. k=4: offsets {1, s}, search all s. k=3: ring + n/2 matching (even n). k=5,6: search offset pairs (sample if space is large). Deterministic per offset set. |
| E | Swap polish | Double edge swap (a–b, c–d) → (a–c, b–d) or (a–d, b–c); preserves degrees. Two variants: pure hill-climb (2-opt) and simulated annealing. Applied to seeds from A, C, D. |

Reference points (no code): Moore/ASPL lower bounds for every (n,k); known optima for sanity
cases (Petersen etc.); Graph Golf published bests if reachable online, else skip — the lower
bound gap is the primary yardstick.

## 3. Metrics (record for every produced graph)

- ASPL, and **ASPL gap** = (ASPL − ASPL_lower_bound) / ASPL_lower_bound (Graph Golf's metric)
- Diameter, girth
- Degree min/max (C may end sub-regular — that's allowed; "degree ≤ k" is the constraint)
- Wall-clock time to produce the graph
- Robustness (best graph per method only): remove a random 10% of vertices, 30 trials; report
  mean largest-component fraction and mean ASPL within it. Buddy churn resilience.

ASPL lower bound: standard Moore-style bound — fill distance shells of sizes k, k(k−1), …
from each vertex until n−1 vertices are counted; ASPL_lb = Σ(dist·shell)/(n−1). Diameter lb
is the number of shells needed.

## 4. Parameter grid

- **Core (buddy scale):** n ∈ {20, 50, 100, 200} × k ∈ {3, 4} (skip odd·odd parity violations)
- **Scaling probe:** n ∈ {500, 1000}, k = 4
- **Sanity:** (n=10, k=3) → Petersen territory; (n=16, k=4)

## 5. Fairness protocol

- Two budgets per configuration: **quick = 1 s**, **thorough = 20 s** wall-clock per run
  (calibrate in Stage 3 if needed). Polish runs consume whatever budget remains after seeding.
- Stochastic methods (A, C-with-random-tiebreaks if added, E): 10 seeded runs; report best and
  median. Deterministic (C, D per offset): single run.
- Single thread, same machine, `time.perf_counter()`.

## 6. Implementation notes

- Graph repr: adjacency as `list[set[int]]`. Edge list alongside for swap sampling.
- ASPL/diameter: all-pairs BFS with `collections.deque`; a distance of ∞ anywhere ⇒
  disconnected ⇒ reject/penalize. (Optional: `scipy.sparse.csgraph.shortest_path` if BFS is
  the bottleneck; verify agreement first.)
- Annealer energy: E = ASPL + 10·n·[disconnected]. Track diameter separately; report both.
  Proposal cost = one full ASPL recompute (fine at these scales; n=1000 may need sampled ASPL —
  BFS from √n random sources — flag it if used). Hill-climb: accept iff E strictly drops;
  stop after 200·n consecutive rejects or budget. SA: T₀ = median |ΔE| of 100 random swaps,
  geometric cooling α=0.995 per accepted step, floor T=1e-4·T₀.
- Greedy port details worth preserving from the Julia: farthest-set only (last BFS shell) as
  candidate pool; `mind` default 5 but demote gracefully — if no pair satisfies mind, decrement
  mind rather than stopping (record final mind used).
- Optional C repair step: if greedy halts with degree spread ≥ 2, greedily connect
  lowest-degree vertex pairs at distance ≥ 3. Record with/without.

## 7. Stages

1. **Scaffold + trust.** Graph utils, metrics, lower bounds. Unit tests: cycle Cₙ ASPL matches
   closed form; Petersen (n=10,k=3) gives diameter 2, girth 5, ASPL = 5/3; complete graph
   ASPL = 1; Moore bound sanity vs known cage orders (already encoded in the genreg repo's
   `validate_arguments`).
2. **Generators A–D.** Port B from the repo, C from the Julia listing (drop all plotting; pure
   function: `greedy_ring(n, k, mind) -> adjacency`).
3. **Polish E + calibration dry-run** at (n=50, k=4): confirm budgets are sane, pick
   hill-climb vs SA or keep both if they differ meaningfully (>0.5% gap difference).
4. **Full grid.** Emit `results.csv`: one row per run — method, seed-method, n, k, budget,
   rng-seed, all metrics, time.
5. **Robustness pass** on each method's best graph per (n,k) core cell.
6. **Analysis → `FINDINGS.md`**: summary table (median ASPL gap per method per cell), 2–3
   plots (gap vs n by method at k=4; seed-vs-polished deltas; time vs n), and an explicit
   recommendation for the JS port.

## 8. Questions the results must answer

1. Pre-polish: does ring-greedy (C) beat random-regular (A) and circulant (D)?
2. Post-polish: do seeds still matter, or does E equalize everything given 20 s?
3. What % of the ASPL gap does polish close over greedy alone? (Is annealing worth porting?)
4. Does girth-first (B) ever win on ASPL at equal budget? (Hypothesis: no, but close — and its
   girth/robustness numbers may still argue for the mind-constraint in C.)
5. Runtime envelope: largest n where the recommended pipeline finishes under ~3 s projected in
   browser JS (assume JS ≈ 2–5× faster than pure CPython for this workload).
6. Do methods with equal ASPL differ on the churn-robustness metric?

## 9. Known pitfalls

- B timeouts at ambitious g — always cap per-attempt time and step g down; never let one cell
  eat the grid.
- Parity: skip n·k odd cells; C on odd k leaves ≥1 sub-degree vertex — expected, record it.
- Random-regular rejection loops at k=3, small n — cap retries, fall back to networkx-style
  edge-swap repair if needed.
- Swap proposals that disconnect the graph: detected free by the ∞ distance in the ASPL
  recompute; just reject.
- Don't compare a 10-run-best stochastic result against a single-run deterministic one without
  also showing medians.

## 10. Deliverables

`bench.py` (single entry point, `--stage` flag), `results.csv`, `FINDINGS.md` with the tables,
plots as PNGs, and a short "port this" section naming the winning pipeline and its knobs.
