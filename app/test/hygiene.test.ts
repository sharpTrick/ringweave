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

  // Class: an exported runtime symbol referenced ONLY within its own file is a dead export left
  // by a refactor (buddyNames after unification; LARGE_ROSTER never consumed). Every exported
  // function/const under app/src must have a consumer in some OTHER file (src or test).
  it("every exported function/const in app/src is referenced outside its own file", () => {
    const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
    const testRoot = fileURLToPath(new URL("../test", import.meta.url));
    const srcFiles = walk(srcRoot).filter((f) => /\.(ts|tsx)$/.test(f));
    const cache = new Map<string, string>();
    const read = (f: string) => cache.get(f) ?? (cache.set(f, readFileSync(f, "utf8")), cache.get(f)!);
    const searchable = [...srcFiles, ...walk(testRoot).filter((f) => /\.(ts|tsx)$/.test(f))];

    const orphans: string[] = [];
    for (const file of srcFiles) {
      const exported = [...read(file).matchAll(/export (?:function|const) (\w+)/g)].map((m) => m[1]);
      for (const name of exported) {
        const ref = new RegExp(`\\b${name}\\b`);
        if (!searchable.some((f) => f !== file && ref.test(read(f)))) orphans.push(`${name} (${file})`);
      }
    }
    expect(orphans).toEqual([]); // un-export (make module-local) or add a consumer
  });
});
