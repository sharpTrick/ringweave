import { useCallback, useEffect, useRef, useState } from "react";
import { POLISH_MAX_N, viewFromResult, type GraphView, type Settings } from "../model";
import { splitPairs, pairKey, type ConstraintPair } from "../constraints";
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
 * Rule-set equality, order-insensitive via the canonical pair key.
 *
 * Needed because the "identical graph" short-circuit below compares names and
 * edges only. A constraints-only edit can easily produce the SAME edges — adding
 * a required pair the generator had already chosen, say — and without this the
 * view would keep its old `constraints`/`report`, so export would write the wrong
 * rules and a reroll would claim it "couldn't find a different arrangement".
 */
function sameConstraints(a: ConstraintPair[], b: ConstraintPair[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(pairKey));
  return b.every((p) => keys.has(pairKey(p)));
}

function sameSettings(a: Settings, b: Settings): boolean {
  return a.buddies === b.buddies && a.minSeparation === b.minSeparation && a.polish === b.polish && a.seed === b.seed;
}

/**
 * Orchestrates generation: sends a job to the worker and maps its BuddyResult back into
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
        const changed =
          !sameSettings(cur.settings, next.settings) ||
          !sameConstraints(cur.constraints, next.constraints);
        if (changed) {
          setView({
            ...cur,
            settings: next.settings,
            constraints: next.constraints,
            report: next.report,
          });
        }
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
    pending.current = { names, settings, constraints, reroll: opts?.reroll ?? false };
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
      constraints: splitPairs(constraints),
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
