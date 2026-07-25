// Module worker: runs graph generation off the main thread (NFR §5). It is a thin
// shell around `runGeneration` — the request→response mapping lives in `generate.ts`
// so it is testable without a Worker, and this file holds only the wiring that is not.
import { runGeneration } from "./generate";
import type { GenerateRequest } from "./protocol";

// Bare `onmessage`/`postMessage` globals (not `self.*`) typecheck cleanly under the
// DOM lib and resolve to the worker scope at runtime.
onmessage = (e: MessageEvent<GenerateRequest>) => {
  postMessage(runGeneration(e.data));
};
