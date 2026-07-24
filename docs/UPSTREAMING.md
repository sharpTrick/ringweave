# Upstreaming Plan — Where ringweave's Algorithms Could Live

Goal: after the repo is solid, contribute the algorithms (minimal-ASPL near-regular
generation; constrained generation; degree-preserving ASPL polish) to established graph
libraries so they outlive this project. Ordered by recommended sequence.

## 1. graphology (JavaScript/TypeScript) — start here

The de-facto standard JS graph library (powers Sigma.js). Its `graphology-generators`
package has classic/random/social generators but **nothing ASPL-targeted and no constrained
regular generation**. Our code is already TypeScript with zero dependencies, so the port is
mostly adapting to their Graph API. Small, responsive maintainer community; MIT ecosystem;
fastest path to a merged PR and a citable adoption. Propose:
`generators.regular.ringweave(order, degree, options)` plus a
`degreePreservingASPLRefinement` operator.

## 2. NetworkX (Python) — biggest impact, highest bar

The most-used graph library in the world. Has `random_regular_graph` and
`connected_watts_strogatz_graph`, but **no generator that optimizes ASPL/diameter under a
degree budget, and no constrained regular generation**. Our Python reference implementation
already exists (`reference-python/`), so the port cost is API conformance + docs + tests.
NetworkX requires algorithmic contributions to have literature grounding: we can cite the
order/degree problem and Graph Golf (NII), Meringer 1999 for the girth lineage, and our own
benchmark results. BSD-3 license — MIT-authored code contributes cleanly. Expect review
cycles; propose as `networkx.generators.aspl_regular_graph` with the swap-refiner as a
separate function mirroring their `double_edge_swap`.

## 3. rustworkx (Rust with Python bindings) — rising fast

Qiskit's graph library, increasingly adopted for performance-critical work. Has a generators
module and active maintainers courting contributions. A Rust port is more work but the
incremental-distance cache would truly shine there, and the constrained generator would be a
differentiating feature. Apache-2.0. Good second-wave target after the Python reference is
merged (or rejected with feedback) at NetworkX.

## 4. igraph (C core; Python/R interfaces) — high value, higher friction

Ubiquitous in research. Already has degree-preserving rewiring (`rewire` with
`keeping_degseq`), so the conceptual fit for our polish is perfect, and a
minimum-ASPL-regular generator would complement its cage/atlas functions. Friction: C core
implementation, GPL-2+ licensing (fine for us as original authors to contribute, but a
one-way door for that code), and a slower review process. Do this when the algorithms are
already validated publicly elsewhere.

## 5. Honorable mentions

- **SageMath** — deep graph-theory culture (has cage databases); a natural home for the
  girth-lineage angle; GPL; academic review style.
- **JGraphT (Java)** — solid library, generator SPI exists; pursue only on demand.
- **House of Graphs** — not code, but our best-found graphs for specific (n, k) cells could
  be submitted as data, which is its own kind of contribution and citation anchor.

## What to pitch (in one sentence each)

1. **Generator:** near-regular graphs with (near-)minimal average shortest path length for a
   given order and degree — the order/degree problem as a library primitive.
2. **Constrained generator:** the same, with hard required/prohibited edges and soft
   edge-preservation — which, to our knowledge, no mainstream library offers at all. This is
   the more novel contribution and the stronger opening pitch.
3. **Refiner:** degree-preserving edge-swap ASPL minimization (constraint-aware variant
   included) as a standalone operator on any existing graph.

## Sequencing rationale

graphology first because it's our native language and a fast, visible merge; NetworkX second
because it's the impact prize and our benchmark evidence (docs/*.csv, docs/findings/FINDINGS.md) is exactly
the substantiation their process asks for; rustworkx/igraph after, riding the credibility of
the first two. Every PR links back to the ringweave repo and CONCEPT_LINEAGE, which keeps
attribution (including Meringer's) traveling with the code.

*Caveat: library APIs and contribution policies drift — re-check each project's current
contributor guide and generator inventory before opening a PR.*
