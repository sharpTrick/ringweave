# Rule-firing fixtures

Deliberate violations. Each file here exists to **be** a lint error, and
`scripts/hygiene/oracle-check.mjs` asserts that the expected rule actually fires on it.

Why this exists: **oxlint silently ignores unknown rule names.** A typo'd or renamed rule in
`.oxlintrc.json` produces no warning and no error — it is indistinguishable from a rule that is
switched on and finding nothing. Since `docs/REVIEW_PROTOCOL.md` puts lint classes *out of scope*
for the adversarial critics, a silently-dead rule would open a gap that nothing is watching.

These files are excluded from the normal lint run via `ignorePatterns` in `.oxlintrc.json`, and
from the build and test suites by living outside `lib/` and `app/`.
