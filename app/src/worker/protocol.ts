import type { BuddyResult } from "ringweave";

/** Generation options mirroring the core's `BuddyOptions` (index.ts). */
export interface GenerateOptions {
  minSeparation?: number;
  polish?: boolean | "auto";
  seed?: number;
  polishIters?: number;
}

/** Main thread → worker. `id` correlates the response and lets stale runs be dropped. */
export interface GenerateRequest {
  id: number;
  n: number;
  k: number;
  options: GenerateOptions;
}

/**
 * Worker → main thread. Success carries the core's `BuddyResult` (structured-clone
 * safe: plain arrays, no `Set`; structured clone also preserves `Infinity`). Failure
 * carries the message from a thrown error — `buildBuddyGraph` throws on k<2 / bad n,k.
 */
export type GenerateResponse =
  | { id: number; ok: true; result: BuddyResult }
  | { id: number; ok: false; error: string };
