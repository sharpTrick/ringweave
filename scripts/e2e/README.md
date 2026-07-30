# End-to-end drive

One script that drives the **production build** of the app in a real browser:
real module Worker, real rendering, real keyboard. Not part of `npm test`, and
deliberately not wired into CI — it needs a browser and a served build.

It exists because the unit suite mocks the generation *hook*, so the constrained
generation path, the worker protocol, and every cross-component keyboard
interaction are unreachable from it.

**It has already paid for itself once.** With 244 unit tests, a jsx-a11y linter
and a green typecheck, `Escape` did not clear the route or the selection: the
search box called `stopPropagation` unconditionally, and focus sits in that box
(empty, because choosing a result clears it) right after you pick someone. Every
unit test passed, because each component was correct in isolation. The defect
only existed in the seam.

## Running it

```bash
npm install                                              # root: lint tools + playwright-core
npm --prefix lib run build && npm --prefix app run build
npx --prefix app vite preview --port 4173 --host 127.0.0.1 &

BASE=http://127.0.0.1:4173/ringweave/ npm run e2e
```

`playwright-core` is a root devDependency because this script really does need
it; Chromium itself is already on the box and the script points at it directly,
so no browser download happens. `BASE` must include the base path — the built
app is served under `/ringweave/`.

Exit code is 0 only when every check passes; each line prints PASS/FAIL with the
observed value, so a failure says what it saw rather than just that it differed.
