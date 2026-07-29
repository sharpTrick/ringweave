// @vitest-environment jsdom
/**
 * `useFocusRescue` on its own, driven directly rather than through `App`.
 *
 * The rescue's three conditions are all about TIMING — what had focus, whether it survived, and
 * whether an anchor existed at the microtask the mutation was delivered — and driving them through
 * `App` means driving them through whatever sequence of commits `App` happens to produce. Two of
 * the three defects fixed here were invisible that way: one because `App`'s anchor is always
 * available by the time its own commits settle, and one because it only strands focus when the
 * anchor is briefly behind `inert`, which is a race the app wins or loses by milliseconds.
 *
 * So this file owns the hook's contract and `appErrorRecovery.test.tsx` owns the wiring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { useFocusRescue } from "../src/state/useFocusRescue";

afterEach(() => {
  cleanup();
  // The harness appends bare elements to <body>, which `cleanup` does not own. Left in place they
  // leak between tests, and every assertion here is about which element holds focus.
  document.body.replaceChildren();
});

/** A host that owns a removable victim and an anchor whose availability the test controls. */
function Harness({ anchor }: { anchor: () => HTMLElement | null }) {
  useFocusRescue(anchor);
  return null;
}

function mount(anchor: () => HTMLElement | null) {
  render(<Harness anchor={anchor} />);
}

/** An element in the document that can take focus and be removed on demand. */
function addButton(id: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.id = id;
  document.body.appendChild(b);
  return b;
}

describe("useFocusRescue", () => {
  it("rescues when the focused element is removed", async () => {
    const anchor = addButton("anchor");
    const victim = addButton("victim");
    mount(() => anchor);
    victim.focus();
    expect(document.activeElement).toBe(victim);

    act(() => victim.remove());
    await waitFor(() => expect(document.activeElement).toBe(anchor));
  });

  it("does NOT rescue when the focused element is still in the document", async () => {
    // The defect this closes, reported from a phone: tapping a graph node blurs to <body>
    // (SVG is not focusable) and then a panel mounts, which is a childList mutation. The hook
    // used to read "<body> plus a mutation" as "the user's footing was removed" and drag focus
    // to the anchor — which, being a text input at the time, raised the soft keyboard.
    const anchor = addButton("anchor");
    const parked = addButton("parked");
    mount(() => anchor);
    parked.focus();
    parked.blur(); // deliberate: the element survives
    expect(document.activeElement).toBe(document.body);

    act(() => { document.body.appendChild(document.createElement("div")); });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(document.body);
  });

  it("retries on a later mutation when no anchor was available at the removal", async () => {
    // The defect the FIRST version of the fix introduced, and the reason it survived the browser
    // checks: focus stranded on <body> is not a text input either, so a check asking only "did the
    // keyboard come up" passed on a rescue that never happened. In the app this is finishing a
    // generation — the busy overlay's Cancel button is removed while `#app` is still `inert`, so
    // nothing is reachable at that microtask, and a hook that disarms on the attempt has nothing
    // left when `inert` lifts one commit later.
    let anchor: HTMLElement | null = null;
    const victim = addButton("victim");
    mount(() => anchor);
    victim.focus();

    act(() => victim.remove());
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(document.body); // nothing to rescue to, yet

    const late = addButton("late-anchor");
    anchor = late;
    act(() => { document.body.appendChild(document.createElement("div")); });
    await waitFor(() => expect(document.activeElement).toBe(late));
  });

  it("does not grab focus on a cold load, when nothing was ever focused", async () => {
    const anchor = addButton("anchor");
    mount(() => anchor);
    expect(document.activeElement).toBe(document.body);

    act(() => { document.body.appendChild(document.createElement("div")); });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(document.body);
  });

  it("re-arms after a successful rescue, so a chain of removals stays rescuable", async () => {
    const first = addButton("first-anchor");
    const second = addButton("second-anchor");
    let anchor: HTMLElement = first;
    const victim = addButton("victim");
    mount(() => anchor);
    victim.focus();

    act(() => victim.remove());
    await waitFor(() => expect(document.activeElement).toBe(first));

    // Now remove the element the rescue just focused. A hook that cleared its own state on
    // success would be disarmed here — which is a real sequence, since a rescue lands on
    // whatever survived the last commit and the next commit may remove that too.
    anchor = second;
    act(() => first.remove());
    await waitFor(() => expect(document.activeElement).toBe(second));
  });
});
