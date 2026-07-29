import { useCallback, useEffect, useRef, useState } from "react";
import { viewFromResult, type GraphView, type Settings } from "../model";
import { autoPolishEnabled } from "ringweave";
import { splitPairs, type ConstraintPair } from "../constraints";
import { isConstrainedRequest } from "../worker/protocol";
import { useGenerationWorker } from "./useGenerationWorker";

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameEdges(a: [number, number][], b: [number, number][]): boolean {
  return a.length === b.length && a.every((e, i) => e[0] === b[i][0] && e[1] === b[i][1]);
}



/**
 * Orchestrates generation: sends a job to the worker and maps its GraphResult — the normalized builder outcome — back into
 * a GraphView using the exact roster + settings that produced it (captured in `pending`,
 * so an async result is never paired with a roster that changed underneath it).
 *
 * `onIdenticalReroll(view)` fires ONLY when a REROLL (`generate(..., { reroll: true })`) yields a
 * byte-identical graph — a "Different arrangement" that couldn't vary (a small uniquely-determined
 * or polish-converged graph). It is not fired for a plain Edit→Generate no-op, which the user
 * didn't ask to vary. This is the robust, post-generation detection the pre-hoc `rerollBlockReason`
 * heuristic can't do. The kept (unchanged) view is passed so the caller can word the notice from
 * its actual quality rather than overclaiming optimality.
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
    reroll: boolean;
  } | null>(null);
  // consumed: the last worker result we've already turned into a view. Guards against a
  // benign effect re-run (e.g. StrictMode's dev double-invoke) re-applying a still-"done"
  // generation and clobbering a view set directly by loadView (an import).
  const consumed = useRef<unknown>(null);

  useEffect(() => {
    if (gen.status === "done" && gen.result && gen.result !== consumed.current && pending.current) {
      consumed.current = gen.result;
      const wasReroll = pending.current.reroll;
      const next = viewFromResult(
        pending.current.names,
        pending.current.settings,
        pending.current.constraints,
        gen.result,
      );
      const cur = viewRef.current;
      // A re-generation on the same roster that produced an identical graph is a visual no-op:
      // keep the current graph rather than swapping in an indistinguishable one (no re-layout).
      // But the SETTINGS may have changed (a new seed / minSeparation that happened to yield the
      // same graph), and export + the Advanced panel must reflect what the user just configured —
      // so adopt next.settings while REUSING cur's edges/buddies by reference (so GraphCanvas sees
      // the same `edges` identity and doesn't re-lay-out/animate). Only a REROLL (an explicit
      // "Different arrangement") also surfaces a notice; an unchanged Edit→Generate is silent.
      //
      // The same argument applies to the CONSTRAINTS and their report: a rules-only edit can
      // easily reproduce the same edges (requiring a pair the generator already chose), and
      // keeping the old ones would export the wrong rules and show a stale report. So they are
      // adopted alongside settings — carried over, not re-laid-out.
      if (cur && sameStrings(cur.names, next.names) && sameEdges(cur.edges, next.edges)) {
        // Adopt all three unconditionally. The `changed` predicate tested only settings and
        // constraints while the branch also adopted `report`, so a freshly measured report was
        // DISCARDED whenever the regenerated graph came back byte-identical with the same rules
        // — which is exactly the common reroll case. Predicting which of the adopted fields
        // changed is a second, silently narrower copy of the adoption list; the object identity
        // of `cur.edges` is what protects against a re-layout, and that is preserved either way.
        setView({
          ...cur,
          settings: next.settings,
          constraints: next.constraints,
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
    opts?: { reroll?: boolean },
  ) => {
    // `pending.settings` is filled in BELOW, after the polish downgrade, not here — see there.
    // Never DISPATCH an explicit polish=on for a configuration the core would not
    // auto-polish: it is O(n·m)/iter and would run for tens of seconds. Downgrade to
    // "auto" (which the core then declines anyway), so a hostile imported polish=true
    // can't drive a multi-minute run.
    //
    // Asks the core rather than comparing against a mirrored cap. The old `names.length >
    // POLISH_MAX_N` was k-blind, so at k=12 it happily dispatched an explicit polish=true
    // at n=100 — well past the point the budget declines — which is the expensive
    // direction of the same drift.
    // The SAME predicate the worker routes on, over the same wire shape, computed once and used
    // for both — see `isConstrainedRequest`. Asking `constraints.length > 0` here was a second,
    // structurally different way to decide one fact, and the budget it picks is only correct if
    // it agrees with the builder that actually runs.
    const wire = splitPairs(constraints);
    const wouldAutoPolish = autoPolishEnabled(names.length, settings.buddies, {
      constrained: isConstrainedRequest(wire),
    });
    const polish = settings.polish === true && !wouldAutoPolish ? "auto" : settings.polish;
    // THE DISPATCHED OPTIONS, not the requested ones. `viewFromResult` reads this, so it is what
    // the Advanced panel renders, what `exportGraph` writes, and what the next reroll sends. An
    // explicit `polish: true` that this function downgrades to "auto" (so the core declines it)
    // was still stored as `true`, so the file recorded a configuration that does not reproduce
    // the graph beside it: feeding the exported settings back into `buildBuddyGraph(80, 12,
    // {polish: true})` yields a different edge list. Same class as the seed drift the comments
    // in App.tsx were written for, one field over — a stored setting that the graph does not
    // satisfy — and the fix is the same shape: record what ran, not what was asked for.
    pending.current = {
      names,
      settings: { ...settings, polish },
      constraints,
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
    // Supersede any in-flight generation: clearing `pending` makes the effect drop a
    // worker result that arrives AFTER this import, and reset() cancels the running
    // computation + clears the "running" status so no stale "Generating…" overlay lingers
    // over the imported graph.
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
