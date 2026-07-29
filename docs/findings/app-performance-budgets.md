# BuddyGraph app: front-end performance budgets and input caps

*The measurements behind every cap, every `React.memo` and every size gate in `app/src`. The
source keeps one-line pointers here; this is where the numbers live. Consult it before changing
any of these constants.*

## The one-line lesson

Two failure shapes account for nearly every number below, and neither is bounded by the cap a
reader reaches for first:

- **A cap on a total does not bound a product.** The byte cap bounds bytes, not parse nodes; the
  character cap bounds all the text, not one name; the density cap bounds average degree, not one
  vertex's. Each of those left a factor free, and each free factor was worth two to three orders
  of magnitude — 8 MB of JSON that costs 1,778 ms to parse, a 512 KB file that renders 480 MB of
  DOM text.
- **A cheap computation re-run per interaction is not cheap.** Hover is App-level state; at the
  1000-person ceiling a single hover transition cost ~70 ms in `BuddyList` and ~46 ms in `Slips`
  on top of the canvas's own 168 ms, for a value neither panel reads.

## Scope

This document covers the **app** (`app/src`): render budgets, layout budgets, and the input caps
on the import/parse surface. The **library's** generation and polish budgets are a separate cost
model with their own documents and nothing is duplicated between them:

- [`generation-cost-budgets.md`](./generation-cost-budgets.md) — `greedyWork` / `MAX_GREEDY_WORK`,
  `MAX_REPAIR_WORK`, and all polish budgets.
- [`constrained-generation-cost-and-caps.md`](./constrained-generation-cost-and-caps.md) —
  `MAX_CONSTRAINED_N`, `MAX_CONSTRAINED_WORK`.

Where an app constant is pinned by a library one (the roster ceiling, the auto-polish gate), this
document states the dependency and points there rather than restating the calibration.

## Portability caveat (stated once, applies to every timing below)

Every millisecond figure is wall-clock **on the machine the review round ran on**, and every MB
figure is a heap or DOM-text measurement from the same session. These are **relative magnitudes**,
not portable absolutes. What transfers is the *ratio* and the *shape* — 96 ms vs 1,778 ms for the
same byte count, ~flat cost from 1000 to 4000 edges — not the seconds. This is also why the suite
asserts modelled work rather than elapsed time; see "What the layout tests assert instead" below.

---

## Render budget: the hover path and the memo boundary

`hovered` is App-level state, written on every mouse-enter and mouse-leave over the graph. Before
any memoisation, one hover transition re-rendered every panel, including the two that read neither
`hovered` nor `selected`.

Measured at the import ceiling (n=1000), **per transition, per node crossed**:

| component | cost per hover transition | why it was paid |
|---|---|---|
| `BuddyList` (n rows) | **~70 ms** | re-rendered on App state it does not read |
| `Slips` (n print cards) | **~46 ms** | same |
| `GraphCanvas` | **168 ms** | does read the state; still paid today |
| `neighborhood()` highlight recompute | ~144 set operations | the *smallest* term, not the largest |

**What this justifies.** `BuddyListInner` and `SlipsInner` are `React.memo`, and `App`'s
`setSelected` is a `useCallback` — the memo only pays if `onSelect` is referentially stable, so
the callback is part of the fix, not a tidiness measure. What remains is `GraphCanvas`'s own
168 ms re-render, which is a genuine read of `hovered`; gating that (or moving `hovered` inside
the canvas) is the open follow-on recorded in `app/CLAUDE.md`.

**What would change the conclusion.** Dropping the panels below n=1000 rows — virtualising
`BuddyList`, or not rendering `Slips` until print — retires the ~70/~46 ms terms and with them
the reason for the memos.

### `neighborhood()` stays a bounded adjacency walk, not a BFS

The tempting simplification is one `bfsDistances` pass bucketed on `dist === 1` / `dist === 2`.
It is a pessimisation on this path:

| approach | cost at the n=1000 ceiling |
|---|---|
| bounded adjacency walk (degree ≤ `BUDDY_MAX` = 12) | at most **12² = 144** set operations |
| `bfsDistances`, O(n + m) | **~7,000** operations (n=1000 + m=6000) |

