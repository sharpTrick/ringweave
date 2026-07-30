// Expect: eslint(eqeqeq) — a non-null loose comparison, which the `null: ignore` option must
// NOT exempt. Guards against the exemption being widened to disable the rule outright.
export function looseEq(a: string, b: number): boolean {
  return a == (b as unknown as string);
}
