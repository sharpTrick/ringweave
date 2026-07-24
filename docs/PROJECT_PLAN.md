# BuddyGraph — Project Plan

> **STATUS (July 2026):** Naming settled — repo/npm package **`ringweave`** (the algorithm
> library), product name **BuddyGraph** (the web app). **M1 is done and merged**: the
> constraint core (constrained-greedy + constraint-preserving polish + up-front `validate` +
> tag compilation) is ported to `lib/src/core` and validated against the Python oracle. **M1b
> (churn benchmark) is done**: the prior-weight sweep (`findings/churn-priors-weight.md`) set
> the honest F9 claim — ~98% of prior buddies preserved at n=30, ~86% at n=60, ~64% at n=120,
> at negligible ASPL cost — and confirmed the default prior weight. An interactive HTML mock
> of the target UI exists in `mock/` (three layouts incl. Focus ego-view); **M2 (next)** turns
> it into the React app wired to the real core.

**Author:** Patrick Sharp (github: sharpTrick) · Plan drafted with Claude (Anthropic), July 2026
**Status of foundations:** core algorithm selected and validated (see findings/FINDINGS.md), TypeScript
constraint core built with 157 passing tests including cross-language parity vs the Python reference.

## 1. Vision

A free, client-side web tool (GitHub Pages) that turns a list of people into a buddy system:
everyone gets an equal number of buddies, and the whole group stays as closely connected as
possible. No accounts, no backend — **the roster never leaves the device.** The graph theory is
invisible by default and delightful when revealed.

## 2. Personas

- **The Organizer** — runs a team, class, church group, mutual-aid pod, or club. Wants fair
  assignments, printable buddy slips, and minimal disruption when the roster changes. Not a
  graph person; trusts the tool because it explains itself.
- **The Explorer** — a member (or the organizer in a curious mood) poking at the graph: who's
  connected to whom, how close is everyone, what happens if someone leaves.
- **The Tinkerer** — imports/exports JSON, feeds in LLM-generated rosters or graphs, adjusts
  algorithm settings, cares about the replay and the math.

## 3. Architecture snapshot

- **Stack:** React 19 + Vite + TypeScript. D3 (d3-force, d3-shape, d3-zoom, d3-transition)
  computes geometry; React renders SVG. At target sizes (n ≤ ~500) SVG is ample.
- **Core:** existing `buddygraph` TS library (framework-agnostic, zero deps). UI never
  reimplements math.