The canvas runs this on **every hover**, so the ~49x gap is paid per transition. This is the one
stated exception to the app's "never reimplement core math" rule, and it is the measurement that
buys the exception. It depends on `degree ≤ BUDDY_MAX` actually holding — which is why import
enforces a **per-vertex** degree gate, not only the average (below).

---

## The roster ceiling: `MAX_ROSTER_N = 1000`, `MAX_IMPORT_N = MAX_ROSTER_N`

`MAX_ROSTER_N` is the largest roster the app will **generate**; the roster parser truncates to it
and feasibility refuses above it. Unconstrained generation cost is set by the library's
`greedyWork = 3·n²·edgesAdded` with `edgesAdded ≈ n·k/2`, i.e. wall-clock tracking **n³·k/2** —
past this ceiling a run takes tens of seconds even off-thread. The library's measured calibration
point is **(1000, 12) at 38.5 s, sitting exactly on `MAX_GREEDY_WORK` = 1.5e10**; the app's
advertised ceiling *is* that calibration point.

> **Correction carried in from the sweep.** The source comment on `MAX_ROSTER_N` described
> generation as "~O(n²·k)". That is one factor of n short of the library's measured shape
> (`3·n²` per edge added, `~n·k/2` edges). The ceiling is unaffected — it was chosen against the
> measurements, not the exponent — but do not re-derive anything from the O(n²·k) form.

**Import is capped to the same ceiling** because import re-measures **synchronously on the main
thread** (`allPairsSummary` + `girth`), with no spinner and no Cancel. Equality with the
generation ceiling does two things: a re-rollable import cannot display more than the app can
generate, and it holds the worst-case synchronous re-measure to a **few hundred ms rather than
over a second**.

### The density cap is a render budget, not a BFS budget

Import additionally refuses `2m > BUDDY_MAX·n`. BFS cost on a dense graph is modest; the binding
costs are the force layout (O(m) per tick) and the SVG (one `<line>` per edge). A near-complete
graph — **K430 ≈ 92,000 edges**, comfortably inside the byte cap — would freeze layout and render
while passing every node-count gate.

### `canGenerate` delegates to the library rather than mirroring its cap

The app's enable/disable decision asks the library instead of re-testing a mirrored constant. The
reason is a zero-margin finding, recorded in full on the library side: **the densest configuration
the app offers sits on `MAX_GREEDY_WORK` by exactly zero margin** — `greedyWork(1000, 12)` is
1.5e10 and the budget is 1.5e10 — and nothing tested that coincidence. One constant edit in either
package (a roster cap of 1001, a buddy cap of 13, a tightened budget) and the button would enable
a configuration the library throws on, surfacing to the user as a raw error string.

### `LARGE_ROSTER = 300` — a preflight warning, not a blocker

Above 300 people, generation is noticeably slow and a near-limit roster can take tens of seconds.
The app warns before the run so the "Generating…" spinner is not a surprise. It does not refuse:
the refusal boundary is the library's, above.

---

## The auto-polish gate is k-dependent, and a flat n was wrong in both directions

