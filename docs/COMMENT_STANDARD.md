# Comments

The code says *what*. A comment exists only to stop a future contributor doing harm they could not
have foreseen from reading it.

## Keep a comment only if it fits this shape

> **`<the non-obvious fact>` so that `<the consequence of not knowing it>`.**

If the second half is missing, the comment is narration and it goes. If the first half is evident
from the code, the comment is redundant and it goes. If neither half survives contact with the
question *"what would a competent reader do wrong without this?"*, it goes.

Examples that stay, all from this repo:

```ts
// Left armed when nothing is reachable yet, so that a rescue attempted while `#app` is still
// `inert` retries on the commit that lifts it rather than stranding focus for good.

// `childList` only, so that the canvas rewriting attributes every animation frame does not wake
// this.

// Python-first: change reference-python/ and regenerate fixtures before touching this, or the
// oracle silently stops being an oracle.
```

Examples that go, all from this repo:

```ts
// This is the THIRD attempt at that problem and the first one that is not a list of call sites.
// The first two rescued focus at the panels' close buttons, then at the two overlays...

// Review found it where it was always going to be: `RosterModal`'s own `rules` state...

// `??` was not enough, and the reason is the OTHER fix from the same round.
```

A docblock on an exported symbol is a comment like any other: one or two lines saying what a caller
must know to use it correctly. Not a history, not a rationale, not a defence.

## Where the deleted material actually belongs

Nothing in the list below is discarded. Each has a home that is better than a source comment
because it survives refactoring, cannot go stale silently, or is where someone will actually look.

| material | home |
| --- | --- |
| why this change, what was tried, what was rejected | the **commit message** |
| a measurement, a calibration table, a cost model | `docs/findings/` |
| a known limitation or deferred follow-on | the component's `CLAUDE.md` |
| an invariant the code must hold | a **test**, whose name states the claim |
| an argument with a reviewer | the **commit message**, or the review record under `docs/findings/critical-review/` |

The last row is the one that caused the damage. Forty rounds of adversarial review took this
repository's comment-to-code ratio from **0.24** to **0.70**, because each round's fix embedded the
rationale for a rejected alternative in the source so the *next* round would not re-propose it.
That is writing to critics, and it is the wrong instinct twice over:

- **A reviewer's job is to convince you, not yours to pre-empt them.** If a suggestion is weak, or
  right in isolation but outweighed by something else, adjudicate it — say so, decide, and record
  the decision. Do not litigate it in the source.
- **The review ends when the change merges. The comment does not.** A paragraph written to win a
  round in July is read for years by people who were never in the argument.

## Scope

Applies to `lib/`, `app/`, `scripts/` and every test file. Tests are not exempt: a test name is
the right place for the claim, and a paragraph above the test explaining which review round found
it is the same defect in a different file.
