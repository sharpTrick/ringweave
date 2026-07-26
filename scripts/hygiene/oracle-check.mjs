/**
 * Proves the hygiene linter is actually watching what we think it is.
 *
 * `docs/REVIEW_PROTOCOL.md` puts lint classes OUT OF SCOPE for the adversarial critics: a critic
 * that files a stale comment or an unused export is wasting a round, because the linter owns that
 * class. That handoff is only safe if the linter genuinely catches those classes — and oxlint
 * **silently ignores unknown rule names**, so a renamed or mistyped rule in `.oxlintrc.json` looks
 * exactly like a rule that is enabled and finding nothing.
 *
 * So: run oxlint against deliberate violations in `fixtures/` and assert each expected rule fires.
 * If a rule is renamed upstream, removed, or typo'd, this fails loudly instead of quietly opening a
 * gap that neither the linter nor the critics are covering.
 */
import { writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
    // Run from the repo root with no -c so oxlint auto-discovers the real `.oxlintrc.json`: this
    // must test the SHIPPED config — plugins, rule levels and options — not a copy of it.
    // `--no-ignore` is needed because the fixtures are deliberately in `ignorePatterns`.
    return execFileSync("npx", ["oxlint", "--no-ignore", ...paths], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // A non-zero exit is the expected case here — these files are meant to be errors.
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

// The same argument applies to the custom checks in run.mjs, which are hand-written and so can
// silently stop working (two of them already did — a self-referential haystack that made
// stale-comment-ref unable to fire, and colour literals parsed as id selectors). Point them at
// deliberate-violation fixtures and require every check to report.
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
// checked into the repo is by definition tracked. So it gets its own probe: create the exact thing
// it exists to catch, require it to be caught, and remove it again. The finally is load-bearing;
// leaving the probe behind would trip the very check being tested on the next run.
const PROBE = join(REPO_ROOT, "lib", "test", "__oracle_probe__.test.ts");
let probeOutput = "";
writeFileSync(PROBE, "// deliberate untracked file — hygiene oracle probe\n");
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
  rmSync(PROBE, { force: true });
}
if (!probeOutput.includes("untracked-test-file")) {
  console.error(
    "hygiene oracle-check FAILED — untracked-test-file did not fire on an untracked test file.\n" +
      "run.mjs output was:\n" + (probeOutput || "(clean — nothing reported)"),
  );
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
