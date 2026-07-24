import { useCallback, useEffect, useRef, useState } from "react";
import { viewFromResult, type GraphView, type Settings } from "../model";
import { useGenerationWorker } from "./useGenerationWorker";

/**
 * Orchestrates generation: sends a job to the worker and maps its BuddyResult back into
 * a GraphView using the exact roster + settings that produced it (captured in `pending`,
 * so an async result is never paired with a roster that changed underneath it).
 */
export function useBuddyGraph() {
  const gen = useGenerationWorker();
  const genGenerate = gen.generate;
  const [view, setView] = useState<GraphView | null>(null);
  const pending = useRef<{ names: string[]; settings: Settings } | null>(null);
  const consumed = useRef<unknown>(null);

  useEffect(() => {
    if (gen.status === "done" && gen.result && gen.result !== consumed.current && pending.current) {
      consumed.current = gen.result;
      setView(viewFromResult(pending.current.names, pending.current.settings, gen.result));
    }
  }, [gen.status, gen.result]);

  const generate = useCallback((names: string[], settings: Settings) => {
    pending.current = { names, settings };
    genGenerate({
      n: names.length,
      k: settings.buddies,
      options: {
        minSeparation: settings.minSeparation,
        polish: settings.polish,
        seed: settings.seed,
      },
    });
  }, [genGenerate]);

  const loadView = useCallback((v: GraphView) => setView(v), []);

  return { view, status: gen.status, error: gen.error, generate, loadView };
}
