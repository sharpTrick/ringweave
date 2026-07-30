/**
 * Proves the hygiene linter is actually watching what we think it is.
 *
 * oxlint SILENTLY IGNORES unknown rule names, so a renamed or mistyped rule in `.oxlintrc.json`
 * looks exactly like a rule that is enabled and finding nothing — and the review protocol tells the
 * critics not to look there. Every rule is therefore run against a deliberate violation in
 * `fixtures/` and required to fire.
 */
import { writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** fixture file -> the rule that must fire on it, as oxlint prints it: `plugin(rule-name)`. */
const EXPECTED = [
  ["stale-effect-dep.tsx", "react-hooks(exhaustive-deps)"],
  ["inaccessible.tsx", "jsx-a11y(no-aria-hidden-on-focusable)"],
  ["loose-equality.ts", "eslint(eqeqeq)"],
  ["unused-local.ts", "eslint(no-unused-vars)"],
];

const REPO_ROOT = join(HERE, "..", "..");

function lint(paths) {
  try {
    // No `-c`, run from the repo root: this must test the SHIPPED `.oxlintrc.json`, not a copy.
    // `--no-ignore` because the fixtures are deliberately in `ignorePatterns`.
    return execFileSync("npx", ["oxlint", "--no-ignore", ...paths], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // Non-zero exit is the expected case — these fixtures are meant to be errors.
    return `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}

const output = lint(EXPECTED.map(([file]) => join("scripts", "hygiene", "fixtures", file)));
const missing = EXPECTED.filter(([file, rule]) => {
  const line = output.split("\n").find((l) => l.includes(file) && l.includes(rule));
  return !line;
});

if (missing.length > 0) {
  console.error("hygiene oracle-check FAILED — these rules did not fire on their fixtures:\n");
  for (const [file, rule] of missing) console.error(`  ${rule}  (expected on fixtures/${file})`);
  console.error(
    "\nA rule that does not fire is a hole in the lint gate, and the review protocol tells the" +
      "\ncritics not to look there. Fix the rule name in .oxlintrc.json, or if the rule was" +
      "\nremoved upstream, replace it and update the protocol's scope-exclusion list.\n",
  );
  console.error("oxlint output was:\n" + output);
  process.exit(1);
}

// The custom checks in run.mjs are hand-written and can silently stop firing, so they get the same
// treatment: aimed at deliberate-violation fixtures, and every one required to report.
const CUSTOM_CHECKS = ["stale-comment-ref", "dead-css-hook", "mirrored-constant"];
// untracked-test-file is proved separately below — its oracle is git, not a committed fixture.

let selftestOutput = "";
try {
  execFileSync("node", ["scripts/hygiene/run.mjs", "scripts/hygiene/fixtures/selftest"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  selftestOutput = ""; // exit 0 means nothing fired, which is itself the failure
} catch (err) {
  selftestOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`;
}

// `untracked-test-file` cannot be proved by a committed fixture — its oracle is git, and a fixture
// in the repo is by definition tracked. So it gets probes: create the exact thing it exists to
// catch, require it to be caught, remove it. The `finally` is load-bearing; a leftover probe would
// trip the very check being tested on the next run.
//
// TWO probes. The second sits at the repo root, where no test directory can be inferred, so it is
// the whole-tree scan and not a directory list that has to catch it.
const PROBES = [
  join(REPO_ROOT, "lib", "test", "__oracle_probe__.test.ts"),
  join(REPO_ROOT, "__oracle_probe_outside_test_dir__.test.ts"),
];
const probeFailures = [];
for (const probe of PROBES) {
  let probeOutput = "";
  writeFileSync(probe, "// deliberate untracked file — hygiene oracle probe\n");
  try {
    execFileSync("node", ["scripts/hygiene/run.mjs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    probeOutput = ""; // exit 0 means the check did not fire
  } catch (err) {
    probeOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  } finally {
    rmSync(probe, { force: true });
  }
  // Must name THIS probe, not merely fire: without the path assertion the second probe passes on a
  // report about the first.
  const named = probeOutput.includes("untracked-test-file") && probeOutput.includes(basename(probe));
  if (!named) probeFailures.push({ probe, probeOutput });
}
if (probeFailures.length > 0) {
  console.error("hygiene oracle-check FAILED — untracked-test-file did not fire on:\n");
  for (const { probe, probeOutput } of probeFailures) {
    console.error(`  ${relative(REPO_ROOT, probe)}\n      ${probeOutput || "(clean — nothing reported)"}`);
  }
  process.exit(1);
}

const silent = CUSTOM_CHECKS.filter((check) => !selftestOutput.includes(check));
if (silent.length > 0) {
  console.error("hygiene oracle-check FAILED — these custom checks did not fire on their fixtures:\n");
  for (const check of silent) console.error(`  ${check}`);
  console.error("\nrun.mjs output on the self-test fixtures was:\n" + (selftestOutput || "(clean — nothing reported)"));
  process.exit(1);
}

console.log(
  `hygiene oracle-check: ${EXPECTED.length}/${EXPECTED.length} lint rules and ` +
    `${CUSTOM_CHECKS.length + 1}/${CUSTOM_CHECKS.length + 1} custom checks fire as expected`,
);
