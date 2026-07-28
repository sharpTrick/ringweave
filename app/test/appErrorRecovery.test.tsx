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
const hooks: {
  state: { status: "idle" | "running" | "done" | "error" | "refused"; result: GraphResult | null; error: string | null; refusals: Reason[] };
  calls: { n: number; k: number }[];
  generate: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => {
  const state: {
    status: "idle" | "running" | "done" | "error" | "refused";
    result: GraphResult | null;
    error: string | null;
    refusals: Reason[];
  } = { status: "idle", result: null, error: null, refusals: [] };
  const calls: { n: number; k: number }[] = [];
  return {
    state,
    // Records what it was ASKED to generate, not only that it was asked. The reroll
    // desync below is entirely about the arguments, so a call-count spy cannot see it.
    calls,
    generate: vi.fn((req: { n: number; k: number }) => {
      calls.push({ n: req.n, k: req.k });
      state.status = "running";
    }),
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
  hooks.calls.length = 0;
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

// Class: an overlay must own the screen without swallowing itself, and a control that
// removes its own panel must leave focus somewhere. Both are keyboard-only failures
// that render perfectly and that a mouse-driven test cannot see.
describe("overlays and focus", () => {
  it("never nests the dialog inside an inert ancestor", () => {
    // `inert` cascades to every descendant with no way to opt back in, so a modal
    // rendered inside the element carrying it is unreachable — and since the modal
    // is open on cold load, that was the whole first paint. Asserted structurally
    // rather than by tabbing, because jsdom does not implement inert's focus
    // behaviour: the property under test is the containment, which is what the
    // browser acts on.
    render(<App />);
    const dialog = screen.getByRole("dialog");
    for (const el of Array.from(document.querySelectorAll("[inert]"))) {
      expect(el.contains(dialog)).toBe(false);
    }
    // And the guard is live, not vacuously true because nothing is inert.
    expect(document.querySelector("#app")?.hasAttribute("inert")).toBe(true);
  });

  it("makes the page inert while generating, not just unclickable", () => {
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => { rerender(<App />); });
    // The scrim blocked the mouse; the buddy list and search box behind it stayed
    // focusable and Enter-activatable the whole time.
    const app = document.querySelector("#app");
    expect(app?.hasAttribute("inert")).toBe(true);
    expect(app?.contains(document.querySelector(".busy"))).toBe(false);
  });

  it("rerolls the roster on screen, not one abandoned mid-generation", () => {
    // handleGenerate committed names/settings/constraints at DISPATCH time while the
    // view only advances on success, so cancelling or failing a second generation left
    // those three describing a roster that was never built. Reroll read them instead of
    // the view, and "Different arrangement" silently replaced the displayed graph with a
    // different roster.
    const { rerender } = render(<App />);
    dispatchGenerate(); // 5 people
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(5, 4, { polish: false });
      rerender(<App />);
    });
    expect(document.querySelector(".rail-big")?.textContent).toBe("5");

    // Dispatch a 9-person generation, then abandon it.
    fireEvent.click(screen.getByRole("button", { name: /edit people/i }));
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: "A\nB\nC\nD\nE\nF\nG\nH\nI" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate buddy graph/i }));
    act(() => { rerender(<App />); });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    act(() => {
      hooks.state.status = "done"; // cancel keeps the old view
      rerender(<App />);
    });
    expect(document.querySelector(".rail-big")?.textContent).toBe("5");

    hooks.calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: /different arrangement/i }));
    expect(hooks.calls).toEqual([{ n: 5, k: 4 }]);
  });
});

