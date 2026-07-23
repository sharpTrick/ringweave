# BuddyGraph — Design Handoff Brief

> Naming note: **BuddyGraph** is the product name; the underlying library/repo is **ringweave**. UI copy uses BuddyGraph throughout.

*Prepared for Claude Design (Anthropic Labs). Upload this document, then prompt screen-by-
screen — suggested prompts at the end. Author: Patrick Sharp (github: sharpTrick).*

## 1. What this product is (one paragraph)

BuddyGraph turns a list of people into a buddy system: paste names, choose how many buddies
each person gets (usually 3–4), press Generate. The tool builds a mathematically
well-connected network — everyone has an equal number of buddies, and any two people are only
a couple of "friend of a friend" hops apart. It runs entirely in the browser: **no accounts,
no server, the roster never leaves the device.** The math should be invisible by default and
delightful when revealed.

## 2. Audience & tone

Primary user is a non-technical **organizer** (team lead, teacher, club or mutual-aid
coordinator). Tone: warm, plain-spoken, quietly confident. Explain outcomes in human terms
("everyone can reach everyone within 4 steps") — never jargon-first ("ASPL 2.31"). The math
identity is a *reveal* for curious users, not the front door. Avoid corporate-SaaS sterility
and avoid cutesy overload; think "a well-made public tool," like a good civic website with one
moment of magic (the graph).

## 3. Brand feel / visual direction

- **Metaphor:** a circle of people, stitched together. The ring is the product's honest
  geometry (the algorithm literally starts with a ring) — let the circle be a recurring motif.
- **Mood words:** trustworthy, communal, crafted, a little bit wondrous.
- **Color:** calm base (paper/off-white light mode; deep navy dark mode) with one warm accent
  for people/edges of focus and one cool accent for structure. High contrast, WCAG AA.
- **The graph is the hero.** UI chrome recedes; the visualization gets the space and the
  saturation. Edges glow softly on hover states.
- **Typography:** humanist sans for UI; consider a slightly characterful display face for the
  title only. Numbers (metrics) deserve tabular figures.
- Light + dark both matter (organizers project this on screens).

## 4. Information architecture

Single-page app, three persistent regions:

```
┌────────────────────────────────────────────────────────────┐
│ Header: BuddyGraph · privacy badge ("runs on your device") │
├───────────────┬────────────────────────────────────────────┤
│ LEFT RAIL     │  CANVAS (graph)                            │
│ 1 People      │   - ring layout ⇄ force layout toggle      │
│ 2 Constraints │   - pan/zoom, hover glow                   │
│ 3 Settings    │   - [Generate] is the single hero action   │
│ 4 Results     │                                            │
│   (tabs/steps)│                                            │
├───────────────┴────────────────────────────────────────────┤
│ Footer strip: quality metrics ("avg 2.3 hops · max 4 ·     │
│ connection quality 96%") + Export · Watch it build         │
└────────────────────────────────────────────────────────────┘
```

Mobile: rail collapses to bottom sheet steps (People → Settings → Generate → Results); graph
remains the centerpiece.

## 5. Screens & key states (design each)

### S1. Empty / first-run
- Big friendly paste area: "Paste names, one per line" + file drop (.txt/.csv/.json).
- A tiny animated demo graph (12 nodes) already alive in the canvas so the value is visible
  before any input. CTA: "Try with example names."

