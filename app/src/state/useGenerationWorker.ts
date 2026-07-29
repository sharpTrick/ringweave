import { useCallback, useEffect, useRef, useState } from "react";
import type { Reason } from "ringweave";
import type {
  GenerateOptions,
  GenerateRequest,
  GenerateResponse,
  GraphResult,
} from "../worker/protocol";

type GenStatus = "idle" | "running" | "done" | "error" | "refused";

/**
 * `refused` is a distinct status, not an error: collapsing it into `error` routes a fixable,
 * per-person explanation through copy that reads like a crash.
 */
export interface GenState {
  status: GenStatus;
  result: GraphResult | null;
  error: string | null;
  refusals: Reason[];
}

export interface GenerateArgs {
  n: number;
  k: number;
  options?: GenerateOptions;
  constraints?: GenerateRequest["constraints"];
}

/**
 * Owns the generation worker. StrictMode-safe: created in an effect, terminated in cleanup. A new
 * generate() or reset() TERMINATES an in-flight run and swaps in a fresh worker, so a superseded
 * run cannot monopolize the single worker or leave a false "running" status.
 */
/** The cleared state every transition starts from, so no stale field survives a status change. */
const IDLE: GenState = { status: "idle", result: null, error: null, refusals: [] };

export function useGenerationWorker() {
  const workerRef = useRef<Worker | null>(null);
  const latestId = useRef(0);
  const runningRef = useRef(false);
  const [state, setState] = useState<GenState>(IDLE);

  const attach = useCallback((worker: Worker) => {
    worker.onmessage = (e: MessageEvent<GenerateResponse>) => {
      const msg = e.data;
      if (msg.id !== latestId.current) return;
      runningRef.current = false;
      if (msg.kind === "ok") setState({ ...IDLE, status: "done", result: msg.result });
      else if (msg.kind === "refused") setState({ ...IDLE, status: "refused", refusals: msg.refusals });
      else setState({ ...IDLE, status: "error", error: msg.error });
    };
    // The worker's OWN failure channels: a worker that fails to load or dies mid-run posts no
    // message at all, so without these the hook sits at "running" forever — and `#app` is `inert`
    // while running, which locks the whole UI.
    const fail = (what: string) => {
      runningRef.current = false;
      setState({ ...IDLE, status: "error", error: what });
    };
    worker.onerror = () => fail("Generation failed to start.");
    worker.onmessageerror = () => fail("Generation sent back something unreadable.");
  }, []);

  const swapWorker = useCallback(() => {
    workerRef.current?.terminate();
    const worker = new Worker(new URL("../worker/generate.worker.ts", import.meta.url), {
      type: "module",
    });
    attach(worker);
    workerRef.current = worker;
  }, [attach]);

  useEffect(() => {
    swapWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [swapWorker]);

  /** Cancel any in-flight generation and return to idle (used when an import supersedes it). */
  const reset = useCallback(() => {
    if (runningRef.current) {
      latestId.current++; // drop the in-flight response
      runningRef.current = false;
      swapWorker();
    }
    setState(IDLE);
  }, [swapWorker]);

  const generate = useCallback((args: GenerateArgs) => {
    if (runningRef.current) swapWorker(); // supersede a slow run rather than queue behind it
    const id = ++latestId.current;
    runningRef.current = true;
    setState({ ...IDLE, status: "running" });
    const req: GenerateRequest = {
      id,
      n: args.n,
      k: args.k,
      options: args.options ?? {},
      constraints: args.constraints ?? { required: [], prohibited: [] },
    };
    workerRef.current?.postMessage(req);
  }, [swapWorker]);

  return { ...state, generate, reset };
}
