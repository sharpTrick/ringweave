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
    const tagOf = (i: number): Tag => (i < tags.length ? tags[i] : null);
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
 * Human-readable infeasibility reasons (empty = feasible). These are the cases
 * where NO valid graph exists; everything else is handled by sacrificing
 * regularity. Sorted and deduplicated, mirroring the Python reference.
 */
export function validate(cons: Constraints, k: number): string[] {
  const structural = structuralErrors(cons);
  if (structural.length > 0) return Array.from(new Set(structural)).sort();

  if (!Number.isInteger(k) || k < 0) {
    return [`buddy count ${k} must be a non-negative whole number`];
  }

  const errs: string[] = [];
  const n = cons.n;
  const reqd = cons.requiredDegree();
  const prod = cons.prohibitedDegree();

  for (let v = 0; v < n; v++) {
    if (reqd[v] > k) {
      errs.push(
        `person ${v} has ${reqd[v]} required buddies but each person gets ${k}`,
      );
    }
  }

  for (const [a, b] of cons.requiredPairs()) {
    if (cons.isProhibited(a, b)) {
      errs.push(`pair ${a}–${b} is both required and prohibited`);
    }
  }

  for (let v = 0; v < n; v++) {
    const allowed = n - 1 - prod[v];
    if (allowed < reqd[v]) {
      errs.push(
        `person ${v} cannot meet required buddies within their prohibited set`,
      );
    }
    // only a real problem when people actually need buddies (k > 0)
    if (allowed <= 0 && n > 1 && k > 0) {
      errs.push(`person ${v} is prohibited from everyone — they'd have no buddies`);
    }
  }

  // Connectivity feasibility: if prohibited pairs split the roster so some people
  // can never be linked to the rest (even ignoring degree caps), no connected
  // buddy graph exists. Degree-budget shortfalls are not refused here — they are
  // handled by sacrificing regularity and surface as report.connected === false.
  if (k > 0 && n > 1) errs.push(...connectivityErrors(cons));

  return Array.from(new Set(errs)).sort();
}

/**
 * Ill-formed roster size or constraint endpoints (unknown ids, self-pairs).
 * Mirrored as throws in constrainedGreedy's `checkConstraintIds` for direct
 * callers that skip validate, and in reference-python `_structural_errors`.
 */
function structuralErrors(cons: Constraints): string[] {
  const errs: string[] = [];
  const n = cons.n;
  if (!Number.isInteger(n) || n < 0) {
    return [`roster size ${n} is not a valid count`];
  }
  if (n > MAX_ROSTER) {
    // Refuse before any n-sized allocation would overflow — validate must not throw.
    return [`roster size ${n} exceeds the maximum of ${MAX_ROSTER}`];
  }

  const scan = (pairs: [number, number][]) => {
    for (const [a, b] of pairs) {
      for (const x of [a, b]) {
        if (!Number.isInteger(x) || x < 0 || x >= n) {
          errs.push(`constraint references unknown person ${x} (roster has ${n})`);
        }
      }
      if (a === b) errs.push(`person ${a} cannot be paired with themselves`);
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
function connectivityErrors(cons: Constraints): string[] {
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
  return [
    `prohibited pairs split the group — person ${stranded} can never be connected to everyone`,
  ];
}
