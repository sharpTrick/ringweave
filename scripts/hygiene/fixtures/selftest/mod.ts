// Deliberate violations, one per custom hygiene check. See selftest.mjs.
export const WIDGET_LIMIT = 4242;

/** Refers to `removedHelperFn`, which no longer exists anywhere -> stale-comment-ref. */
export function keep(): number {
  return WIDGET_LIMIT;
}

export const CLASS_NAME = "used-hook";
