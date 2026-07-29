// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { DEFAULT_SETTINGS, viewFromResult } from "../src/model";
import { autoPolishEnabled } from "ringweave";
import type { GraphResult } from "../src/worker/protocol";
import { generateResult } from "./helpers";

// Drive useBuddyGraph without a real Worker: a controllable stand-in for
// useGenerationWorker whose state the test mutates, then rerenders to fire the effect.
const hooks = vi.hoisted(() => {
  const state: {
    status: "idle" | "running" | "done" | "error" | "refused";
    result: GraphResult | null;
    error: string | null;
    refusals: never[];
  } = { status: "idle", result: null, error: null, refusals: [] };
  // Typed by its ARGS, not inferred from the stub body: an untyped mock's
  // `mock.calls` is an empty tuple, so reading calls[0][0] is a type error and the
  // only escape is a cast that asserts a shape nobody checked.
  const generate = vi.fn<(req: { options: { polish: unknown } }) => void>(() => {
    state.status = "running";
  });
  const reset = vi.fn(() => {
    state.status = "idle";
    state.result = null;
    state.error = null;
  });
  return { state, generate, reset };
});

vi.mock("../src/state/useGenerationWorker", () => ({
  useGenerationWorker: () => ({
    status: hooks.state.status,
    result: hooks.state.result,
    error: hooks.state.error,
    refusals: hooks.state.refusals,
    generate: hooks.generate,
    reset: hooks.reset,
  }),
}));

import { useBuddyGraph } from "../src/state/useBuddyGraph";

beforeEach(() => {
  hooks.state.status = "idle";
  hooks.state.result = null;
  hooks.state.error = null;
  hooks.generate.mockClear();
  hooks.reset.mockClear();
});

