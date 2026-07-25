import { useCallback, useEffect, useRef, useState } from "react";
import type { Reason } from "ringweave";
import type {
  GenerateOptions,
  GenerateRequest,
  GenerateResponse,
  GraphResult,
} from "../worker/protocol";

/** Module-local: `GenState.status` carries it structurally, so nothing outside needs the name. */
type GenStatus = "idle" | "running" | "done" | "error" | "refused";

/**
 * `refused` is a distinct status, not an error: the app worked and the input was
 * well-formed, but the buddy rules admit no graph. Collapsing it into `error`
 * would route a fixable, per-person explanation through copy that reads like a
 * crash.
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
 * Owns the generation worker. StrictMode-safe (worker created in an effect, terminated in
 * cleanup). Responses are correlated by an incrementing `id`; a non-latest response is a
 * stale run and is ignored. A new generate() or reset() also TERMINATES an in-flight
 * computation and swaps in a fresh worker, so a slow/superseded run can't monopolize the
 * single worker (blocking the next reroll) or leave a false "running" status.
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
      if (msg.id !== latestId.current) return; // stale run — superseded by a newer request
      runningRef.current = false;
      if (msg.kind === "ok") setState({ ...IDLE, status: "done", result: msg.result });
      else if (msg.kind === "refused") setState({ ...IDLE, status: "refused", refusals: msg.refusals });
      else setState({ ...IDLE, status: "error", error: msg.error });
    };
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
      swapWorker(); // stop the running computation, fresh worker for next time
    }
    setState(IDLE);
  }, [swapWorker]);

  const generate = useCallback((args: GenerateArgs) => {
    if (runningRef.current) swapWorker(); // supersede a slow in-flight run instead of queueing behind it
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
