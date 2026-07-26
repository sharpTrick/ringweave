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

// Pairs live as normalized "min,max" string keys (JS Set compares by reference).
// The keys are held privately so every stored pair is guaranteed canonical — an
// un-normalized key can never reach the legality checks that look pairs up.
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
  // Guard the allocation so a directly-constructed Constraints with a malformed n
  // (bypassing validate) gets a clear message, not a native RangeError.
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
  // A plain boolean with no canonicalization invariant to protect, so it stays
  // public (unlike the pair sets); toggling it promotes priors to required.
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
    // `?? null` rather than a length check, because the length check was not the
    // whole nullish story: an in-range hole or an explicit `undefined` returned
    // `undefined`, and `undefined === undefined` made every pair of UNGROUPED
    // people compare equal and get prohibited — the exact inverse of the documented
    // "never grouped" contract. The Python reference tests `is not None`, which
    // covers both, so this was a port defect. Subsumes the range branch too.
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
    // TS-only fail-fast (the Python reference has no size check) — a mismatch
    // would otherwise surface as an out-of-range pair at a later call site.
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
 * A machine-readable infeasibility reason. Every variant names the people it
 * concerns as roster **indices**, so a caller with a roster can say "Alice"
 * instead of "person 4" without parsing prose.
 *
 * `person` on `unknown-person` is deliberately typed as a plain number and may be
 * out of range, non-integer or NaN — that IS what is being reported. A formatter
 * with names in hand must not index a roster with it blindly (`names[x]` would
 * render "undefined references unknown person"); `formatReason` shows the raw
 * value, and so should any UI.
 */
export type Reason =
  | { code: "roster-invalid"; n: number }
  | { code: "roster-too-large"; n: number; max: number }
  | { code: "unknown-person"; person: number; n: number }
  | { code: "self-pair"; person: number }
  | { code: "roster-too-large-constrained"; n: number; max: number }
  | { code: "buddy-count-invalid"; k: number }
  | { code: "work-too-large"; n: number; k: number }
  | { code: "required-degree-exceeds-k"; person: number; required: number; k: number }
  | { code: "required-and-prohibited"; a: number; b: number }
  | { code: "required-within-prohibited"; person: number }
  | { code: "prohibited-from-everyone"; person: number }
  | { code: "prohibited-splits-group"; person: number };

/**
 * The one place a `Reason` becomes prose. `validate` is exactly this mapped over
 * `validateDetailed`, so these strings are the authoritative wording and stay
 * byte-identical to the Python reference's.
 */
