// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import type { Reason } from "ringweave";
import type { GraphResult } from "../src/worker/protocol";
import { DEFAULT_SETTINGS, viewFromResult } from "../src/model";
import { generateResult } from "./helpers";
import { exportGraphJson } from "../src/io/exportGraph";

// Drive App with a controllable stand-in for the generation worker so we can inject an error
// state that buildBuddyGraph never actually produces for gated inputs (the branch is defensive).
const hooks = vi.hoisted(() => {
  const state: {
    status: "idle" | "running" | "done" | "error" | "refused";
    result: GraphResult | null;
    error: string | null;
    refusals: Reason[];
  } = { status: "idle", result: null, error: null, refusals: [] };
  return {
    state,
    generate: vi.fn(() => { state.status = "running"; }),
    reset: vi.fn(() => {
      state.status = "idle";
      state.result = null;
      state.error = null;
      state.refusals = [];
    }),
  };
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

import App from "../src/App";

beforeEach(() => {
  hooks.state.status = "idle";
  hooks.state.result = null;
  hooks.state.error = null;
  hooks.state.refusals = [];
  hooks.generate.mockClear();
  hooks.reset.mockClear();
});
afterEach(cleanup);

function dispatchGenerate() {
  fireEvent.change(screen.getByLabelText("Roster names"), { target: { value: "A\nB\nC\nD\nE" } });
  fireEvent.click(screen.getByRole("button", { name: /generate buddy graph/i })); // modal closes, worker "running"
}

// Class: worker-failure recovery. The status="error" branch is written to run, so its recovery
// paths must be complete — no dead-end on a first-generation error, no stale toast after import.
describe("App recovers from a worker error", () => {
  // Recovery must not depend on the error message's content — an empty/blank message must still
  // reopen the modal (no dead-end). Parameterized so the whole class is guarded, not one string.
  it.each([
    ["a specific message", "Boom: k too large"],
    ["an empty message", ""],
    ["a whitespace message", "   "],
  ])("a first-generation error reopens the setup modal with %s (no dead-end)", (_label, message) => {
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => {
      hooks.state.status = "error";
      hooks.state.error = message;
      rerender(<App />);
    });
    expect(screen.getByLabelText("Roster names")).toBeTruthy(); // modal reopened regardless of message
  });

  it("surfaces a fallback toast when the worker error message is empty", () => {
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => {
      hooks.state.status = "error";
      hooks.state.error = "";
      rerender(<App />);
    });
    expect(screen.getByText(/generation failed/i)).toBeTruthy(); // never a blank/no toast
  });

  it("an import after an error clears the stale error toast over the fresh graph", async () => {
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => {
      hooks.state.status = "error";
      hooks.state.error = "Generation failed";
      rerender(<App />);
    });
    expect(screen.getByText(/generation failed/i)).toBeTruthy();

    // Import a valid graph via the JSON file input.
    const view = viewFromResult(["A", "B", "C", "D", "E", "F"], DEFAULT_SETTINGS, [], generateResult(6, 2, { seed: 1, polish: false }));
    const json = exportGraphJson(view);
    const input = document.querySelector('input[accept*="json"]') as HTMLInputElement;
    const file = new File([json], "graph.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => expect(screen.queryByText(/generation failed/i)).toBeNull()); // stale toast gone
  });
});

/**
 * Class: a worker REFUSAL is not an error, and it must land somewhere the user can act.
 *
 * This branch is reachable in a way that is easy to miss. The roster editor runs the same
 * feasibility check before posting, so nothing typed there can reach the worker's gate — but
 * an IMPORTED file carries rules that were never checked for feasibility against the imported
 * buddy count, and "Different arrangement" re-generates with them and no editor in between.
 */
describe("App handles a refusal from the worker", () => {
  it("explains it in the user's terms and reopens the editor", () => {
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => {
      hooks.state.status = "refused";
      hooks.state.refusals = [{ code: "required-degree-exceeds-k", person: 1, required: 5, k: 4 }];
      rerender(<App />);
    });

    // Named after the person, not "person 1" — and the editor is open to fix it.
    expect(screen.getByText(/B has 5 must-be-buddies rules/)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("never renders a refusal as a crash", () => {
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => {
      hooks.state.status = "refused";
      hooks.state.refusals = [{ code: "prohibited-splits-group", person: 0 }];
      rerender(<App />);
    });
    expect(screen.queryByText(/Generation failed/)).toBeNull();
    expect(screen.getByText(/split the group/)).toBeTruthy();
  });

  it("falls back to a plain sentence if the reasons list is somehow empty", () => {
    // Defensive: `refused` with no reasons should still say something actionable
    // rather than showing an empty toast the user cannot interpret.
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => {
      hooks.state.status = "refused";
      hooks.state.refusals = [];
      rerender(<App />);
    });
    expect(screen.getByText(/Those buddy rules can't all be met\./)).toBeTruthy();
  });
});
