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

  it("words the refusal from the roster that was DISPATCHED, not a second copy", async () => {
    // The invariant: the array that resolves `Reason.person` into a name is the array that was
    // handed to the `generate()` call which produced that refusal. App kept two copies of
    // "what was dispatched" and only one dispatch path wrote them, so a reroll — which correctly
    // sends the ON-SCREEN graph's roster — was explained with the roster of an abandoned edit,
    // naming a person who is in no graph at all.
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
    // A second Edit→Generate that never lands: the roster App committed at dispatch is now Zed's.
    fireEvent.click(screen.getByRole("button", { name: /edit people/i }));
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: "Zed\nYan\nXan\nWan\nVan" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate buddy graph/i }));
    act(() => {
      hooks.state.status = "idle"; // cancelled; `view` is still Alice's graph
      rerender(<App />);
    });
    // Reroll dispatches the VIEW's roster, and it is refused.
    fireEvent.click(screen.getByRole("button", { name: /different arrangement/i }));
    act(() => {
      hooks.state.status = "refused";
      hooks.state.refusals = [{ code: "self-pair", person: 0 }];
      rerender(<App />);
    });
    // Person 0 of the dispatched roster is Alice. Zed is in no graph and has no rules.
    await waitFor(() =>
      expect(screen.getByText(/can't be paired with themselves/).textContent).toMatch(/^Alice\b/),
    );
    expect(screen.queryByText(/Zed/)).toBeNull();
    // The sibling, and the reason a partial fix would not have closed this: the dialog the
    // refusal reopens is seeded from the same dispatch-time state the message is worded from,
    // so it cannot show one roster while explaining another.
    expect((screen.getByLabelText("Roster names") as HTMLTextAreaElement).value)
      .toBe("Alice\nBob\nCarol\nDan\nEve");
  });

  it("announces WHY the dialog reopened, through the dialog's own description", async () => {
    // A live region must exist in the accessibility tree before its text changes, or the change
    // is never announced — the rule this app applies to every region it owns. The note stack was
    // the exception BY CONSTRUCTION, not by omission: RosterModal is conditionally mounted, so a
    // refusal that closes the dialog to dispatch and reopens it creates the region and its most
    // important message in one commit. A user who pressed Generate has focus rescued into the
    // reopened roster field and is told nothing about why it came back.
    //
    // The fix is not to reorder the commits (unprovable — React flushes both in one microtask)
    // but to stop depending on ordering: a dialog's accessible DESCRIPTION is announced when
    // focus enters it, and focus does enter it.
    const { rerender } = render(<App />);
    fireEvent.change(screen.getByLabelText("Roster names"), { target: { value: "A\nB\nC\nD\nE" } });
    // Focused explicitly before clicking: jsdom's click does not move focus the way a browser's
    // does, and the rescue that carries focus into the reopened dialog keys on focus having been
    // somewhere real. Standing in for the browser, not working around the mechanism.
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
    // The description resolves, is inside the dialog, and carries the actual reason.
    expect(description).toBeTruthy();
    expect(dialog.contains(description)).toBe(true);
    expect(description!.textContent).toMatch(/split the group/);
    // And focus lands inside the dialog, which is what makes a description an announcement.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("carries no dangling description when the dialog was not reopened by a refusal", () => {
    // The other half: `aria-describedby` pointing at an element that does not exist is worse
    // than none, and the reason element only renders when there is a reason.
    render(<App />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")).toBeNull();
  });

  it("never shows a seed the graph on screen was not built with", async () => {
    // The seed is the one value the reroll path SYNTHESISES rather than copying from the view,
    // and it only becomes true if the reroll succeeds. Committing it at dispatch left the
    // Advanced -> Seed field one ahead of the displayed graph for every non-success outcome —
    // cancel, error, refusal, supersession — contradicting the seed `exportGraph` writes. The
    // invariant is stated over the state, not over the four outcomes: nothing may write a
    // settings value that is neither user-entered nor taken from an adopted view.
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
      // Back to a clean slate for the next outcome.
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
  it("puts focus INSIDE the dialog on cold load, not on <body>", () => {
    // The first paint is the one path with no mechanism covering it. `modalOpen` starts true and
    // `#app` is inert, so this dialog is the entire accessible document — and the app's one focus
    // mechanism, `useFocusRescue`, is gated on focus having been somewhere real first, which on a
    // cold load is false BY DESIGN. So the rescue correctly declines, and nothing else acted: a
    // screen reader that announces on focus entry never learned a modal had opened, and the first
    // Tab had to guess where it would land. Every OTHER route into this dialog was covered.
    render(<App />);
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).not.toBe(document.body);
    expect(dialog.contains(document.activeElement)).toBe(true);
    // ...and specifically at the field the dialog exists for.
    expect(document.activeElement).toBe(screen.getByLabelText("Roster names"));
  });

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
  it("rescues focus wherever the removal happened, including places nothing calls a helper", async () => {
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
    // Awaited, like every rescue assertion here: the rescue watches the DOM through a
    // MutationObserver, which delivers on the microtask after the batch rather than inside the
    // commit. That is the property that makes it independent of which component re-rendered.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
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

  it("moves focus to the search box when the person panel's Close is used", async () => {
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
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toBe(screen.getByLabelText("Find a person"));
  });

  it("rescues focus when a DESCENDANT's own state removes the focused element", async () => {
    // The fourth attempt at this hook, and the one that stopped assuming React's tree matched
    // the DOM's. Attempt three asked its question from a no-dependency `useEffect` in `App`,
    // which runs after every commit OF APP — and a state update starts rendering at the fiber
    // that owns the state, not at the root. `RosterModal` owns `rules`; removing a rule never
    // re-renders `App`, so the one mechanism that was supposed to have closed the class did not
    // run at all here. The rescue now watches the DOM, which has no opinion about whose state
    // caused the removal.
    render(<App />);
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: "Ana\nBen\nChen\nDee\nEli" },
    });
    fireEvent.click(screen.getByText(/Buddy rules/));
    fireEvent.click(screen.getByText("+ Add a buddy rule"));
    const remove = screen.getByLabelText("Remove rule 1");
    remove.focus();
    expect(document.activeElement).toBe(remove);
    fireEvent.click(remove);
    // `await`, not a bare assertion: a MutationObserver delivers on a microtask after the batch,
    // which is the property that lets it see React's remove-then-insert sequences settled.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    // ...and to a reachable anchor, not just to anything. The roster field is the landing spot
    // while the dialog owns the screen.
    expect(document.activeElement).toBe(screen.getByLabelText("Roster names"));
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

describe("a refusal is both contained and announced", () => {
  it("puts the reason INSIDE the dialog rather than in an inert toast", () => {
    // These two requirements were in direct conflict and the conflict was invisible. Round 8
    // wrapped the toast in `inert` so Tab could not escape an aria-modal dialog into it — correct,
    // and `inert` also removes the element from the ACCESSIBILITY TREE, so a refusal shown there
    // in the same commit that opened the dialog was never announced at all. The message belongs
    // to the dialog that is explaining itself.
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
    // ...and it is inside a live region that was already mounted, not one that arrived with it.
    expect(reason.closest('[aria-live]')).not.toBeNull();
    // Nothing about the containment regressed: the dialog is not itself inert.
    expect(dialog.closest("[inert]")).toBeNull();
    expect(document.querySelector("#app")?.hasAttribute("inert")).toBe(true);
  });

  it("still uses the toast when no dialog will open to carry the message", () => {
    // An error WITH a graph on screen does not reopen the editor, so there is no dialog to be
    // contained by and the toast is both visible and announced.
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
