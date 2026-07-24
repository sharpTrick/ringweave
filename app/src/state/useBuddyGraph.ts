import { useCallback, useEffect, useRef, useState } from "react";
import { POLISH_MAX_N, viewFromResult, type GraphView, type Settings } from "../model";
import { useGenerationWorker } from "./useGenerationWorker";

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameEdges(a: [number, number][], b: [number, number][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  }
  return true;
}

/**
 * Orchestrates generation: sends a job to the worker and maps its BuddyResult back into
 * a GraphView using the exact roster + settings that produced it (captured in `pending`,
 * so an async result is never paired with a roster that changed underneath it).
 *
 * `onIdenticalReroll` fires when a re-generation on the SAME roster yields a byte-identical
 * graph (a "Different arrangement" that couldn't vary — e.g. a small uniquely-determined or
 * polish-converged graph). This is the robust, post-generation detection the pre-hoc
 * `rerollBlockReason` heuristic can't do, so the UI can explain instead of silently no-op'ing.
 */
export function useBuddyGraph(onIdenticalReroll?: () => void) {
  const gen = useGenerationWorker();
  const genGenerate = gen.generate;
  const genReset = gen.reset;
  const [view, setView] = useState<GraphView | null>(null);
  const viewRef = useRef<GraphView | null>(null);
  viewRef.current = view;
  const onNoop = useRef(onIdenticalReroll);
  onNoop.current = onIdenticalReroll;
  const pending = useRef<{ names: string[]; settings: Settings } | null>(null);
  // consumed: the last worker result we've already turned into a view. Guards against a
  // benign effect re-run (e.g. StrictMode's dev double-invoke) re-applying a still-"done"
  // generation and clobbering a view set directly by loadView (an import).
  const consumed = useRef<unknown>(null);

  useEffect(() => {
    if (gen.status === "done" && gen.result && gen.result !== consumed.current && pending.current) {
      consumed.current = gen.result;
      const next = viewFromResult(pending.current.names, pending.current.settings, gen.result);
      const cur = viewRef.current;
      // A re-generation on the same roster that produced an identical graph is a no-op — keep
      // the current view and notify, rather than swapping in an indistinguishable one.
      if (cur && sameStrings(cur.names, next.names) && sameEdges(cur.edges, next.edges)) {
        onNoop.current?.();
      } else {
        setView(next);
      }
    }
  }, [gen.status, gen.result]);

  const generate = useCallback((names: string[], settings: Settings) => {
    pending.current = { names, settings };
    // Never DISPATCH an explicit polish=on above the core's polish cap: it is O(n·m)/iter
    // and would run for tens of seconds. Downgrade to "auto" (which the core disables at
    // this size anyway), so a hostile imported polish=true can't drive a multi-minute run.
    const polish = settings.polish === true && names.length > POLISH_MAX_N ? "auto" : settings.polish;
    genGenerate({
      n: names.length,
      k: settings.buddies,
      options: {
        minSeparation: settings.minSeparation,
        polish,
        seed: settings.seed,
      },
    });
  }, [genGenerate]);

  const loadView = useCallback((v: GraphView) => {
    // Supersede any in-flight generation: clearing `pending` makes the effect drop a
    // worker result that arrives AFTER this import, and reset() cancels the running
    // computation + clears the "running" status so no stale "Generating…" overlay lingers
    // over the imported graph.
    pending.current = null;
    genReset();
    setView(v);
  }, [genReset]);

  return { view, status: gen.status, error: gen.error, generate, loadView, cancel: genReset };
}
