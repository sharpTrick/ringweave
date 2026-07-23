// Shared malformed-input class (negative / fractional / NaN / Infinity /
// oversized), used by both the unconstrained path (which throws) and the
// constrained path (which refuses). Hoisted here so the class lives in one
// place — see CLAUDE.md's ratchet/anti-sprawl guidance.
export const BAD_N = [-1, 2.5, Number.NaN, Infinity, 5e9];
export const BAD_K = [-1, 2.5, Number.NaN, Infinity];
