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
});
