// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import type { Reason } from "ringweave";
import type { GraphResult } from "../src/worker/protocol";
import { DEFAULT_SETTINGS, viewFromResult } from "../src/model";
import { generateResult } from "./helpers";
import { exportGraphJson } from "../src/io/exportGraph";

// A controllable stand-in for the generation worker: its error and refused branches are
// defensive, so gated inputs never produce them and nothing else can drive these paths.
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
    // Records the ARGUMENTS, not just that it was called: the reroll tests below turn on what
    // was dispatched, which a call-count spy cannot see.
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

describe("App recovers from a worker error", () => {
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

    const view = viewFromResult(["A", "B", "C", "D", "E", "F"], DEFAULT_SETTINGS, [], [], generateResult(6, 2, { seed: 1, polish: false }));
    const json = exportGraphJson(view);
    const input = document.querySelector('input[accept*="json"]') as HTMLInputElement;
    const file = new File([json], "graph.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => expect(screen.queryByText(/generation failed/i)).toBeNull()); // stale toast gone
  });
});

// A refusal is only reachable from an IMPORTED file — the roster editor runs the same
// feasibility check before posting — so this branch looks dead from the editor's side and is not.
describe("App handles a refusal from the worker", () => {
  it("names the person in a refusal instead of an index, and reopens the editor", () => {
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => {
      hooks.state.status = "refused";
      hooks.state.refusals = [{ code: "required-degree-exceeds-k", person: 1, required: 5, k: 4 }];
      rerender(<App />);
    });

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

  it("words the refusal from the roster that was DISPATCHED, not a second copy", async () => {
    const { rerender } = render(<App />);
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: "Alice\nBob\nCarol\nDan\nEve" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate buddy graph/i }));
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(5, 4, { polish: false });
      rerender(<App />);
    });
    fireEvent.click(screen.getByRole("button", { name: /edit people/i }));
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: "Zed\nYan\nXan\nWan\nVan" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate buddy graph/i }));
    act(() => {
      hooks.state.status = "idle"; // cancelled; `view` is still Alice's graph
      rerender(<App />);
    });
    fireEvent.click(screen.getByRole("button", { name: /different arrangement/i }));
    act(() => {
      hooks.state.status = "refused";
      hooks.state.refusals = [{ code: "self-pair", person: 0 }];
      rerender(<App />);
    });
    await waitFor(() =>
      expect(screen.getByText(/can't be paired with themselves/).textContent).toMatch(/^Alice\b/),
    );
    expect(screen.queryByText(/Zed/)).toBeNull();
    expect((screen.getByLabelText("Roster names") as HTMLTextAreaElement).value)
      .toBe("Alice\nBob\nCarol\nDan\nEve");
  });

  it("announces WHY the dialog reopened, through the dialog's own description", async () => {
    const { rerender } = render(<App />);
    fireEvent.change(screen.getByLabelText("Roster names"), { target: { value: "A\nB\nC\nD\nE" } });
    // Focused explicitly: jsdom's click does not move focus the way a browser's does, and the
    // rescue keys on focus having been somewhere real.
    const submit = screen.getByRole("button", { name: /generate buddy graph/i });
    submit.focus();
    fireEvent.click(submit);
    act(() => {
      hooks.state.status = "refused";
      hooks.state.refusals = [{ code: "prohibited-splits-group", person: 0 }];
      rerender(<App />);
    });
    const dialog = screen.getByRole("dialog");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy!);
    expect(description).toBeTruthy();
    expect(dialog.contains(description)).toBe(true);
    expect(description!.textContent).toMatch(/split the group/);
    // And focus lands inside the dialog, which is what makes a description an announcement.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("carries no dangling description when the dialog was not reopened by a refusal", () => {
    render(<App />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")).toBeNull();
  });

  it("a reroll never deletes a rule row the editor promised to keep", async () => {
    const { rerender } = render(<App />);
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: "A\nB\nC\nD\nE\nF" },
    });
    fireEvent.click(document.querySelector(".rules-block > summary") as HTMLElement);
    fireEvent.click(screen.getByText("+ Add a buddy rule"));
    fireEvent.change(screen.getByLabelText("Rule 1, first person"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Rule 1, second person"), { target: { value: "B" } });
    fireEvent.click(screen.getByText("+ Add a buddy rule"));
    fireEvent.change(screen.getByLabelText("Rule 2, first person"), { target: { value: "A" } });
    // Names somebody who is not in the roster: kept and flagged, per the editor's contract.
    fireEvent.change(screen.getByLabelText("Rule 2, second person"), { target: { value: "Zoe" } });
    fireEvent.click(screen.getByRole("button", { name: /generate buddy graph/i }));
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(6, 4, { polish: false });
      rerender(<App />);
    });
    fireEvent.click(screen.getByRole("button", { name: /different arrangement/i }));
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(6, 4, { polish: false });
      rerender(<App />);
    });
    fireEvent.click(screen.getByRole("button", { name: /edit people/i }));
    fireEvent.click(document.querySelector(".rules-block > summary") as HTMLElement);
    expect((screen.getByLabelText("Rule 1, second person") as HTMLInputElement).value).toBe("B");
    expect((screen.getByLabelText("Rule 2, second person") as HTMLInputElement).value).toBe("Zoe");
  });

  it("a reroll never shows rules the graph on screen was not built under", async () => {
    const { rerender } = render(<App />);
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: "Alice\nBob\nCarol\nDan\nEve\nFay" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate buddy graph/i }));
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(6, 4, { polish: false });
      rerender(<App />);
    });
    fireEvent.click(screen.getByRole("button", { name: /edit people/i }));
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: "Zed\nYan\nXan\nWan\nVan\nUma" },
    });
    fireEvent.click(document.querySelector(".rules-block > summary") as HTMLElement);
    fireEvent.click(screen.getByText("+ Add a buddy rule"));
    fireEvent.change(screen.getByLabelText("Rule 1, first person"), { target: { value: "Zed" } });
    fireEvent.change(screen.getByLabelText("Rule 1, second person"), { target: { value: "Yan" } });
    fireEvent.click(screen.getByRole("button", { name: /generate buddy graph/i }));
    act(() => {
      hooks.state.status = "idle"; // cancelled; the view is still Alice's graph
      rerender(<App />);
    });

    // Refused deliberately: on success the adoption effect rewrites the whole draft from the new
    // view, which would mask a dispatch site that forgot the rows.
    fireEvent.click(screen.getByRole("button", { name: /different arrangement/i }));
    act(() => {
      hooks.state.status = "refused";
      hooks.state.refusals = [{ code: "self-pair", person: 0 }];
      rerender(<App />);
    });
    expect((screen.getByLabelText("Roster names") as HTMLTextAreaElement).value)
      .toBe("Alice\nBob\nCarol\nDan\nEve\nFay");
    expect(screen.queryByLabelText("Rule 1, first person")).toBeNull();
    expect(document.querySelector(".rules-block > summary")?.textContent).not.toMatch(/\(1\)/);
  });

  it("never shows a seed the graph on screen was not built with", async () => {
    const { rerender } = render(<App />);
    fireEvent.change(screen.getByLabelText("Roster names"), { target: { value: "A\nB\nC\nD\nE" } });
    fireEvent.click(screen.getByRole("button", { name: /generate buddy graph/i }));
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(5, 4, { polish: false });
      rerender(<App />);
    });
    // The seed the displayed graph was actually built with — the one exportGraph writes.
    const shown = DEFAULT_SETTINGS.seed;
    for (const abandon of ["idle", "error", "refused"] as const) {
      fireEvent.click(screen.getByRole("button", { name: /different arrangement/i }));
      act(() => {
        hooks.state.status = abandon;
        hooks.state.error = abandon === "error" ? "Boom" : null;
        hooks.state.refusals = abandon === "refused" ? [{ code: "self-pair", person: 0 }] : [];
        rerender(<App />);
      });
      if (!screen.queryByLabelText("Roster names")) {
        fireEvent.click(screen.getByRole("button", { name: /edit people/i }));
      }
      const seedField = screen.getByLabelText("Seed") as HTMLInputElement;
      expect(Number(seedField.value)).toBe(shown);
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      act(() => {
        hooks.state.status = "idle";
        hooks.state.error = null;
        hooks.state.refusals = [];
        rerender(<App />);
      });
    }
  });

  it("falls back to a plain sentence if the reasons list is somehow empty", () => {
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

describe("overlays and focus", () => {
  it("puts focus INSIDE the dialog on cold load, not on <body>", () => {
    render(<App />);
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).not.toBe(document.body);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("Roster names"));
  });

  it("marks the stepper's bounds on the control, since a clamped value announces nothing", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Advanced"));
    const up = () => screen.getByRole("button", { name: /more buddies/i });
    const down = () => screen.getByRole("button", { name: /fewer buddies/i });
    expect(up().getAttribute("aria-disabled")).toBe("false");
    for (let i = 0; i < 20; i++) fireEvent.click(up());
    expect(up().getAttribute("aria-disabled")).toBe("true");
    expect(up().getAttribute("aria-label")).toMatch(/the most allowed/);
    // Focus is NOT taken away by reaching the bound — the whole reason this is not `disabled`.
    up().focus();
    fireEvent.click(up());
    expect(document.activeElement).toBe(up());
    for (let i = 0; i < 20; i++) fireEvent.click(down());
    expect(down().getAttribute("aria-disabled")).toBe("true");
    expect(down().getAttribute("aria-label")).toMatch(/the fewest allowed/);
    expect(up().getAttribute("aria-disabled")).toBe("false");
  });

  it("never nests the dialog inside an inert ancestor", () => {
    // Asserted structurally rather than by tabbing: jsdom does not implement inert's focus
    // behaviour, and containment is the property the browser acts on.
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
    const app = document.querySelector("#app");
    expect(app?.hasAttribute("inert")).toBe(true);
    expect(app?.contains(document.querySelector(".busy"))).toBe(false);
  });

  it("rerolls the roster on screen, not one abandoned mid-generation", () => {
    const { rerender } = render(<App />);
    dispatchGenerate(); // 5 people
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(5, 4, { polish: false });
      rerender(<App />);
    });
    expect(document.querySelector(".rail-big")?.textContent).toBe("5");

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

/**
 * Asserts the PROPERTY a rescue owes — a reachable Tab anchor inside `#app` that is not a
 * caret — rather than naming an element, so an anchor that opens a phone keyboard cannot
 * stay pinned by tests whose subject is "focus is not stranded".
 */
function expectRescued(el: Element | null): void {
  const landed = el as HTMLElement;
  expect(landed).not.toBe(document.body);
  expect(landed.closest("#app")).not.toBeNull();
  expect(landed.tagName).not.toBe("TEXTAREA");
  expect(landed.tagName === "INPUT" && /text|search/.test((landed as HTMLInputElement).type)).toBe(false);
}

describe("focus survives a panel closing itself", () => {
  function withGraph(rerender: (ui: React.ReactElement) => void) {
    dispatchGenerate();
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(5, 4, { polish: false });
      rerender(<App />);
    });
  }

  it("rescues focus wherever the removal happened, including places nothing calls a helper", async () => {
    const { rerender } = render(<App />);
    withGraph(rerender);
    fireEvent.click(document.querySelectorAll(".brow")[0]);
    // Focused explicitly: jsdom's click does not move focus the way a browser's does, and the
    // rescue keys on focus having been somewhere real.
    const close = screen.getByLabelText("Close person details");
    close.focus();
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Escape" });
    // Awaited: the rescue watches the DOM through a MutationObserver, which delivers on the
    // microtask after the batch rather than inside the commit.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expectRescued(document.activeElement);
  });

  it("does not touch focus when a commit removed nothing the user was standing on", async () => {
    const { rerender } = render(<App />);
    withGraph(rerender);
    const search = screen.getByLabelText("Find a person");
    search.focus();
    search.blur(); // a tap on a non-focusable SVG node lands here
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(document.querySelectorAll(".brow")[0]);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(document.body);
  });

  it("lands the rescue somewhere that does not open a phone keyboard", async () => {
    const { rerender } = render(<App />);
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: "Ana\nBen\nChen\nDee\nEli" },
    });
    // Focused AFTER the roster is filled: with an empty roster the button is disabled and
    // `.focus()` is a no-op, which would make this test pass for the wrong reason.
    const submit = screen.getByRole("button", { name: /generate/i });
    submit.focus();
    expect(document.activeElement).toBe(submit);
    fireEvent.click(submit);
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(5, 4, { polish: false });
      rerender(<App />);
    });
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expectRescued(document.activeElement);
  });

  it("does not steal focus when the user deliberately blurs to the background", () => {
    const { rerender } = render(<App />);
    withGraph(rerender);
    const search = screen.getByLabelText("Find a person");
    search.focus();
    search.blur();
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps focus reachable when the person panel's Close is used", async () => {
    const { rerender } = render(<App />);
    withGraph(rerender);
    // Queried by class: a buddy-list row's accessible name is the person PLUS their
    // buddy labels, so matching on the name alone does not find it.
    fireEvent.click(document.querySelectorAll(".brow")[0]);
    const close = screen.getByLabelText("Close person details");
    close.focus();
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expectRescued(document.activeElement);
  });

  it("leaves focus inside the dialog when a DESCENDANT's own state removes the focused element", async () => {
    // The removal is owned by `RosterModal`'s state, so `App` never re-renders — the case that
    // sank the third attempt at this hook. It is now caught TWICE: `ConstraintsEditor` hands focus
    // to a surviving row before removing, and the app-global rescue stands behind that. So this
    // asserts the property both mechanisms owe (focus stays in the dialog, never on <body>) rather
    // than naming the anchor, which would pin whichever one happened to win.
    //
    // The global mechanism itself is exercised directly in `focusRescue.test.tsx`, driven without
    // App so its timing conditions can be reached deliberately.
    render(<App />);
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: "Ana\nBen\nChen\nDee\nEli" },
    });
    fireEvent.click(document.querySelector(".rules-block > summary") as HTMLElement);
    fireEvent.click(screen.getByText("+ Add a buddy rule"));
    const remove = screen.getByLabelText("Remove rule 1");
    remove.focus();
    expect(document.activeElement).toBe(remove);
    fireEvent.click(remove);
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
  });

  it("leaves focus alone when Escape is pressed from outside the panel", () => {
    const { rerender } = render(<App />);
    withGraph(rerender);
    fireEvent.click(document.querySelectorAll(".brow")[0]);
    const elsewhere = screen.getByLabelText("Find a person");
    elsewhere.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe("a refusal is both contained and announced", () => {
  it("puts the reason INSIDE the dialog rather than in an inert toast", () => {
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => {
      hooks.state.status = "refused";
      hooks.state.refusals = [{ code: "prohibited-splits-group", person: 0 }];
      rerender(<App />);
    });
    const dialog = screen.getByRole("dialog");
    const reason = screen.getByText(/split the group/);
    expect(dialog.contains(reason)).toBe(true);
    expect(reason.closest('[aria-live]')).not.toBeNull();
    expect(dialog.closest("[inert]")).toBeNull();
    expect(document.querySelector("#app")?.hasAttribute("inert")).toBe(true);
  });

  it("still uses the toast when no dialog will open to carry the message", () => {
    const { rerender } = render(<App />);
    dispatchGenerate();
    act(() => {
      hooks.state.status = "done";
      hooks.state.result = generateResult(5, 4, { polish: false });
      rerender(<App />);
    });
    act(() => {
      hooks.state.status = "error";
      hooks.state.error = "Generation failed.";
      rerender(<App />);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    const toast = document.querySelector(".toast");
    expect(toast?.textContent).toMatch(/Generation failed/);
    expect(toast?.closest("[inert]")).toBeNull();
  });
});

describe("selecting a person is announced, not just rendered", () => {
  it("puts the selection into a region that was already mounted", () => {
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
