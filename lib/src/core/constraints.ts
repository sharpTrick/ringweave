/**
 * Constraint model for buddy-graph generation (port of `constraints.py`).
 *
 *   prohibited (a,b) : a and b must NOT be buddies              [HARD]
 *   required   (a,b) : a and b MUST be buddies                  [HARD]
 *   priors     (a,b) : prefer a and b remain buddies (churn)    [SOFT, toggle HARD]
 *   tags       person -> label, compiled to prohibited/required by a policy
 *
 * Required/prohibited are hard: we sacrifice regularity to satisfy them where
 * possible, and refuse (with a specific reason) only when a graph is genuinely
 * impossible. Priors are soft by default (polish penalty), promotable to hard.
 */

/** Ordered undirected pair [min, max]. */
export function pair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

// JS Set compares by reference, so pairs live as normalized "min,max" keys.
export function pairKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function keyToPair(key: string): [number, number] {
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

export type TagPolicy = "prohibit_same";

/** A person's group label, or null for no group. */
export type Tag = number | string | null;

export class Constraints {
  readonly n: number;
  readonly required = new Set<string>();
  readonly prohibited = new Set<string>();
  readonly priors = new Set<string>();
  priorHard = false;

  constructor(n: number) {
    this.n = n;
  }

  require(a: number, b: number): this {
    this.required.add(pairKey(a, b));
    return this;
  }

  prohibit(a: number, b: number): this {
    this.prohibited.add(pairKey(a, b));
    return this;
  }

  addPrior(a: number, b: number): this {
    this.priors.add(pairKey(a, b));
    return this;
  }

  /**
   * Compile group tags to pair constraints. Policy `prohibit_same`: members of
   * the same group are never buddies (households, teams that shouldn't
   * self-pair). New policies extend the switch without touching callers.
   */
  static fromTags(
    n: number,
    tags: readonly Tag[],
    policy: TagPolicy = "prohibit_same",
  ): Constraints {
    const c = new Constraints(n);
    switch (policy) {
      case "prohibit_same":
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            if (tags[i] !== null && tags[i] === tags[j]) c.prohibit(i, j);
          }
        }
        return c;
      default:
        throw new Error(`unknown tag policy ${String(policy)}`);
    }
  }

  merge(other: Constraints): this {
    for (const k of other.required) this.required.add(k);
    for (const k of other.prohibited) this.prohibited.add(k);
    for (const k of other.priors) this.priors.add(k);
    return this;
  }

  requiredPairs(): [number, number][] {
    return Array.from(this.required, keyToPair);
  }

  prohibitedPairs(): [number, number][] {
    return Array.from(this.prohibited, keyToPair);
  }

  priorPairs(): [number, number][] {
    return Array.from(this.priors, keyToPair);
  }

  requiredDegree(): number[] {
    const d = new Array<number>(this.n).fill(0);
    for (const [a, b] of this.requiredPairs()) {
      d[a] += 1;
      d[b] += 1;
    }
    return d;
  }

  prohibitedDegree(): number[] {
    const d = new Array<number>(this.n).fill(0);
    for (const [a, b] of this.prohibitedPairs()) {
      d[a] += 1;
      d[b] += 1;
    }
    return d;
  }
}

/**
 * Human-readable infeasibility reasons (empty = feasible). These are the cases
 * where NO valid graph exists; everything else is handled by sacrificing
 * regularity. Sorted and deduplicated, mirroring the Python reference.
 */
export function validate(cons: Constraints, k: number): string[] {
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

  for (const key of cons.required) {
    if (cons.prohibited.has(key)) {
      const [a, b] = keyToPair(key);
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
    if (allowed <= 0 && n > 1) {
      errs.push(`person ${v} is prohibited from everyone — they'd have no buddies`);
    }
  }

  return Array.from(new Set(errs)).sort();
}
