import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// Guards against committing machine-specific scratch (a critic's Bash left an app/_g.mjs with a
// hardcoded /home/... path once): no app source/test may embed an absolute filesystem path.
describe("repo hygiene", () => {
  it("no app source or test embeds an absolute /home path", () => {
    const roots = ["../src", "../test"].map((r) => fileURLToPath(new URL(r, import.meta.url)));
    const files = roots.flatMap(walk).filter((f) => /\.(ts|tsx|css|mjs|js)$/.test(f));
    const offenders = files.filter((f) => /["'`]\/(home|Users|root)\//.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  // The dead-export half of this file is now knip's job (`npm run lint` at the repo root). knip
  // was adopted only after being shown to be a strict superset of the regex it replaced: on the
  // two historical orphans this test was written for (`buddyNames`, `LARGE_ROSTER`) it flags both,
  // it likewise ignores an export consumed only by a test — the deliberate allowance the regex
  // made — and it additionally catches `export type`, which `export (?:function|const)` could
  // never see (it found an unused `GenStatus` the moment it was switched on).
});