describe("useBuddyGraph result↔state pairing", () => {
  it("an import during in-flight generation survives the late worker result (no clobber)", () => {
    const imported = viewFromResult(["A", "B", "C", "D", "E", "F"], DEFAULT_SETTINGS, [], [], generateResult(6, 2, { seed: 1 }),
    );
    const stale = generateResult(4, 2, { seed: 2 }); // the superseded generate's eventual result

    const { result, rerender } = renderHook(() => useBuddyGraph());
    act(() => result.current.generate(["W", "X", "Y", "Z"], DEFAULT_SETTINGS, [], [])); // pending set; mock -> running
    act(() => rerender());
    expect(result.current.status).toBe("running");

    act(() => result.current.loadView(imported)); // import lands -> view=imported, pending cleared, reset()
    act(() => rerender());
    expect(result.current.status).not.toBe("running"); // no stale "Generating…" overlay

    hooks.state.status = "done";
    hooks.state.result = stale; // worker finally replies for the superseded generate
    act(() => rerender());

    expect(result.current.view).toEqual(imported); // imported view is NOT overwritten
  });

  it("applies a worker result when nothing superseded it", () => {
    const gen = generateResult(4, 2, { seed: 3 });
    const { result, rerender } = renderHook(() => useBuddyGraph());
    act(() => result.current.generate(["A", "B", "C", "D"], DEFAULT_SETTINGS, [], []));
    act(() => rerender());

    hooks.state.status = "done";
    hooks.state.result = gen;
    act(() => rerender());

    expect(result.current.view?.names).toEqual(["A", "B", "C", "D"]);
  });

  it("fires onIdenticalReroll (with the kept view) when a REROLL yields identical edges", () => {
    const onNoop = vi.fn();
    const roster = ["A", "B", "C", "D", "E"];
    const g1 = generateResult(5, 4, { seed: 1 }); // K5 (unique)
    const g2 = generateResult(5, 4, { seed: 2 }); // K5 again — byte-identical edges

    const { result, rerender } = renderHook(() => useBuddyGraph(onNoop));
    act(() => result.current.generate(roster, { buddies: 4, polish: "auto", seed: 1 }, [], []));
    act(() => rerender());
    hooks.state.status = "done";
    hooks.state.result = g1;
    act(() => rerender());
    const kept = result.current.view;
    expect(kept?.names).toEqual(roster);

    act(() => result.current.generate(roster, { buddies: 4, polish: "auto", seed: 2 }, [], [], { reroll: true }));
    act(() => rerender());
    hooks.state.status = "done";
    hooks.state.result = g2;
    act(() => rerender());

    expect(onNoop).toHaveBeenCalledTimes(1); // identical reroll -> notified
    expect(onNoop).toHaveBeenCalledWith(kept); // caller gets the kept view to word from its quality
    // The graph is reused (no re-layout) but the bumped seed is adopted so export stays truthful.
    expect(result.current.view!.edges).toBe(kept!.edges); // same edges reference -> no re-layout
    expect(result.current.view!.settings.seed).toBe(2); // reroll's new seed is reflected
  });

  it("does NOT fire onIdenticalReroll for an unchanged Edit→Generate (not a reroll request)", () => {
    const onNoop = vi.fn();
    const roster = ["A", "B", "C", "D", "E"];
    const g1 = generateResult(5, 4, { seed: 1 });
    const g2 = generateResult(5, 4, { seed: 1 }); // same seed -> identical, but a plain generate

    const { result, rerender } = renderHook(() => useBuddyGraph(onNoop));
    act(() => result.current.generate(roster, { buddies: 4, polish: "auto", seed: 1 }, [], []));
    act(() => rerender());
    hooks.state.status = "done";
    hooks.state.result = g1;
    act(() => rerender());

    act(() => result.current.generate(roster, { buddies: 4, polish: "auto", seed: 1 }, [], [])); // no reroll flag
    act(() => rerender());
    hooks.state.status = "done";
    hooks.state.result = g2;
    act(() => rerender());

    expect(onNoop).not.toHaveBeenCalled(); // silent idempotent no-op, not a failed "reroll"
    expect(result.current.view?.names).toEqual(roster);
  });

  // Class: an idempotent (identical-edges) generate under CHANGED settings must still adopt the
  // new settings so export/UI aren't stale — while reusing the laid-out edges (no re-layout).
  it.each([
    ["seed", { buddies: 4, polish: "auto", seed: 2 } as const],
    ["minSeparation", { buddies: 4, polish: "auto", seed: 1, minSeparation: 6 } as const],
    ["polish", { buddies: 4, polish: false, seed: 1 } as const],
  ])("adopts changed %s on an identical-edges regenerate, reusing edges (no re-layout)", (_label, changed) => {
    const roster = ["A", "B", "C", "D", "E"];
    const g1 = generateResult(5, 4, { seed: 1 }); // K5
    const g2 = generateResult(5, 4, { seed: 2 }); // K5 again — identical edges

    const { result, rerender } = renderHook(() => useBuddyGraph());
    act(() => result.current.generate(roster, { buddies: 4, polish: "auto", seed: 1 }, [], []));
    act(() => rerender());
    hooks.state.status = "done";
    hooks.state.result = g1;
    act(() => rerender());
    const priorEdges = result.current.view!.edges;

    act(() => result.current.generate(roster, changed, [], [])); // non-reroll, changed settings
    act(() => rerender());
    hooks.state.status = "done";
    hooks.state.result = g2;
    act(() => rerender());

    expect(result.current.view!.settings).toEqual(changed); // export/UI now truthful
    expect(result.current.view!.edges).toBe(priorEdges); // same reference -> no re-layout/animation
  });

  // Parameterized over k, and asking the CORE where the boundary is rather than mirroring
  // it. The previous version hardcoded the app's own POLISH_MAX_N at k=4, which is why a
  // k-blind constant survived: the real gate is k-dependent, so at k=12 this downgrade was
  // not happening anywhere near where it should — an explicit polish=true at n=100 was
  // dispatched in full, which is the expensive direction of the same drift.
  it("never DISPATCHES polish=true for a configuration the core would not auto-polish", () => {
    const { result } = renderHook(() => useBuddyGraph());
    const firstRefused = (k: number) => {
      for (let n = 4; n <= 4000; n++) if (!autoPolishEnabled(n, k)) return n;
      throw new Error(`no non-polishing n for k=${k}`);
    };

    for (const k of [2, 4, 12]) {
      const boundary = firstRefused(k);
      const roster = (count: number) => Array.from({ length: count }, (_, i) => `P${i}`);

      hooks.generate.mockClear();
      act(() => result.current.generate(roster(boundary), { buddies: k, polish: true, seed: 1 }, [], []));
      expect(hooks.generate.mock.calls.at(-1)![0].options.polish).not.toBe(true);

      hooks.generate.mockClear();
      act(() =>
        result.current.generate(roster(boundary - 1), { buddies: k, polish: true, seed: 1 }, [], []),
      );
      expect(hooks.generate.mock.calls.at(-1)![0].options.polish).toBe(true);
    }
  });
});