`seedCanVary` used to be `POLISH_MAX_N = 120`, an app-side literal mirroring the core's
auto-polish gate. The core's gate is not a flat n — it compares modelled polish work against
`MAX_POLISH_WORK`, so the real cutoff moves with k (146 at k=2, 131 at k=3, 120 at k=4, 78 at
k=12, and different again for the constrained builder). The table and its derivation live in
[`generation-cost-budgets.md`](./generation-cost-budgets.md#the-cutoff-is-k-dependent-so-nobody-may-re-derive-it-as-a-literal);
what follows is only what the mirror cost the app.

120 was correct **only at k=4** — the single value the boundary test pinned — and disagreed in
both directions everywhere else:

- **Too strict at k < 4.** Above n=120 the app refused to dispatch at all, telling the user "this
  group is too large to shuffle" about a roster the core would happily polish into a different
  arrangement.
- **Too lax at k > 4.** The same literal is used to decide whether to dispatch an *explicit*
  `polish: true`. Being k-blind, it dispatched one at **n=100, k=12** — well past the point the
  budget declines — where polish is O(n·m) per iteration and would run for tens of seconds.

**What this justifies.** `seedCanVary` and the generation hook both call the core's
`autoPolishEnabled(n, k, { constrained })` rather than comparing against a mirrored number, and an
explicit `polish: true` the core would not auto-polish is **downgraded to `"auto"`** (which the
core then declines anyway), so a hostile imported `polish: true` cannot drive a multi-minute run.

---

## Constraints editor: DOM node count and per-keystroke allocation

Both figures are taken at the product of the two ceilings — the 1000-person roster and the
200-rule cap (`MAX_CONSTRAINT_PAIRS`).

**Why one shared `<datalist>` and not two `<select>` elements per row.** Two selects per rule row,
each listing the whole roster, is `1000 × 2 × 200 = ` **400,000 option nodes** mounted. One
datalist is mounted once, is shared by every row, and still gives native keyboard autocomplete.

**Why `indexByName` is exported and memoised per render.** `resolvePerson` builds a fresh Map over
the whole roster on every call, and each rule row validates two fields: **400 thousand-entry Maps
per render — 400,000 map insertions — on every keystroke.** `lookup` is one `useMemo`'d index per
render, and `indexByName` is exported so the editor builds it once rather than once per rule row.

**Why `MAX_CONSTRAINT_PAIRS = 200` at all.** Constraint checking is O(pairs) per generation and
the editor renders one row each, but the binding reason is the import surface: pairs arrive from
an untrusted file and feed the core's `validate`, whose prohibited-pair connectivity walk is
**O(n²)**. Bounding the count before any of that runs is what keeps a hostile file cheap to
refuse.

---

## Force layout: two caps and a tick budget

Force settling scales with **both** node and edge count — charge via a quadtree, links per edge,
all multiplied by ticks. Above either cap `forceLayout` falls back to the ring layout.

### `FORCE_MAX_EDGES = ceil(MAX_ROSTER_N · BUDDY_MAX / 2)` = **6000**

Set to the **densest graph the app can itself produce**: generation at k=`BUDDY_MAX` yields
`n·BUDDY_MAX/2` = 6000 edges at n=1000, and import refuses anything above the same
`2m ≤ BUDDY_MAX·n` density. So a max-settings generation keeps its force view instead of silently
rendering as a ring; beyond 6000 is out-of-contract input and the fallback is purely defensive.

The previous cap was **4000**, which silently dropped the densest generatable graph to ring.

Covering the densest in-app graph is affordable because **edge cost is minor next to charge**:
measured **~flat from 1000 to 4000 edges at n=1000**. Raising the edge cap therefore does not buy
back wall-clock in proportion — the tick budget below is what bounds the settle.

### `FORCE_FULL_TICKS = 300`, `FORCE_MIN_TICKS = 40`, `FORCE_TICK_KNEE_N = 120`

The settle is synchronous and **O(n · ticks)**. At a **fixed 300 ticks it reaches ~1.5 s at
n=1000** — a main-thread freeze. Ticks are scaled down past the knee
(`round(300 · 120 / n)`, floored at 40), which holds the wall-clock to **~200 ms at the ceiling**
while graphs at or below n=120 keep the full settle. The scaling is a pure function of n, so the
layout stays deterministic run-to-run, which the determinism contract requires.

`GraphCanvas` also computes the force pass **lazily**, only when the force layout is selected, so
ring-mode use and re-rolls never pay it at all.

### What the layout tests assert instead

The suite asserts the **modelled** settle cost across the in-range band, not elapsed time. An
earlier test asserted `performance.now()` deltas under 700 ms; under concurrent load on a 4-core
container it reported **752 ms and failed**, then passed in isolation seconds later. A timing
assertion in a unit suite says only "this box was fast enough today", and its flake reads exactly
like a regression in whatever change is under review.

The densest-corner test uses a **synthetic 12-regular circulant with the same 6000 edges** rather
than a real generation, because a real k=12 run at n=1000 takes **~30 s** (the library measures
that shape at 38.5 s). The edge count is what the cap boundary is about, so the stand-in pins the
same thing at test speed.

---

## Layout animation: `ANIM_MAX_N = 400`

Above 400 people a layout change **snaps** rather than tweening. This is a cost decision, not a
rendering-quality one: the tween re-renders **every node and every edge on each of ~40 frames**
over a `dur = 650` ms cubic ease, so its cost is the whole-scene render times the frame count —
far more than the one-off settle the layout budgets already bound.

The settle is gated three ways (`FORCE_MAX_N`, `FORCE_MAX_EDGES`, and the tick scaling) and the
interpolation that *consumes* it originally had no size gate at all, so a layout toggle at the
roster ceiling re-rendered the whole scene every frame for 650 ms. Gating the settle and not the
animation bounds the cheaper half.

400 is above any roster where the motion reads as motion rather than as a smear, and below the
1000-person ceiling where it costs the most and helps the least.

---

## Import and parse hardening

Every figure here is the cost of an input that passed **all** the gates that existed before it.

### `MAX_FILE_BYTES = 8_000_000` bounds bytes, not parse cost

Decimal MB, not MiB, so the enforced boundary equals the "8 MB" the rejection message prints
(which formats with `/1e6`).

`JSON.parse` allocates **per node**, and 8 MB buys wildly different node counts. Measured on files
all at exactly the byte limit, synchronously on the main thread, all paid **before** `importGraph`'s
first gate can look at the value (which then rejects in 0 ms):

| file at exactly 8 MB | `JSON.parse` time | heap |
|---|---|---|
| a valid maximum graph (n=1000, m=6000) | **96 ms** | — |
| 3.9M `[` then 3.9M `]` | **1,778 ms** | ~238 MB |
| 800k distinct object keys | **860 ms** | ~611 MB |
| 2M empty objects | **505 ms** | ~517 MB |

Import shows no spinner and offers no Cancel while that runs — the busy overlay is driven by the
generation worker, which import never touches.

### `checkJsonShape`: `MAX_JSON_NODES = 400_000`, `MAX_JSON_DEPTH = 32`

The shape is bounded **before** the parse, by one linear scan of text already in memory: a few ms
against a parse that can cost 1.8 s. `[`, `{`, `,` and `:` are what `JSON.parse` allocates for, so
counting them bounds nodes directly; depth is capped separately because a deep nest is cheap in
characters and expensive in stack.

Calibrated against a real ceiling file: the **valid maximum graph measures ~34,000 structural
characters at depth 4**, so both caps sit an order of magnitude above anything this app can write.
(The same discipline is applied one level up in `App.tsx`'s `handleImportFile`: shape gate first,
because 8 MB of pathological JSON blocks the thread for ~1.8 s and ~238 MB before `importGraph`
gets to reject it in 0 ms.)

### `codePointsIfOver` is bounded at `max + 1`

Callers only need "is it over" and, if so, the first `max` points. The inputs on this surface are
a whole file's worth: materializing every code point of a **9 MB value cost 161 ms and 170 MB** to
then keep 300 characters of it. One extra point answers "over" without reading the rest.

(That 9 MB value is not hypothetical — it is the same object as the 9,288,931-character error
message below, measured at the clamp sink instead of at construction.)

### One name is a product the totals never bounded

`parseRoster`'s two original caps bound only **totals** — all the text (`MAX_PARSE_CHARS`) and how
many names (`MAX_NAMES`) — leaving `(one name's length) × (how many places it is rendered)` free.
`buddyLabel` is called once per person by the on-screen list, the printed slips **and** the CSV
export, so one long name becomes the buddy label of everyone adjacent to it:

| input | result |
|---|---|
| one **480,000-character** name inside a half-megabyte roster file | **480 MB of DOM text**, from a file passing every gate |
| a **512 KB** import file with the same shape | **480 MB of DOM text, ~1 GB RSS** |

**`MAX_NAME_CHARS = 120`** closes it. 120 is far past any real name — the longest verified human
name on record is **~747 characters**, and that is a curiosity rather than a roster entry — and
still bounds the worst case to `MAX_NAMES × (BUDDY_MAX + 1) × MAX_NAME_CHARS` =
1000 × 13 × 120 ≈ **1.6M characters**, a few megabytes. `importGraph` enforces the same per-name
cap on its own path.

### `WARNING_NAME_LIMIT = 10` — a bounded list of bounded strings

`extras` (the duplicate names) is bounded only by `MAX_NAMES - 1` and each entry by
`MAX_NAME_CHARS`, so enumerating all of them produced a **~122 KB warning string** that
`RosterModal` renders as a single DOM text node inside the dialog. A list of bounded strings is
still unbounded; the count needs its own cap.

### `MAX_PARSE_CHARS = 500_000` and `MAX_NAMES = MAX_ROSTER_N`

`MAX_NAMES` matches the generation ceiling and the scan **stops** once that many distinct names
are found, so the common case is O(kept names). The character cap exists for the degenerate
all-duplicates case, where the name cap is never reached and the scan would otherwise read the
whole file.

`RosterModal`'s `capText` bounds the **stored** (and DOM-rendered) string, not just the parse:
without it an 8 MB file load or a huge paste re-renders a multi-megabyte controlled textarea on
**every keystroke**.

### Every error message is bounded at construction, not only at the sink

`ImportError.message` is rendered straight into the DOM as the sole child of the toast, so an
unbounded interpolation turns the whole 8 MB file budget into one text node:

| path | measured message |
|---|---|
| `{"version":"AAAA…"}` with a 7.9M-character version | **7.9-million-character toast** |
| malformed edge endpoint (arbitrary JSON — a 7.9 MB string, or a 1.3M-element array that `${}` stringifies by joining every element) | **9,288,931 characters, 170 MB heap** |
| the over-long-name message | counted a whole 8 MB name to say how far over the limit it was |

Only the clamp at the DOM sink (`useNotice`) kept these off screen. A producer-side bound the
module's own docblock claims to have is not a bound: `quote()` exists so that every interpolation
of untrusted content is clamped where it is built.

### The density gate does not bound per-vertex degree

The density gate compares `2m ≤ BUDDY_MAX·n` — an **average**. A star graph with one hub of degree
n-1 passes it trivially: at n=1000 that is `2·999 ≤ 12·1000`. The hub then becomes the buddy label
of every leaf, which is the **480 MB of DOM text from a 512 KB file** above, and `neighborhood.ts`'s
144-operation bound (which assumes degree ≤ `BUDDY_MAX`) is false on that path.

A star is therefore **refused outright**, not accepted with its derived `buddies` clamped to
`BUDDY_MAX`: a per-vertex degree of 199 is a payload problem, not a settings problem.

---

## Search, explorer and notice caps

**`matchNormalized` (split out of `fuzzyMatch`).** `rankMatches` normalizes the query **once**
instead of once per roster name. The public form did `|query| × 1000` characters of redundant
lowercasing **per keystroke** at the 1000-person ceiling.

**`MAX_QUERY_CHARS = 200`, `ECHO_MAX = 60`.** The search input carries no `maxLength` and `query`
was never capped — unlike the roster textarea, which is pre-capped before it reaches state — so
pasting a multi-megabyte string put the whole thing into a **visible, wrapping element** and laid
it out on the main thread. This was the third DOM sink in the app found to need clamping, after
the notice toast and the import-error quoter.

**`MAX_NOTICE_CHARS = 300`.** The sink clamp on notice text. It is what kept the 7.9M-character
toast and the 9,288,931-character error message off screen while the producer-side bounds were
missing — a backstop, not the primary defence.

**`AUTO_CLEAR_MS = 4000`,** exported because it is the app's **floor** for "long enough to read",
not a detail of `useNotice`. The buddy list's "Copied" confirmation had its own undocumented
**1100 ms** — a quarter of the floor, timed from *after* an awaited clipboard write, with no
dismiss affordance — so the one piece of feedback that action produces was the one most likely to
be missed, and a screen reader could revert the region before announcing it.

The same window also has to be **per press**: each press scheduled its own teardown and none
cancelled the previous, so an earlier press's 4 s timer cleared a later press's confirmation —
press at 0 s, press again at 3 s, and the label reverts at 4.2 s, **1.2 s into a window that
should run to 7 s**.

---

## Caps set by judgement, not by measurement

Recorded so no one goes looking for a benchmark that does not exist. Each is a display or memory
bound with no measured cliff behind it:

| constant | value | basis |
|---|---|---|
| `RESULT_LIMIT` (PersonSearch) | 8 | enough to find someone, short enough to scan |
| `SECOND_LIMIT` (PersonPanel) | 24 | second-degree chips before collapsing to a count |
| `MAX_HISTORY` (explorer) | 50 | every explorer click pushes an entry; unbounded growth over a session. Far more back-steps than anyone retraces, and dropping the oldest is invisible |

---

## Test-suite budgets

**`reroll.test.ts` uses `polishIters: 1500`, not the default budget.** The claim under test is that
the seed reaches the RNG at all, not that a full budget was spent. Two default-budget builds cost
**36 s**; 1500 iterations cost **3 s** and still diverge.

The number is load-bearing and has moved once. At **300** the two seeds converge to the same graph
(the plateau the file's other tests are about), and **1000** stopped diverging once the anneal
calibration began being charged against the loop allowance — up to 100 sweeps that were previously
free. That is the library's budget getting more honest, not a regression; the default-budget
output is byte-identical either way.

---

## Measurements that are not budgets

### The delivered separation is disclosed because the requested one is routinely not met

The Advanced panel showed the number the user **asked** for while the core routinely demotes it,
and nothing disclosed the difference. Measured: **at k=4 the default request of 5 is delivered as
3 at n=12, n=20 and n=30**, and `{minSeparation: 12}` and `{minSeparation: 5}` produce the
identical graph — so the control looked inert and the export recorded a target the graph does not
meet. `separationShortfall` is the disclosure, the sibling of `targetShortfall` for the buddy
count.

**On the constrained path the control is genuinely inert, and a shortfall must not be reported
against it.** The core documents `minSeparation` as accepted-and-ignored there —
`constrainedGreedy` maximises separation rather than aiming at a target. Measured at n=20, k=4
with one rule: `{2}`, `{5}` and `{12}` produce **byte-identical graphs**. Reporting a shortfall
would blame a knob that cannot move: an organizer could lower the setting, watch the message
vanish, and conclude the graph had changed.

(The related export defect — a constrained file still records `settings.minSeparation` — is a
deferral, not a measurement, and is tracked in `app/CLAUDE.md`.)

---

## What would change these conclusions

- **A different machine.** Re-derive from the ratios, not by scaling the seconds.
- **Virtualising `BuddyList` or deferring `Slips` to print.** That retires the ~70 ms / ~46 ms
  hover terms and with them the reason for both memos; `GraphCanvas`'s 168 ms would then be the
  whole hover cost.
- **Moving import's re-measure off the main thread.** `MAX_IMPORT_N`'s equality with
  `MAX_ROSTER_N` exists because the re-measure is synchronous. Route it through the worker and the
  import ceiling can rise above the generation ceiling.
- **An asynchronous or incremental force settle.** The tick scaling exists only because the settle
  is synchronous. Off-thread settling retires `FORCE_FULL_TICKS`/`FORCE_MIN_TICKS`/
  `FORCE_TICK_KNEE_N` together — they are one model in three constants — and would let
  `ANIM_MAX_N` be reconsidered separately.
- **Raising the app's advertised ceiling.** `MAX_ROSTER_N` is pinned from above by the library's
  `MAX_GREEDY_WORK`, which (1000, 12) sits on with **zero margin**. Moving it re-derives both
  packages' constants; see [`generation-cost-budgets.md`](./generation-cost-budgets.md).
- **Any new rendering sink for a name.** `MAX_NAME_CHARS`'s worst case is
  `MAX_NAMES × (BUDDY_MAX + 1) × MAX_NAME_CHARS`; the `(BUDDY_MAX + 1)` factor counts the places a
  name is rendered. A fourth `buddyLabel` consumer changes the product.
