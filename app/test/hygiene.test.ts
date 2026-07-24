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
  // by a refactor (buddyNames was exported but, after unification, used only by buddyLabel). Every
  // exported function/const in model.ts must have a consumer in some OTHER file.
  it("every exported function/const in model.ts is used outside model.ts", () => {
    const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
    const testRoot = fileURLToPath(new URL("../test", import.meta.url));
    const modelPath = fileURLToPath(new URL("../src/model.ts", import.meta.url));
    const modelSrc = readFileSync(modelPath, "utf8");

    const exported = [...modelSrc.matchAll(/export (?:function|const) (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0); // sanity: the regex found the exports

    const others = [...walk(srcRoot), ...walk(testRoot)]
      .filter((f) => /\.(ts|tsx)$/.test(f) && f !== modelPath)
      .map((f) => readFileSync(f, "utf8"));

    const orphans = exported.filter((name) => {
      const ref = new RegExp(`\\b${name}\\b`);
      return !others.some((body) => ref.test(body));
    });
    expect(orphans).toEqual([]); // un-export (make module-local) or add a consumer
  });
});