// Class: focus must never be stranded on <body>. Removing a focused element moves focus
// there per spec, so the next Tab restarts at the top of the document — a keyboard user
// who dismisses a panel is thrown back to the header. Nothing in app/src called .focus().
describe("focus survives a panel closing itself", () => {
  function withGraph(rerender: (ui: React.ReactElement) => void) {
    dispatchGenerate();
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(5, 4, { polish: false });
      rerender(<App />);
    });
  }

  // The rescue is now ONE mechanism at the commit boundary, not a helper each call site has
  // to remember. These cases are therefore a sample of the class, not an enumeration of it —
  // three earlier rounds each fixed the call sites review had found and each missed the next
  // batch, which is the argument for testing the mechanism rather than the sites.
  it("rescues focus wherever the removal happened, including places nothing calls a helper", () => {
    const { rerender } = render(<App />);
    withGraph(rerender);
    fireEvent.click(document.querySelectorAll(".brow")[0]);
    // Focus explicitly: jsdom's click does not move focus the way a browser's does, and the
    // rescue keys on focus actually having been somewhere. Focusing here is standing in for
    // the browser, not working around the mechanism — the e2e harness checks the real thing.
    const close = screen.getByLabelText("Close person details");
    close.focus();
    expect(document.activeElement).toBe(close);
    // Escape, which goes through useEscape — a path with no rescue helper anywhere on it.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByLabelText("Find a person"));
  });

  it("does not steal focus when the user deliberately blurs to the background", () => {
    // The rescue keys on "focus is on <body> AFTER a commit that removed something", not on
    // blur. Clicking the page background is a legitimate way to end up on <body> and must be
    // left alone, or focus becomes impossible to put down.
    const { rerender } = render(<App />);
    withGraph(rerender);
    const search = screen.getByLabelText("Find a person");
    search.focus();
    search.blur();
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to the search box when the person panel's Close is used", () => {
    const { rerender } = render(<App />);
    withGraph(rerender);
    // Open the panel from the buddy list, then close it from inside.
    // Queried by class: a buddy-list row's accessible name is the person PLUS their
    // buddy labels, so matching on the name alone does not find it.
    fireEvent.click(document.querySelectorAll(".brow")[0]);
    const close = screen.getByLabelText("Close person details");
    close.focus();
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByLabelText("Find a person"));
  });

  it("leaves focus alone when Escape is pressed from outside the panel", () => {
    // The rule is "rescue focus that is about to be destroyed", not "grab focus on every
    // clear" — Escape can be pressed with focus on the graph or the buddy list.
    const { rerender } = render(<App />);
    withGraph(rerender);
    fireEvent.click(document.querySelectorAll(".brow")[0]);
    const elsewhere = screen.getByLabelText("Find a person");
    elsewhere.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe("the dialog contains focus, including the toast", () => {
  it("puts the toast inside an inert subtree while the dialog is open", () => {
    // The toast lives OUTSIDE #app — it has to, since #app is the thing that gets inert — and it
    // contains a real button, so it was the one focusable element Tab could reach from inside an
    // aria-modal dialog. The containment leaked through the one element it could not cover.
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => {
      hooks.state.status = "refused";
      hooks.state.refusals = [{ code: "prohibited-splits-group", person: 0 }];
      rerender(<App />);
    });
    const toast = document.querySelector(".toast");
    expect(toast).not.toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy(); // the refusal reopened it
    // Every focusable thing outside the dialog is inside an inert subtree.
    const inertAncestor = (el: Element | null) => !!el?.closest("[inert]");
    expect(inertAncestor(toast)).toBe(true);
    expect(inertAncestor(document.querySelector("#app"))).toBe(true);
    // ...and the dialog itself is NOT, which is the half that must not regress.
    expect(inertAncestor(screen.getByRole("dialog"))).toBe(false);
  });
});

describe("selecting a person is announced, not just rendered", () => {
  it("puts the selection into a region that was already mounted", () => {
    // PersonPanel precedes the buddy list and the search box in DOM order — deliberately, so the
    // DOM follows the visual layout — so Tab has already passed it by the time a selection is
    // made from either. Announcing the outcome is what makes the headline task usable without a
    // mouse, and the region must pre-exist the text or the change is not a change.
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(5, 4, { polish: false });
      rerender(<App />);
    });
    const regions = () => Array.from(document.querySelectorAll(".sr-live"));
    expect(regions().length).toBeGreaterThan(0); // mounted BEFORE any selection
    expect(regions().map((r) => r.textContent).join("")).toBe("");

    fireEvent.click(document.querySelectorAll(".brow")[0]);
    const spoken = regions().map((r) => r.textContent).join(" ");
    expect(spoken).toMatch(/selected/);
  });
});
