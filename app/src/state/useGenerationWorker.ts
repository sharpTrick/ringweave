import { useCallback, useEffect, useRef, useState } from "react";
import type { BuddyResult } from "ringweave";
import type { GenerateOptions, GenerateRequest, GenerateResponse } from "../worker/protocol";

export type GenStatus = "idle" | "running" | "done" | "error";

export interface GenState {
  status: GenStatus;
  result: BuddyResult | null;
  error: string | null;
}

export interface GenerateArgs {
  n: number;
  k: number;
  options?: GenerateOptions;
}

/**
 * Owns the generation worker. StrictMode-safe (worker created in an effect, terminated in
 * cleanup). Responses are correlated by an incrementing `id`; a non-latest response is a
 * stale run and is ignored. A new generate() or reset() also TERMINATES an in-flight
 * computation and swaps in a fresh worker, so a slow/superseded run can't monopolize the
 * single worker (blocking the next reroll) or leave a false "running" status.
 */
export function useGenerationWorker() {
  const workerRef = useRef<Worker | null>(null);
  const latestId = useRef(0);
  const runningRef = useRef(false);
  const [state, setState] = useState<GenState>({ status: "idle", result: null, error: null });

  const attach = useCallback((worker: Worker) => {
    worker.onmessage = (e: MessageEvent<GenerateResponse>) => {
      const msg = e.data;
      if (msg.id !== latestId.current) return; // stale run — superseded by a newer request
      runningRef.current = false;
      if (msg.ok) setState({ status: "done", result: msg.result, error: null });
      else setState({ status: "error", result: null, error: msg.error });
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
    setState({ status: "idle", result: null, error: null });
  }, [swapWorker]);

  const generate = useCallback((args: GenerateArgs) => {
    if (runningRef.current) swapWorker(); // supersede a slow in-flight run instead of queueing behind it
    const id = ++latestId.current;
    runningRef.current = true;
    setState({ status: "running", result: null, error: null });
    const req: GenerateRequest = { id, n: args.n, k: args.k, options: args.options ?? {} };
    workerRef.current?.postMessage(req);
  }, [swapWorker]);

  return { ...state, generate, reset };
}
