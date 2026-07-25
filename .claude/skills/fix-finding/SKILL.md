---
name: fix-finding
description: Apply a confirmed review finding without creating the next one. Use when fixing any finding from the adversarial-review workflow. Enforces invariant-first, subtraction-only, and the mechanical YAGNI test.
---

# Fixing a finding without creating the next one

The measured problem this exists for: in the one review loop we instrumented end-to-end, roughly
two-thirds of late findings pointed at code the loop's own fixes had introduced, and rounds 13–16
found nothing else at all. There was no skill governing *fixing* — the discipline lived in one
agent's head, which is exactly where it failed.

Work in this order. Steps 1–3 are **gates**: satisfy them mechanically, do not merely intend them.

## 1. Write the failing invariant test FIRST

From the finding's `invariant` field, before touching the fix.

- The test must **fail against the current code** and you must have *seen it fail*. Run it. A guard
  test that was never observed red is not evidence of anything.
- If the finding is `caseOnly`, derive an invariant if you can, or state plainly why none exists.
  Do not invent one to make the finding look gating.

Why first, and why mechanically: on a matched comparison of 120 real bugs, writing the test first
produced a test that genuinely captured the bug ~20% more often than writing it after the fix — and
the authors named the mechanism, which is that an agent that has already written the fix writes a
test that passes on *that fix* rather than one that catches the bug. Compliance with a prompted
ordering instruction measured ~79%, and 77% of the failures were the agent **deleting its own guard
test before submitting**. So this is a gate, not an instruction.

## 2. Author the test from the FINDING, not from your fix

The test must be derivable from the finding text alone. If it only passes because of *how* you
chose to fix it, it is a case-lock, not a guard.

This is the one rule three adversarial reviewers killed an earlier version of this document over.
"A fix is done when it satisfies its own test-upgrade" is tautological: the test and the fix come
from the same author's imagination. The program-repair literature has the industrial-scale version
— patches trained on specification-derived tests generalised well while patches trained on
implementation-derived tests did not, and in one canonical study a repair tool's harness ran the
developer's checker *using the patched binary itself*, so the patch could influence its own verdict.
Do not rebuild that.

## 3. Subtraction precedence

Prefer, strictly in this order:

1. **delete a code path**
2. **tighten a boundary check**
3. **unify two call sites**
4. *then, and only then,* add code

Adding an abstraction requires an **existing caller**. This ordering is load-bearing: without it,
"fix the theme" (which pushes toward broad diffs) and "don't over-build" (which pushes toward small
ones) contradict each other, and a fix can claim compliance either way.

## 4. Mechanical YAGNI

Before adding any seam, run the caller test: `grep` for a live reference in the current tree. **No
caller → it is a `deferral`**, recorded in the component's `CLAUDE.md` known-follow-ons, not built.
The measured cost of ignoring this was ~9 findings over 6 rounds spent hardening an extension seam
for a layout mode that was never built, which never paid.

## 5. Close the theme, not the case

Ask explicitly, in writing: **what is the sibling of this input?** The same concern one delimiter,
one boundary, one code path over. Name it before you commit, and either fix it or record why not.

The two longest chains in the measured run were both siblings left open by the first fix: a CSV
formula-injection guard that checked only leading characters (an embedded tab defeated it, and it
escalated to blocking two rounds later), and a reroll no-op detection that handled large `n` but not
small.

## 6. Do not silently delete functionality

Check the diff for behaviour that disappeared rather than got fixed. In the canonical program-repair
study, **104 of 110** plausible-looking patches were semantically equivalent to a single
functionality-deleting edit — deletion is the easiest way to make a test go green. If the fix
removes a behaviour, that must be the *intent*, stated in the commit message, not a side effect.

## 7. Leave no residue

A fix that falsifies a comment, orphans an export, or strands a constant must clean up in the same
commit. Run `npm run lint` at the repo root before committing; the entire hygiene theme of the
measured run was fix residue.

## Before you commit

- [ ] the invariant test exists, is committed, and was **seen failing** before the fix
- [ ] the test is derivable from the finding text alone
- [ ] no abstraction was added without a live caller
- [ ] the sibling case is named, and fixed or explicitly deferred
- [ ] no functionality was silently deleted
- [ ] `npm run lint` and `npm test` are green
- [ ] the fix is reviewed under `fix-review` — which may only shrink it
