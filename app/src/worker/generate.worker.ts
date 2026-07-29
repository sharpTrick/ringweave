// A thin shell only: the request→response mapping lives in `generate.ts` so it is testable
// without a Worker.
import { runGeneration } from "./generate";
import type { GenerateRequest } from "./protocol";

// Bare `onmessage`/`postMessage`, not `self.*`: these typecheck under the DOM lib and resolve to
// the worker scope at runtime.
onmessage = (e: MessageEvent<GenerateRequest>) => {
  postMessage(runGeneration(e.data));
};
