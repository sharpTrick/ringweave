/**
 * Constraint model for buddy-graph generation (port of `constraints.py`).
 *
 *   prohibited (a,b) : a and b must NOT be buddies              [HARD]
 *   required   (a,b) : a and b MUST be buddies                  [HARD]
 *   priors     (a,b) : prefer a and b remain buddies (churn)    [SOFT, toggle HARD]
 *   tags       person -> label, compiled to prohibited/required by a policy
 *
 * Required/prohibited are hard. We sacrifice regularity to satisfy them where
 * possible, and refuse (with a specific reason) only when a graph is genuinely
 * impossible. Priors are soft by default (polish penalty), promotable to hard.
 */
import { MAX_ROSTER } from "./graph.js";
import { MAX_CONSTRAINED_N, MAX_CONSTRAINED_WORK, constrainedWork } from "./budgets.js";

// Normalized "min,max" string keys (a JS `Set` compares objects by reference), held privately so
// an un-normalized key can never reach the legality checks that look pairs up.
function pairKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function keyToPair(key: string): [number, number] {
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

function pairsOf(set: Set<string>): [number, number][] {
  return Array.from(set, keyToPair);
}

function degreeOf(n: number, pairs: [number, number][]): number[] {
  // Guard the allocation, so a `Constraints` built directly with a malformed n gets a clear
  // message rather than a native RangeError.
  if (!Number.isInteger(n) || n < 0 || n > MAX_ROSTER) {
    throw new Error(`roster size ${n} is not a valid count`);
  }
  const d = new Array<number>(n).fill(0);
  for (const [a, b] of pairs) {
    d[a] += 1;
    d[b] += 1;
  }
  return d;
}

export type TagPolicy = "prohibit_same";

/** A person's group label, or null for no group. */
export type Tag = number | string | null;

export class Constraints {
  readonly n: number;
  #required = new Set<string>();
  #prohibited = new Set<string>();
  #priors = new Set<string>();
  // Promotes priors to required — but only `buildConstrainedBuddyGraph` acts on it, so `validate`
  // and the primitives accept inputs the builder would refuse (see `validateDetailed`).
  priorHard = false;

  constructor(n: number) {
    this.n = n;
  }

  require(a: number, b: number): this {
    this.#required.add(pairKey(a, b));
    return this;
  }

  prohibit(a: number, b: number): this {
    this.#prohibited.add(pairKey(a, b));
    return this;
  }

  addPrior(a: number, b: number): this {
    this.#priors.add(pairKey(a, b));
    return this;
  }

  isRequired(a: number, b: number): boolean {
    return this.#required.has(pairKey(a, b));
  }

  isProhibited(a: number, b: number): boolean {
    return this.#prohibited.has(pairKey(a, b));
  }

  get prohibitedCount(): number {
    return this.#prohibited.size;
  }

  get priorCount(): number {
    return this.#priors.size;
  }

  /**
   * Compile group tags to pair constraints. Policy `prohibit_same`: members of
   * the same group are never buddies (households, teams that shouldn't
   * self-pair). Missing/out-of-range tags count as "no group" (never grouped).
   * New policies extend the switch without touching callers.
   */
  static fromTags(
    n: number,
    tags: readonly Tag[],
    policy: TagPolicy = "prohibit_same",
  ): Constraints {
    const c = new Constraints(n);
    // `?? null` and not a length check: a hole or an explicit `undefined` compares equal to every
    // other, which would prohibit every pair of UNGROUPED people — the inverse of the contract.
    const tagOf = (i: number): Tag => tags[i] ?? null;
    switch (policy) {
      case "prohibit_same":
        for (let i = 0; i < n; i++) {
          const ti = tagOf(i);
          if (ti === null) continue;
          for (let j = i + 1; j < n; j++) {
            if (ti === tagOf(j)) c.prohibit(i, j);
          }
        }
        return c;
      default:
        throw new Error(`unknown tag policy ${String(policy)}`);
    }
  }

  merge(other: Constraints): this {
    // TS-only fail-fast (the Python reference has no size check): a mismatch would otherwise
    // surface as an out-of-range pair at a much later call site.
    if (other.n !== this.n) {
      throw new Error(`cannot merge constraints for ${other.n} people into ${this.n}`);
    }
    for (const key of other.#required) this.#required.add(key);
    for (const key of other.#prohibited) this.#prohibited.add(key);
    for (const key of other.#priors) this.#priors.add(key);
    this.priorHard ||= other.priorHard;
    return this;
  }

  requiredPairs(): [number, number][] {
    return pairsOf(this.#required);
  }

  prohibitedPairs(): [number, number][] {
    return pairsOf(this.#prohibited);
  }

  priorPairs(): [number, number][] {
    return pairsOf(this.#priors);
  }

  requiredDegree(): number[] {
    return degreeOf(this.n, this.requiredPairs());
  }

  prohibitedDegree(): number[] {
    return degreeOf(this.n, this.prohibitedPairs());
  }
}

/**
 * A machine-readable infeasibility reason; people are named as roster indices, so a caller can
 * substitute names without parsing prose.
 *
 * `person` on `unknown-person` may be out of range, non-integer or NaN — that IS what is being
 * reported, so a formatter must show the raw value rather than index a roster with it.
 */
export type Reason =
  | { code: "roster-invalid"; n: number }
  | { code: "roster-too-large"; n: number; max: number }
  | { code: "unknown-person"; person: number; n: number }
  | { code: "self-pair"; person: number }
  | { code: "too-many-invalid-constraints"; count: number }
  | { code: "roster-too-large-constrained"; n: number; max: number }
  | { code: "buddy-count-invalid"; k: number }
  | { code: "work-too-large"; n: number; k: number }
  | { code: "required-degree-exceeds-k"; person: number; required: number; k: number }
  | { code: "required-and-prohibited"; a: number; b: number }
  | { code: "required-within-prohibited"; person: number }
  | { code: "prohibited-from-everyone"; person: number }
  | { code: "prohibited-splits-group"; person: number };

/**
 * Renders a number as Python spells it ("nan", "inf"), not as JS does ("NaN", "Infinity") — raw
 * interpolation breaks `formatReason`'s byte-identity with the reference on exactly the values
 * these reasons are documented to carry.
 */
function num(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  return String(x);
}

/**
 * The one place a `Reason` becomes prose. These strings must stay byte-identical to
 * `reference-python`'s `format_reason` — the oracle and `constrained.test.ts` both pin them.
 */
export function formatReason(r: Reason): string {
  switch (r.code) {
    case "roster-invalid":
      return `roster size ${num(r.n)} is not a valid count`;
    case "roster-too-large":
      return `roster size ${num(r.n)} exceeds the maximum of ${num(r.max)}`;
    case "unknown-person":
      return `constraint references unknown person ${num(r.person)} (roster has ${num(r.n)})`;
    case "self-pair":
      return `person ${num(r.person)} cannot be paired with themselves`;
    case "too-many-invalid-constraints":
      return `${num(r.count)} constraints are invalid — only some are listed`;
    case "roster-too-large-constrained":
      return `roster size ${num(r.n)} exceeds the constrained maximum of ${num(r.max)} (generation is O(n²))`;
    case "buddy-count-invalid":
      return `buddy count ${num(r.k)} must be a non-negative whole number`;
    case "work-too-large":
      return `roster size ${num(r.n)} with ${num(r.k)} buddies each is too large to generate in reasonable time — reduce the roster size or the buddy count`;
    case "required-degree-exceeds-k":
      return `person ${num(r.person)} has ${num(r.required)} required buddies but each person gets ${num(r.k)}`;
    case "required-and-prohibited":
      return `pair ${num(r.a)}–${num(r.b)} is both required and prohibited`;
    case "required-within-prohibited":
      return `person ${num(r.person)} cannot meet required buddies within their prohibited set`;
    case "prohibited-from-everyone":
      return `person ${num(r.person)} is prohibited from everyone — they'd have no buddies`;
    case "prohibited-splits-group":
      return `prohibited pairs split the group — person ${num(r.person)} can never be connected to everyone`;
  }
}

/** Deduplicate and order by the rendered string, so `validate` sorts identically. */
function normalize(reasons: Reason[]): Reason[] {
  const byText = new Map<string, Reason>();
  for (const r of reasons) {
    const text = formatReason(r);
    if (!byText.has(text)) byText.set(text, r);
  }
  return Array.from(byText.keys())
    .sort()
    .map((text) => byText.get(text) as Reason);
}

/**
 * Structured infeasibility reasons (empty = feasible), sorted and deduplicated by rendered text.
 * These are the cases where NO valid graph exists; everything else is handled by sacrificing
 * regularity. The primary implementation; {@link validate} is its formatter.
 *
 * Does NOT consider `priorHard`: only `buildConstrainedBuddyGraph` promotes priors, and it does
 * so before validating — so this and the primitives accept inputs that entry point refuses.
 */
export function validateDetailed(cons: Constraints, k: number): Reason[] {
  const structural = structuralReasons(cons);
  if (structural.length > 0) return normalize(structural);

  // Refuse before the O(n²) connectivity walk below (rationale in budgets.ts).
  if (cons.n > MAX_CONSTRAINED_N) {
    return [
      { code: "roster-too-large-constrained", n: cons.n, max: MAX_CONSTRAINED_N },
    ];
  }

  if (!Number.isInteger(k) || k < 0) {
    return [{ code: "buddy-count-invalid", k }];
  }

  // Dense k blows generation up past the n-cap (rationale in budgets.ts). Mirrored as a throw in
  // constrainedGreedy's `checkWellFormed` — keep the two in step.
  if (constrainedWork(cons.n, k, cons.prohibitedCount) > MAX_CONSTRAINED_WORK) {
    return [{ code: "work-too-large", n: cons.n, k }];
  }

  const errs: Reason[] = [];
  const n = cons.n;
  const reqd = cons.requiredDegree();
  const prod = cons.prohibitedDegree();

  for (let v = 0; v < n; v++) {
    if (reqd[v] > k) {
      errs.push({ code: "required-degree-exceeds-k", person: v, required: reqd[v], k });
    }
  }

  for (const [a, b] of cons.requiredPairs()) {
    if (cons.isProhibited(a, b)) {
      errs.push({ code: "required-and-prohibited", a, b });
    }
  }

  for (let v = 0; v < n; v++) {
    const allowed = n - 1 - prod[v];
    if (allowed < reqd[v]) {
      errs.push({ code: "required-within-prohibited", person: v });
    }
    if (allowed <= 0 && n > 1 && k > 0) {
      errs.push({ code: "prohibited-from-everyone", person: v });
    }
  }

  // Only prohibition-induced splits are refused. Degree-budget shortfalls are not — they are
  // handled by sacrificing regularity and surface as `report.connected === false`.
  if (k > 0 && n > 1) errs.push(...connectivityReasons(cons));

  return normalize(errs);
}

/**
 * Human-readable infeasibility reasons (empty = feasible). The formatter over
 * {@link validateDetailed}; its strings are the wording contract pinned by the Python reference.
 */
export function validate(cons: Constraints, k: number): string[] {
  return validateDetailed(cons, k).map(formatReason);
}

/**
 * How many distinct structural faults are listed before the rest are summarised. Bounded because
 * an unbounded list ran `validate` — whose contract is to REFUSE, not throw — out of memory on a
 * few million invalid pairs.
 */
const MAX_STRUCTURAL_REASONS = 16;

/**
 * Ill-formed roster size or constraint endpoints (unknown ids, self-pairs). Mirrored as throws in
 * constrainedGreedy's `checkConstraintIds` and in reference-python `_structural_errors`.
 */
function structuralReasons(cons: Constraints): Reason[] {
  let invalid = 0;
  const n = cons.n;
  if (!Number.isInteger(n) || n < 0) {
    return [{ code: "roster-invalid", n }];
  }
  if (n > MAX_ROSTER) {
    // Refuse before any n-sized allocation would overflow — validate must not throw.
    return [{ code: "roster-too-large", n, max: MAX_ROSTER }];
  }

  // Counted always, listed up to the cap, and WHICH ones are listed is the alphabetically
  // smallest DISTINCT messages rather than the first encountered: `Set` iteration is insertion
  // order in TS and hash order in the Python mirror, so "the first 16" would make a refusal's
  // text depend on how the caller built the set and break message parity. ASCII throughout, so
  // both languages sort alike.
  const listed: { text: string; reason: Reason }[] = [];
  const note = (r: Reason) => {
    invalid++;
    const text = formatReason(r);
    if (listed.length === MAX_STRUCTURAL_REASONS && text >= listed[listed.length - 1].text) return;
    let at = 0;
    while (at < listed.length && listed[at].text < text) at++;
    if (listed[at]?.text === text) return;
    listed.splice(at, 0, { text, reason: r });
    if (listed.length > MAX_STRUCTURAL_REASONS) listed.pop();
  };
  const scan = (pairs: [number, number][]) => {
    for (const [a, b] of pairs) {
      for (const x of [a, b]) {
        if (!Number.isInteger(x) || x < 0 || x >= n) {
          note({ code: "unknown-person", person: x, n });
        }
      }
      if (a === b) note({ code: "self-pair", person: a });
    }
  };
  scan(cons.requiredPairs());
  scan(cons.prohibitedPairs());
  scan(cons.priorPairs());
  const errs: Reason[] = listed.map((e) => e.reason);
  if (invalid > errs.length) errs.push({ code: "too-many-invalid-constraints", count: invalid });
  return errs;
}

/**
 * Refuse when the allowed-pairs graph is itself disconnected — no edge selection can then connect
 * everyone. A necessary condition only; degree-budget infeasibility is handled elsewhere.
 */
function connectivityReasons(cons: Constraints): Reason[] {
  // Nothing prohibited ⇒ the allowed graph is complete, so skip the O(n²) walk in the common case.
  if (cons.prohibitedCount === 0) return [];
  const n = cons.n;
  const seen = new Uint8Array(n);
  seen[0] = 1;
  const stack = [0];
  let reached = 1;
  while (stack.length > 0) {
    const u = stack.pop() as number;
    for (let v = 0; v < n; v++) {
      if (!seen[v] && v !== u && !cons.isProhibited(u, v)) {
        seen[v] = 1;
        reached++;
        stack.push(v);
      }
    }
  }
  if (reached === n) return [];
  const stranded = seen.indexOf(0);
  return [{ code: "prohibited-splits-group", person: stranded }];
}
