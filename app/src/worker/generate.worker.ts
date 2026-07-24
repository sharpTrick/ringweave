// Module worker: runs graph generation off the main thread (NFR §5). It is a thin
// shell around the core — all math lives in `ringweave`, none is reimplemented here.
// The unconstrained `buildBuddyGraph` THROWS on k<2 / malformed n,k, so every call is
// wrapped and the message is returned over the error channel.
import { buildBuddyGraph } from "ringweave";
import type { GenerateRequest, GenerateResponse } from "./protocol";

// Bare `onmessage`/`postMessage` globals (not `self.*`) typecheck cleanly under the
// DOM lib and resolve to the worker scope at runtime.
onmessage = (e: MessageEvent<GenerateRequest>) => {
  const { id, n, k, options } = e.data;
  let response: GenerateResponse;
  try {
    response = { id, ok: true, result: buildBuddyGraph(n, k, options) };
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  postMessage(response);
};
