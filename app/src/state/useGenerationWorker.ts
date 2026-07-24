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
 * Owns the generation worker. StrictMode-safe: the worker is created in an effect and
 * terminated in cleanup, so React 19's dev double-mount tears the first worker down
 * cleanly. Responses are correlated by an incrementing `id`; a response whose id is not
 * the latest is a stale run and is ignored (so a fast re-generate/re-roll wins).
 */
export function useGenerationWorker() {
  const workerRef = useRef<Worker | null>(null);
  const latestId = useRef(0);
  const [state, setState] = useState<GenState>({ status: "idle", result: null, error: null });

  useEffect(() => {
    const worker = new Worker(new URL("../worker/generate.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<GenerateResponse>) => {
      const msg = e.data;
      if (msg.id !== latestId.current) return; // stale run — a newer request superseded it
      if (msg.ok) setState({ status: "done", result: msg.result, error: null });
      else setState({ status: "error", result: null, error: msg.error });
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const generate = useCallback((args: GenerateArgs) => {
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++latestId.current;
    setState({ status: "running", result: null, error: null });
    const req: GenerateRequest = { id, n: args.n, k: args.k, options: args.options ?? {} };
    worker.postMessage(req);
  }, []);

  return { ...state, generate };
}
