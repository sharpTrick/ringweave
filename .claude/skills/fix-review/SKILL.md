---
name: fix-review
description: Subtractive-only pre-commit check on a fix diff. Use after applying review fixes, before committing. May only shrink, revert, or add a guard test — never propose new features or abstractions.
---

# Subtractive fix review

**The constraint is the skill.** A fix-review that may propose new work is just another review round
one level down, with the same self-approval bias the whole exercise exists to remove: it generates
findings, which generate fixes, which generate diffs, which need reviewing. An earlier version of
this document proposed exactly that and three adversarial reviewers killed it.

So this pass can only make the diff **smaller**.

## You may return exactly three verdicts

| verdict | meaning |
| --- | --- |
| `revert` | the fix is wrong, or unnecessary — the finding did not require it |
| `shrink` | same behaviour, less surface: delete the abstraction, inline the indirection, drop the unused parameter, collapse the extra branch |
| `add-guard-test` | the invariant test is missing, or weaker than the finding it claims to guard |

Report `{verdict, target, why}` and nothing else. If the diff is already minimal and its guard test
matches the finding, say so and return no verdicts.

## Out of scope by construction

Anything of the form **"also handle X"**, **"while you're here"**, **"this would be cleaner if"**, or
**"consider extracting"** is not a fix-review verdict. File it as a new finding for the next full
round, where it competes with everything else on value instead of riding in on the back of an
unrelated fix.

This is not a stylistic preference. It is the specific mechanism by which a review loop starts
consuming its own output.

## What to actually look at

- **Did the diff grow past its finding?** A one-line boundary bug that produced a new module is the
  signal. `shrink`.
- **Is there a new abstraction with exactly one caller?** `shrink` — and if its only caller is the
  fix itself, `revert` the abstraction and inline it.
- **Does the guard test pass only because of *how* the fix was written?** Then it is a case-lock,
  not a guard: `add-guard-test` with an invariant derivable from the finding text alone.
- **Was the test seen failing before the fix?** If it cannot be shown red against the pre-fix code,
  it is not evidence. `add-guard-test`.
- **Did behaviour disappear?** Deletion is the cheapest way to make a test go green — in the
  canonical program-repair study, 104 of 110 plausible patches were equivalent to a
  functionality-deleting edit. If the removal was not the stated intent, `revert`.
- **Is there residue?** A falsified comment, an orphaned export, a stranded constant. `shrink` —
  though `npm run lint` should have caught most of it first.

## What this pass is not

It is not a correctness review. The critics already did that, on the full surface, with fresh
context. Re-litigating whether the finding was real is out of scope; if you believe it was not, the
verdict is `revert` with a reason, not a new analysis.
