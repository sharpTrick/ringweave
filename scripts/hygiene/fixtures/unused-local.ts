// Expect: eslint(no-unused-vars)
export function unusedLocal(): number {
  const neverRead = 42;
  return 1;
}