export function formatReason(r: Reason): string {
  switch (r.code) {
    case "roster-invalid":
      return `roster size ${r.n} is not a valid count`;
    case "roster-too-large":
      return `roster size ${r.n} exceeds the maximum of ${r.max}`;
    case "unknown-person":
      return `constraint references unknown person ${r.person} (roster has ${r.n})`;
    case "self-pair":
      return `person ${r.person} cannot be paired with themselves`;
    case "roster-too-large-constrained":
      return `roster size ${r.n} exceeds the constrained maximum of ${r.max} (generation is O(n²))`;
    case "buddy-count-invalid":
      return `buddy count ${r.k} must be a non-negative whole number`;
    case "work-too-large":
      return `roster size ${r.n} with ${r.k} buddies each is too large to generate in reasonable time — reduce the roster size or the buddy count`;
    case "required-degree-exceeds-k":
      return `person ${r.person} has ${r.required} required buddies but each person gets ${r.k}`;
    case "required-and-prohibited":
      return `pair ${r.a}–${r.b} is both required and prohibited`;
    case "required-within-prohibited":
      return `person ${r.person} cannot meet required buddies within their prohibited set`;
    case "prohibited-from-everyone":
      return `person ${r.person} is prohibited from everyone — they'd have no buddies`;
    case "prohibited-splits-group":
      return `prohibited pairs split the group — person ${r.person} can never be connected to everyone`;
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
 * Structured infeasibility reasons (empty = feasible). These are the cases where
 * NO valid graph exists; everything else is handled by sacrificing regularity.
 * Sorted and deduplicated by rendered text.
 *
 * This is the primary implementation and {@link validate} is its formatter — not
 * the other way round. A UI that needs to name people would otherwise have to
 * parse `validate`'s prose, which is brittle in a specific way: only 6 of the 12
 * messages name a person at all, and two carry an index that is deliberately out
 * of range.
 *
 * No Python mirror is needed: `validate`'s strings are unchanged, so the message
 * parity this module is held to is preserved by construction.
 */
export function validateDetailed(cons: Constraints, k: number): Reason[] {
  const structural = structuralReasons(cons);
  if (structural.length > 0) return normalize(structural);

  // Roster too large for the O(n²) constrained path (rationale on MAX_CONSTRAINED_N
  // in budgets.ts); refuse before the O(n²) connectivity walk and generation.
  if (cons.n > MAX_CONSTRAINED_N) {
    return [
      { code: "roster-too-large-constrained", n: cons.n, max: MAX_CONSTRAINED_N },
    ];
  }

  if (!Number.isInteger(k) || k < 0) {
    return [{ code: "buddy-count-invalid", k }];
  }

  // Dense k blows generation up past the n-cap (rationale on MAX_CONSTRAINED_WORK
  // in budgets.ts); refuse when the estimated work exceeds the budget. Mirrored as a
  // throw in constrainedGreedy's checkWellFormed.
  if (constrainedWork(cons.n, k) > MAX_CONSTRAINED_WORK) {
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
    // only a real problem when people actually need buddies (k > 0)
    if (allowed <= 0 && n > 1 && k > 0) {
      errs.push({ code: "prohibited-from-everyone", person: v });
    }
  }

  // Connectivity feasibility: if prohibited pairs split the roster so some people
  // can never be linked to the rest (even ignoring degree caps), no connected
  // buddy graph exists. Degree-budget shortfalls are not refused here — they are
  // handled by sacrificing regularity and surface as report.connected === false.
  if (k > 0 && n > 1) errs.push(...connectivityReasons(cons));

  return normalize(errs);
}

/**
 * Human-readable infeasibility reasons (empty = feasible), sorted and
 * deduplicated, mirroring the Python reference. The formatter over
 * {@link validateDetailed} — this is the wording contract, and it is what
 * `constrained.test.ts`'s message tests and `reference-python` both pin.
 */
export function validate(cons: Constraints, k: number): string[] {
  return validateDetailed(cons, k).map(formatReason);
}

/**
 * Ill-formed roster size or constraint endpoints (unknown ids, self-pairs).
 * Mirrored as throws in constrainedGreedy's `checkConstraintIds` for direct
 * callers that skip validate, and in reference-python `_structural_errors`.
 */
function structuralReasons(cons: Constraints): Reason[] {
  const errs: Reason[] = [];
  const n = cons.n;
  if (!Number.isInteger(n) || n < 0) {
    return [{ code: "roster-invalid", n }];
  }
  if (n > MAX_ROSTER) {
    // Refuse before any n-sized allocation would overflow — validate must not throw.
    return [{ code: "roster-too-large", n, max: MAX_ROSTER }];
  }

  const scan = (pairs: [number, number][]) => {
    for (const [a, b] of pairs) {
      for (const x of [a, b]) {
        if (!Number.isInteger(x) || x < 0 || x >= n) {
          errs.push({ code: "unknown-person", person: x, n });
        }
      }
      if (a === b) errs.push({ code: "self-pair", person: a });
    }
  };
  scan(cons.requiredPairs());
  scan(cons.prohibitedPairs());
  scan(cons.priorPairs());
  return errs;
}

/**
 * Refuse when the allowed-pairs graph (all non-prohibited pairs) is itself
 * disconnected — then no edge selection can ever connect everyone. A necessary
 * condition only; degree-budget infeasibility is handled elsewhere.
 */
function connectivityReasons(cons: Constraints): Reason[] {
  // With nothing prohibited the allowed graph is complete, hence connected —
  // skip the O(n^2) walk (the common case, and keeps validate cheap at scale).
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
