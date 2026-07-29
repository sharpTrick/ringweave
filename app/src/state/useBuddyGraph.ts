import { useCallback, useEffect, useRef, useState } from "react";
import { viewFromResult, type GraphView, type Settings } from "../model";
import { autoPolishEnabled } from "ringweave";
import { splitPairs, type ConstraintPair, type NamedPair } from "../constraints";
import { isConstrainedRequest } from "../worker/protocol";
import { useGenerationWorker } from "./useGenerationWorker";

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameEdges(a: [number, number][], b: [number, number][]): boolean {
  return a.length === b.length && a.every((e, i) => e[0] === b[i][0] && e[1] === b[i][1]);
}



/**
 * Orchestrates generation. The roster and settings that produced a job are captured in `pending`,
 * so an async result is never paired with a roster that changed underneath it.
 *
 * `onIdenticalReroll(view)` fires ONLY for an explicit reroll that came back byte-identical, not
 * for a plain Edit→Generate no-op the user never asked to vary.
 */
export function useBuddyGraph(onIdenticalReroll?: (view: GraphView) => void) {
  const gen = useGenerationWorker();
  const genGenerate = gen.generate;
  const genReset = gen.reset;
  const [view, setView] = useState<GraphView | null>(null);
  const viewRef = useRef<GraphView | null>(null);
  viewRef.current = view;
  const onIdenticalRerollRef = useRef(onIdenticalReroll);
  onIdenticalRerollRef.current = onIdenticalReroll;
  const pending = useRef<{
    names: string[];
    settings: Settings;
    constraints: ConstraintPair[];
    rows: NamedPair[];
    reroll: boolean;
  } | null>(null);
  // The last result already turned into a view: without it, a benign effect re-run (StrictMode's
  // double-invoke) re-applies a still-"done" generation over a view set by loadView.
  const consumed = useRef<unknown>(null);

  useEffect(() => {
    if (gen.status === "done" && gen.result && gen.result !== consumed.current && pending.current) {
      consumed.current = gen.result;
      const wasReroll = pending.current.reroll;
      const next = viewFromResult(
        pending.current.names,
        pending.current.settings,
        pending.current.constraints,
        pending.current.rows,
        gen.result,
      );
      const cur = viewRef.current;
      // An identical graph is kept BY REFERENCE, so GraphCanvas sees the same `edges` identity
      // and does not re-lay-out. Settings, constraints and report are still adopted from `next`,
      // unconditionally: they can change while the edges do not, and keeping the old ones exports
      // the wrong rules and shows a stale report.
      if (cur && sameStrings(cur.names, next.names) && sameEdges(cur.edges, next.edges)) {
        setView({
          ...cur,
          settings: next.settings,
          constraints: next.constraints,
          rows: next.rows,
          report: next.report,
        });
        if (wasReroll) onIdenticalRerollRef.current?.(cur);
      } else {
        setView(next);
      }
    }
  }, [gen.status, gen.result]);

  const generate = useCallback((
    names: string[],
    settings: Settings,
    constraints: ConstraintPair[],
    /** The rules AS TYPED — see `GraphView.rows`. */
    rows: NamedPair[],
    opts?: { reroll?: boolean },
  ) => {
    // Never DISPATCH an explicit polish=on where the core would not auto-polish: polish is
    // O(n·m)/iter, so a hostile imported polish=true would drive a multi-minute run. The core is
    // ASKED rather than compared against a mirrored cap, which was k-blind and let it through.
    // `isConstrainedRequest` is the same predicate the worker routes on: the budget picked here
    // is only correct if it agrees with the builder that actually runs.
    const wire = splitPairs(constraints);
    const wouldAutoPolish = autoPolishEnabled(names.length, settings.buddies, {
      constrained: isConstrainedRequest(wire),
    });
    const polish = settings.polish === true && !wouldAutoPolish ? "auto" : settings.polish;
    // Store the DISPATCHED options, not the requested ones: `exportGraph` writes this, so storing
    // a downgraded `polish` as `true` records a configuration that does not reproduce the graph
    // beside it.
    pending.current = {
      names,
      settings: { ...settings, polish },
      constraints,
      rows,
      reroll: opts?.reroll ?? false,
    };
    genGenerate({
      n: names.length,
      k: settings.buddies,
      options: {
        minSeparation: settings.minSeparation,
        polish,
        seed: settings.seed,
      },
      constraints: wire,
    });
  }, [genGenerate]);

  const loadView = useCallback((v: GraphView) => {
    // Supersede any in-flight generation: clearing `pending` makes the effect drop a result that
    // arrives after this import, and reset() clears the "running" status so no stale overlay
    // lingers over the imported graph.
    pending.current = null;
    genReset();
    setView(v);
  }, [genReset]);

  return {
    view,
    status: gen.status,
    error: gen.error,
    refusals: gen.refusals,
    generate,
    loadView,
    cancel: genReset,
  };
}