- **Constraint layer (new core work, M1):** two-tier design —
  1. **Label-assignment tier (default):** generate the anonymous optimal graph, then assign
     people to vertices. Label swaps cost *nothing* structurally, so prohibited edges and most
     required edges are satisfied free. Surfaces in the construction replay as a footnote:
     *"names are seated last."*
  2. **Core-aware tier (fallback):** constraint predicates inside greedy's pair selection and
     polish's swap validity, used only when the required-edge pattern cannot embed (e.g., a
     required triangle vs the min-separation floor, or someone's required buddies > k).
  Feasibility is validated up front with plain-language errors ("Alice has 5 required buddies
  but the buddy count is 4").

## 4. Features & user stories

Priority: **P0** = MVP (first public page) · **P1** = fast-follow · **P2** = delight/deferred.

### F1. Roster import — P0
*As an organizer, I paste names (one per line / comma-separated) or drop a .txt/.csv/.json
file, so I can start without learning a format.*
- Accepts paste and file; tolerant parsing (trim, dedupe with warning, blank-line splitting).
- Acceptance: 30 pasted names → 30 nodes; duplicates flagged not silently dropped.

### F2. Generate + settings — P0
*As an organizer, I pick buddies-per-person (default 4) and press one button.*
- Settings drawer: buddy count k, min separation (`mind`, shown as "minimum degrees of
  separation"), polish on/auto/off, seed (advanced).
- Parity/feasibility warnings before run ("15 people × 3 buddies: one person will get 2 or 4").
- Acceptance: n=30, k=4 generates < 1 s; deterministic — same inputs, same result.

### F3. Buddy list output + slips — P0
*As an organizer, I get a per-person list I can copy, print, or export, so distribution takes
one minute.*
- Table view (Name → buddies), copy-all, CSV export, print-friendly "buddy slips" layout.
- Acceptance: slips render one card per person with their buddies; CSV round-trips into F1.

### F4. Graph view — P0
*As anyone, I see the graph: ring layout (the algorithm's shape) and force layout (the
"everyone is close" truth), with an animated toggle.*
- Hover = neighborhood glow (1st order bright, 2nd order dim, rest faded).
- Acceptance: readable at n=100; pan/zoom; layout toggle animates.

### F5. Quality panel — P0
*As a skeptical member, I see plain-language proof: "average 2.3 hops; everyone reachable
within 4." Connection-quality score derived from the Moore gap (e.g., 96%).*
- Acceptance: numbers match core metrics; score explanation on hover/tap.

### F6. Export / import graph — P0/P1
*As a tinkerer, I export everything as versioned JSON and re-import it later (or hand-edit /
LLM-generate it), so the tool has a real API.*
- Schema: `{version, people[], constraints{required[],prohibited[]}, edges[], settings, meta}`.
- P0: export + import of tool-generated files. P1: lenient import of hand-made/LLM files with
  validation report (unknown names, asymmetric edges, degree violations).
- Acceptance: export → clear → import reproduces the identical graph and metrics.

### F7. Constraints — P1 (core work in M1)
*As an organizer, I mark pairs as "must be buddies" or "never buddies" — including via import.*
- UI: pick-two-people rows + import from JSON/CSV; conflicts explained in plain language.
- Tags (household, team, shift) compile to pair constraints (P2 for tag UI; schema supports
  tags from day one).
- Acceptance: all prohibited respected always; required satisfied or a specific, actionable
  infeasibility message (never a silent partial).

### F8. Fuzzy search + node explorer — P1
*As an explorer, I search a name (fuzzy), open their panel, and click through buddies and
buddies-of-buddies like hyperlinks.*
- Panel: buddies (1st), reachable-in-2 (2nd), eccentricity ("at most N hops from anyone").
- Acceptance: "jsmi" finds "John Smith"; every name in the panel is clickable; back stack works.

### F9. Recalculate with minimal disruption — P1 ★flagship
*As an organizer, when Dave joins or Sue leaves, I recalculate while preserving as many
existing buddy pairs as possible, so relationships aren't reset.*
- "Preserve current buddies" toggle → previous edges become soft-required; report shows
  "kept 46 of 50 pairs."
- Needs a small benchmark first: measure preserved-edge fraction vs quality tradeoff (extend
  the Python bench; a mini stress-test like the earlier ones).
- Acceptance: adding 1 person to n=50 preserves ≥ 90% of pairs in typical runs (target to be
  validated by the benchmark, not promised blindly).

### F10. Path finder — P1
*As an explorer, I select two people and see the shortest buddy-chain highlighted.*
- Acceptance: path matches BFS; ties broken deterministically; ESC clears.

### F11. Construction replay — P2 ★signature delight
*As anyone, I press "watch it build": ring forms, chords stitch far sides together, names seat
last (footnote), metrics tick down live.*
- Core already exposes deterministic edge order; replay is a UI concern only.
- Doubles as the repo's marketing GIF.

### F12. What-if resilience — P2
*As an organizer, I click "simulate X leaving" (or "random 10% leave") and watch the group
stay connected — the robustness pass from findings/FINDINGS.md as a live demo.*

### F13. Shareable state — P2
*As an organizer, I share a URL that encodes the graph (compressed in the fragment, so nothing
touches a server), for read-only viewing.*
- Privacy note: names in a URL are a deliberate user action; make that explicit in the UI.

## 5. Non-functional requirements

- **Privacy:** zero network calls with roster data; state in memory (+ optional explicit
  export). The privacy promise is stated on the page.
- **Determinism:** identical inputs+settings ⇒ identical output, always. Seed exposed under
  Advanced.
- **Performance:** n=100 generate+render < 1 s; n=500 usable (< 10 s with progress).
  Generation runs in a Web Worker to keep the UI responsive.
- **Accessibility:** the graph is a *view*, never the only interface — every operation
  (search, explore, export) works from the table/panel UI; keyboard navigable; WCAG AA color
  contrast; reduced-motion respected in replay/transitions.
- **No build-time server dependencies:** static output deployable to GitHub Pages via the
  existing Actions workflow.

## 6. Milestones

- **M0 — churn benchmark (½ day): DONE** (landed as M1b) — `churn_bench.py` measures
  preserved-edge fraction vs. prior weight under roster changes; honest F9 targets set in
  `findings/churn-priors-weight.md`.
- **M1 — constraint core (1–2 days): DONE & merged** — constrained-greedy + constraint-
  preserving polish + up-front feasibility validator + tag compilation in `lib/src/core`, with
  cross-language parity tests. *Gate cleared: UI work on F7/F9 may now proceed.*
- **M2 — MVP app (F1–F6):** scaffold `app/` (Vite+React), worker wiring, ring/force views,
  slips, export/import, quality panel. Flip the Pages workflow live.
- **M3 — exploration (F7, F8, F10):** constraints UI, fuzzy search, node explorer, path
  finder.
- **M4 — flagship & delight (F9, F11, F12, F13):** minimal-disruption recalc, replay,
  what-if, share links.

## 7. Risks & open questions

- **Required-edge embedding limits** (triangles vs `mind`): mitigated by the two-tier design +
  up-front validator; UX copy must explain, not apologize.
- **Determinism vs "give me a different arrangement":** re-roll = visible seed change; keep
  the default seed stable so casual users get reproducibility.
- **Name privacy in share links (F13):** fragment-only encoding + explicit consent copy.
- **Design tool handoff:** mocks via Claude Design (see DESIGN_HANDOFF.md); treat its output
  as direction, not spec — engineering truth stays in this plan.
