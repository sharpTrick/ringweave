/**
 * Apply the pre-registered allocation rule (`PRE-REGISTRATION.md` §Allocation rule) to the admission
 * results. Mechanical on purpose: this script is the only thing that turns the rule into a seed
 * list, so the subset cannot be nudged after seeing which seeds look promising.
 *
 * Usage:  node scripts/sextant/allocate.mjs [--json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = join(ROOT, "docs/findings/critical-review/2026-07-25-sextant/data");
const admission = JSON.parse(readFileSync(join(DATA, "admission.json"), "utf8"));
const defs = JSON.parse(readFileSync(join(ROOT, "scripts/sextant/seed-defs.json"), "utf8"));
const defById = new Map(defs.seeds.map((s) => [s.id, s]));

const admitted = admission.results.filter((r) => r.admitted);
const controls = admitted.filter((r) => r.isControl).sort((a, b) => a.id.localeCompare(b.id));

// Seeds whose gates were deliberately allowed to fail are ORACLE PROBES, not critic-corpus members:
// they test whether the LINTER catches what the critics were told to stop filing. Scoring them
// against the critics would inflate whichever instrument found them.
const probes = admitted.filter((r) => !r.isControl && defById.get(r.id)?.expectGates === false);
const criticSeeds = admitted
  .filter((r) => !r.isControl && defById.get(r.id)?.expectGates !== false)
  .sort((a, b) => a.id.localeCompare(b.id));

const proseSubset = criticSeeds.slice(0, 12);
const homogeneousArm = proseSubset.filter((_s, i) => i % 2 === 0).slice(0, 6);

const enrich = (r) => {
  const d = defById.get(r.id) ?? {};
  return {
    id: r.id,
    worktree: r.worktree,
    // app/src INSIDE the worktree, not the worktree root: the component under review is the app,
    // and the root would invite a critic into lib/ and the tooling — neither the surface under test
    // nor comparable to E1.
    reviewTarget: `${r.worktree}/app/src (the BuddyGraph app)`,
    stratum: r.stratum,
    class: d.class,
    theme: d.theme,
    file: d.file,
    line: d.line,
  };
};

const out = {
  rule: "PRE-REGISTRATION.md §Allocation rule — applied mechanically, no selection-time judgement",
  head: admission.head,
  totals: {
    candidates: admission.results.filter((r) => !r.isControl).length,
    admittedCriticSeeds: criticSeeds.length,
    oracleProbes: probes.length,
    controls: controls.length,
  },
  proseSubset: proseSubset.map(enrich),
  homogeneousArm: homogeneousArm.map(enrich),
  oracleProbes: probes.map(enrich),
  controls: controls.map((r) => ({ id: r.id, worktree: r.worktree, reviewTarget: `${r.worktree}/app/src (the BuddyGraph app)` })),
  powerNote:
    proseSubset.length < 12
      ? `SHORTFALL: only ${proseSubset.length} critic-corpus seeds admitted, against a planned 12. Reported as a power limitation per the pre-registration, not absorbed. A paired exact McNemar test needs >=6 discordant seeds in one direction for p<0.05, which ${proseSubset.length} seeds cannot supply; existence claims and per-seed blind-spot reporting remain valid.`
      : null,
  rejectionReasons: Object.entries(
    admission.results
      .filter((r) => !r.admitted)
      .reduce((acc, r) => {
        const why = !r.gates
          ? (r.reason ?? "unknown")
          : !r.gates.covered
            ? "line-not-covered-by-any-test"
            : !r.gates.tests
              ? "existing-suite-already-catches-it"
              : !r.gates.lint
                ? "linter-already-catches-it"
                : !r.gates.typecheck
                  ? "typecheck-already-catches-it"
                  : "unknown";
        acc[why] = (acc[why] ?? 0) + 1;
        return acc;
      }, {}),
  ).sort((a, b) => b[1] - a[1]),
};

writeFileSync(join(DATA, "allocation.json"), JSON.stringify(out, null, 2) + "\n", "utf8");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`Allocation (pre-registered rule applied to ${out.totals.candidates} candidates)\n`);
  console.log(`  critic-corpus seeds admitted : ${out.totals.admittedCriticSeeds}`);
  console.log(`  oracle probes (linter/a11y)  : ${out.totals.oracleProbes}`);
  console.log(`  clean controls               : ${out.totals.controls}`);
  console.log(`\n  prose subset (${out.proseSubset.length}):`);
  for (const s of out.proseSubset) console.log(`    ${s.worktree}  ${s.id}`);
  console.log(`\n  homogeneous paired arm (${out.homogeneousArm.length}):`);
  for (const s of out.homogeneousArm) console.log(`    ${s.worktree}  ${s.id}`);
  console.log(`\n  why candidates were rejected:`);
  for (const [why, n] of out.rejectionReasons) console.log(`    ${String(n).padStart(3)}  ${why}`);
  if (out.powerNote) console.log(`\n  ${out.powerNote}`);
}