### S2. Roster entered, pre-generate
- Names listed with count ("23 people"); duplicate warnings inline, gentle not alarming.
- Settings visible but pre-filled (Buddies per person: 4). One hero button: **Generate**.
- Feasibility notes appear *before* generation ("23 people × 3 buddies: one person will get 2
  or 4 — that's okay").

### S3. Generated — the money screen
- Graph in ring layout, then a designed moment: layout eases into force view (or invites the
  toggle). Hovering a person: their buddies glow bright, buddies-of-buddies dim glow.
- Footer metrics animate counting to their values.
- Right-side or overlay panel: per-person buddy table with Copy / CSV / Print slips.

### S4. Person detail (node explorer)
- Opens from clicking a node or from fuzzy search (search field top of canvas; "jsmi" →
  John Smith).
- Card: name; **Buddies** (chips, clickable); **Two steps away** (chips, clickable); a plain
  sentence: "At most 4 steps from anyone." Breadcrumb/back for hyperlink-style exploration.

### S5. Constraints
- Simple pair rows: [person A] [person B] [Must be buddies ▾ / Never buddies ▾] [×].
- Import constraints from file. Conflicts explained kindly and specifically: "Alice already
  has 4 required buddies — raise buddies-per-person or remove one."

### S6. Recalculate (roster changed)
- Banner when roster differs from generated graph: "Roster changed — recalculate?"
- Toggle: **Preserve current buddies where possible.** Post-run report: "Kept 46 of 50
  existing pairs." This screen is the product's flagship differentiator; make the
  preserved-vs-changed pairs visually explicit (e.g., steady edges vs newly-drawn edges).

### S7. Watch it build (construction replay)
- Full-canvas moment: ring draws itself, then chords stitch far sides together one by one,
  metrics ticking down live; names fade onto nodes at the end with a small footnote caption:
  *"names are seated last."* Playback controls (play/pause/speed). Respect reduced-motion.

### S8. Export / import
- Export: JSON (everything), CSV (buddy lists), printable slips (one card per person: "Your
  buddies: …" — designed to be cut apart or screenshotted individually).
- Import: drop zone accepting previous exports or hand/LLM-made JSON, with a friendly
  validation report state (what was accepted, what was skipped and why).

### S9. Error/edge states (design explicitly)
- Infeasible constraints; odd parity; n too small (< k+1); huge n (progress state with a
  worker running); empty search result.

## 6. Component inventory

Paste/drop input · person chip (clickable, glow states) · pair-constraint row · settings
drawer (k stepper, min-separation slider with plain-language caption, advanced: seed) · hero
Generate button (and its "recalculate" variant) · metric stat block (number + plain sentence)
· quality gauge ("connection quality 96%") · graph canvas (ring/force toggle, zoom controls)
· node detail card · search field with fuzzy dropdown · buddy table · print slip card ·
import validation report · toast/banner.

## 7. The D3 moments (where beauty budget goes)

1. Ring ⇄ force layout transition (animated, ~600ms, eased).
2. Hover neighborhood glow (1st order bright, 2nd order dim, rest 20% opacity).
3. Construction replay (S7).
4. Shortest-path highlight: selecting two people draws the chain between them as a lit route.
5. Metrics count-up on generate.
All motion honors `prefers-reduced-motion` with instant-state fallbacks.

## 8. Accessibility & principles (non-negotiable)

- The graph is a **view, never the only interface**: everything doable from tables/panels;
  full keyboard nav; AA contrast in both themes.
- Privacy line visible, not buried: "Runs entirely on your device. Your roster is never
  uploaded."
- Determinism as UX: same inputs → same result; "different arrangement" is an explicit
  re-roll control, not a surprise.

## 9. Data shapes (so prototypes can use real structures)

```json
{
  "version": 1,
  "people": [{ "id": 0, "name": "Alice" }],
  "constraints": {
    "required": [[0, 4]],
    "prohibited": [[2, 7]]
  },
  "settings": { "buddies": 4, "minSeparation": 5, "polish": "auto", "seed": 12345 },
  "edges": [[0, 3], [0, 9]],
  "metrics": { "aspl": 2.31, "diameter": 4, "quality": 0.96 }
}
```

## 10. Suggested Claude Design prompts (screen-by-screen)

1. "Using the uploaded BuddyGraph brief: design S3, the post-generate screen, desktop, light
   mode. The graph is the hero; footer metrics; buddy table panel."
2. "Same system: S1 empty state with the live demo mini-graph and paste area."
3. "S7 construction replay as 4 storyboard frames: ring forming → chords stitching → metrics
   ticking → names seating (footnote caption)."
4. "S6 recalculate screen showing preserved vs new buddy pairs distinctly."
5. "Mobile bottom-sheet flow: People → Settings → Generate → Results, 4 frames."
6. "Print slip card: one person's buddies, cut-apart friendly, black-and-white printable."

Ask it for a small design-token sheet (colors, type scale, spacing) once a direction feels
right — that sheet is what engineering will consume.
