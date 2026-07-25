/**
 * Shared test helpers.
 *
 * `generateResult` routes through the worker's own `runGeneration` rather than
 * calling `buildBuddyGraph` and hand-shaping the payload: the normalization from
 * a core result to the protocol's `GraphResult` is real logic, and a test that
 * bypasses it would keep passing if that normalization broke.
 */
import { runGeneration } from "../src/worker/generate";
import type { GenerateOptions, GenerateRequest, GraphResult } from "../src/worker/protocol";

const NO_CONSTRAINTS: GenerateRequest["constraints"] = { required: [], prohibited: [] };

/** Generate through the real worker body, failing loudly on error or refusal. */
export function generateResult(
  n: number,
  k: number,
  options: GenerateOptions = {},
  constraints: GenerateRequest["constraints"] = NO_CONSTRAINTS,
): GraphResult {
  const res = runGeneration({ id: 1, n, k, options, constraints });
  if (res.kind !== "ok") {
    throw new Error(
      `expected a graph, got ${res.kind}: ${res.kind === "error" ? res.error : JSON.stringify(res.refusals)}`,
    );
  }
  return res.result;
}
