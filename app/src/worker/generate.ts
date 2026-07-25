/**
 * The generation worker's body, as a plain function.
 *
 * Split out from `generate.worker.ts` so it can be tested directly: a module
 * worker cannot be instantiated under jsdom, so as long as this logic lived
 * inside `onmessage` the entire request→response mapping — including the error
 * channel, which is the part that matters — was unreachable from the suite. The
 * worker file is now only the wiring that cannot be tested anyway.
 *
 * All math lives in `ringweave`; nothing here reimplements any of it.
 */
import { buildBuddyGraph } from "ringweave";
import type { GenerateRequest, GenerateResponse } from "./protocol";

/**
 * Run one generation request and produce the response to post back.
 *
 * `buildBuddyGraph` THROWS on k<2 / malformed n,k (it has no report channel —
 * see its contract note), so every call is wrapped and the message is returned
 * over the error channel rather than escaping as an unhandled worker error, which
 * the main thread would see only as a bare "error" event with no cause.
 */
export function runGeneration(req: GenerateRequest): GenerateResponse {
  const { id, n, k, options } = req;
  try {
    return { id, ok: true, result: buildBuddyGraph(n, k, options) };
  } catch (err) {
    return { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
