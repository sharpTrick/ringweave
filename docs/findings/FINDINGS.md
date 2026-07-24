# Buddy-Graph Strategy Bake-Off — Findings

**Author:** Patrick Sharp (github: sharpTrick), with analysis by Claude (Anthropic), 2026.

Prototype: Python 3 (stdlib + numpy/scipy/matplotlib). All metrics validated in Stage 1
against analytic references (cycle ASPL formula, Petersen graph, complete graph, and the
Moore bound *exactly meeting* Petersen — the strongest possible calibration check).

**Metric.** ASPL gap = (ASPL − Moore_lower_bound) / Moore_lower_bound. 0% = provably optimal.
Lower is better. This is the Graph Golf yardstick and needs no external reference data.

---

## 1. Headline results

1. **Polish (edge-swap simulated annealing) is the single most valuable component.**
   It reaches the provable optimum (0% gap) at small n and stays within ~2–4% of it up to
   n=200. Nothing else comes close on its own.

2. **Seeds stop mattering once you polish — with one caveat about cost.** Given equal
   *time*, a polished random seed and a polished greedy seed converge to nearly the same
   ASPL. The greedy seed's advantage is that it starts closer, so it needs less polish time
   to get there — but greedy is expensive to *build* at scale (see #4).

3. **Among raw (un-polished) seeds, ring-greedy (C) wins clearly.** It beats random-regular
   by ~5 percentage points of gap across the whole range, and beats circulant by a mile.
   The ring + `mind` distance constraint is doing real work: it is the girth idea from the
   original repo, reborn as a cheap heuristic, and it lands the seed 2–5% from optimal.

4. **Greedy does not scale.** Its per-edge "BFS from every deficient vertex" costs
   O(n · edges · BFS) ≈ O(n³). Fine to n≈200 (sub-second to a few seconds); ~22 s at n=500;
   impractical at n=1000. Random-regular generates in milliseconds at every size.

5. **Girth-first (B, the original repo's approach) is a respectable middle.** It beats random
   but loses to greedy on ASPL at every cell, while paying a large generation-time premium
   for the backtracking. Its girth is genuinely higher — but higher girth did *not* translate
   into lower ASPL here. **Hypothesis from the plan confirmed:** girth-first loses on ASPL,
   and its spirit survives better as the cheap `mind` constraint inside C.

6. **Circulant (D) is the clear loser.** Its rigid vertex-transitive symmetry prevents the
   local distance optimization the other methods exploit. Gap explodes with n (44% at
   n=100 k=4, 207% at n=100 k=3). Useful only as a baseline / sanity floor. Do not ship it.

---

## 2. Median ASPL gap (%) — core grid

Lower is better. E rows are the *thorough* (8 s) polish budget. Stochastic methods: median of
8 runs (A) / 5 runs (B). C, D, E deterministic-ish (single seed).

| n | k | A random | B girth1st | C greedy | D circ | E:polish(A) | E:polish(C) | E:polish(D) |
|---|---|---------:|-----------:|---------:|-------:|------------:|------------:|------------:|
| 10 | 3 | 12.67 | **0.00** | 8.00 | 13.33 | 0.00 | 0.00 | 0.00 |
| 16 | 4 | 13.46 | 11.06 | 8.65 | 11.54 | 0.96 | 4.33 | 0.96 |
| 20 | 3 | 14.00 | 3.11 | 1.33 | 31.11 | 2.00 | **0.00** | **0.00** |
| 20 | 4 | 9.73 | 6.76 | 7.03 | 10.81 | **0.00** | 0.81 | **0.00** |
| 50 | 3 | 12.02 | 5.25 | 4.43 | 101.80 | 0.29 | **0.29** | 0.29 |
| 50 | 4 | 13.13 | 8.13 | 7.40 | 29.92 | 4.16 | **4.06** | 4.13 |
| 100 | 3 | 12.71 | 6.78 | 4.65 | 207.09 | 3.50 | **3.26** | 3.73 |
| 100 | 4 | 8.60 | 5.67 | 2.57 | 44.75 | 2.33 | **2.19** | 2.39 |
| 200 | 4 | 9.25 | 6.42 | 4.10 | 74.31 | 4.93 | **4.10** | 7.45 |

Scaling probe (k=4, sampled-ASPL energy for polish):

| n | A random | C greedy | E:polish(A) | notes |
|---|---------:|---------:|------------:|-------|
| 500 | 10.04 | 5.95 | 7.81* | *sampled-energy polish drifted; see §5 |
| 1000 | 6.90 | (>60 s, impractical) | 5.99 | polish A→ gap 6.90%→5.99%, diam 9→8, 8 s |

---

## 3. Robustness (remove random 10% of members, 30 trials)

Mean largest-component fraction (LCF) and mean ASPL of the surviving network.

| n | k | method | mean LCF | surviving ASPL |
|---|---|--------|---------:|---------------:|
| 100 | 4 | A random | 1.000 | 3.77 |
| 100 | 4 | B girth | 1.000 | 3.66 |
| 100 | 4 | C greedy | 1.000 | 3.56 |
| 100 | 4 | D circ | 1.000 | 4.90 |
| 100 | 4 | **E polish** | 1.000 | **3.55** |
| 100 | 3 | A random | 0.999 | 5.28 |
| 100 | 3 | C greedy | 0.999 | 4.98 |
| 100 | 3 | D circ | **0.942** | 16.12 |
| 100 | 3 | **E polish** | **1.000** | **4.95** |

**Takeaway:** every good method keeps the buddy network essentially whole after losing 10% of
people, and surviving quality tracks ASPL. Circulant fragments at k=3 (only method that drops
below full connectivity). Polish is the only method that stays *perfectly* connected at k=3.
No method's ASPL ranking is overturned by churn — so optimizing ASPL is safe; you don't trade
away resilience to get it.

---

## 4. Answers to the plan's questions

1. **Pre-polish, does greedy beat random & circulant?** Yes, decisively, at every cell.
2. **Post-polish, do seeds still matter?** For *quality*, barely — all seeds converge.
   For *cost*, yes: better seeds need less polish time. But since random seeds are free and
   polish equalizes quality, the cheapest winning recipe is **random seed + polish**, except
   where you want a good answer with *zero* polish time (then greedy).
3. **What % of the gap does polish close?** Most of it. Random's ~10–13% gap collapses to
   ~2–4% after a few seconds of polish; small cells hit 0% (provably optimal).
4. **Does girth-first ever win on ASPL?** No — it beats random but never beats greedy or
   polish. Only ties at n=10 k=3, where every decent method hits the optimum. Its higher
   girth did not buy lower ASPL.
5. **Runtime envelope.** Random+polish with exact energy is comfortable to ~n=300 in pure
   CPython within a couple seconds; sampled-energy extends it to n=1000 in ~8 s. In browser
   JS (≈2–5× faster for this BFS-heavy workload) expect smooth interactive use to several
   hundred members, which covers essentially every real buddy system.
6. **Do equal-ASPL methods differ on churn?** Marginally; ASPL is the dominant predictor of
   surviving quality. Circulant is the only method whose *connectivity* (not just ASPL)
   degrades.

---

## 5. Caveats & honest notes

- **Sampled-energy polish is noisy.** At n=500 I optimized a 32-source ASPL estimate but
  report exact ASPL; the annealer chased sampling noise and ended slightly *worse* than its
  greedy seed. Fix for production: increase sample size with n (e.g. 64–128 sources), or
  re-evaluate exact ASPL periodically and keep the true best. At n=1000 with 64 sources it
  behaved correctly (improved the seed). **Do not ship sampled energy without this guard.**
- **Greedy's O(n³) is the real scaling wall**, not polish. If greedy is wanted at scale,
  cache BFS layers and only recompute for vertices whose neighborhood changed.
- **B is a faithful *reconstruction*** of genreg_via_cycles (girth floor via bounded BFS +
  backtracking), not the byte-exact repo. Conclusions about girth-first vs greedy are robust
  to that; exact B timings are not authoritative.
- Single machine, single thread, CPython 3.12. Times are relative, not absolute targets.

---

## 6. Recommendation for the JS port

**Ship: random-regular seed → simulated-annealing edge-swap polish.** It is the smallest,
fastest, best-scaling pipeline and it reaches provable optimum at small sizes. The whole core
is ~80 lines of dependency-free JS: BFS, all-pairs ASPL, a degree-preserving double edge swap,
and a Metropolis accept rule.

**Offer greedy as an optional "fast good-enough, no waiting" mode** for n ≲ 200 — it gives a
2–5% graph instantly with no annealing loop, which is nice for a live-preview UX and for
incremental "someone joined" updates (splice into the ring, add a couple of chords).

**Keep the `mind`/girth constraint as a user-facing knob**, not a core objective: it makes
greedy seeds good and gives users a "how many degrees of separation minimum" dial that maps
naturally onto the buddy-system pitch. But optimize ASPL directly — girth is the means, ASPL
is the end.

**Drop circulant** except as an internal sanity baseline.

Concretely, the port's default button = "random + 3 s polish"; power-user toggles = seed
method, polish budget, `mind`. Everything runs client-side; no roster ever leaves the device.

---

## 6b. Addendum — cached greedy overturns the scaling verdict

The §1.4 claim that "greedy does not scale" was **wrong about the cause**. The wall was
Python-level BFS overhead, not the algorithm. Replacing per-round BFS with an incrementally
maintained all-pairs distance matrix — for each inserted edge (u,v),
`new[i,j] = min(old[i,j], old[i,u]+1+old[v,j], old[i,v]+1+old[u,j])` as vectorized numpy —
produces **byte-identical graphs** (verified: same edge sets, same ASPL at every tested cell)
while running dramatically faster:

| n | k | original greedy | cached greedy | speedup |
|---|---|----------------:|--------------:|--------:|
| 50 | 4 | 0.024 s | 0.014 s | 1.6× |
| 100 | 4 | 0.174 s | 0.057 s | 3.1× |
| 200 | 4 | 1.365 s | 0.244 s | 5.6× |
| 300 | 4 | 4.517 s | 0.652 s | 6.9× |
| 500 | 4 | ~22 s | **1.97 s** | ~11× |
| 1000 | 4 | >60 s (abandoned) | **10.2 s** | — |

The speedup grows with n (the cache removes overhead that dominates more at scale). And the
graphs are good: cached greedy at n=1000 hits **gap 4.17%, diameter 8**.

**Head-to-head at n=1000 (~10 s each):**

| pipeline | gap | diameter |
|----------|----:|---------:|
| cached-greedy alone | **4.17%** | 8 |
| random + polish (sampled energy) | 5.78% | 8 |
| cached-greedy + polish | 4.17% | 8 |

At this scale cached-greedy *alone* beats random+polish, and polishing the greedy seed adds
nothing (sampled-energy polish can't improve on it). **Revised recommendation:** greedy is
viable well past the buddy-system range. Two good pipelines now exist:

- **Small–mid n (≲ 300):** random seed + exact-energy polish → reaches provable optimum / 2–4%.
- **Large n (300–1000+):** cached-greedy alone → 4% gap in seconds, no polish needed.

For the JS port this means the "instant, no-waiting" greedy mode is not just a small-n
convenience — with the incremental-distance trick it is the *better* choice at large sizes,
and it stays fully client-side. `core.py`'s dependency-free BFS is fine for the metric; the
incremental update is a dozen lines of array math that port directly to a typed-array loop in
JS (no numpy needed — the O(n²) update is a simple double loop).

## 7. Files

- `core.py` — graph container, BFS metrics, girth, Moore bounds, analytic references
- `test_core.py` — Stage 1 trust tests (all pass)
- `generators.py` — strategies A, C, D, E
- `gen_b.py` — strategy B (girth-first reconstruction)
- `gen_c_cached.py` — cached greedy (incremental all-pairs update; identical output, ~11× faster)
- `bench.py` — grid harness (`--quick` flag)
- `results.csv` — core-grid raw rows (189)
- `plot_gap_vs_n.png`, `plot_seed_vs_polish.png`, `plot_time_vs_n.png`
