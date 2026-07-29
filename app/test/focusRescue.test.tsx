// @vitest-environment jsdom
/**
 * `useFocusRescue` driven directly rather than through `App`: its three conditions are all
 * about TIMING, and through `App` they can only be driven by whatever sequence of commits
 * `App` happens to produce.
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

function Harness({ anchor }: { anchor: () => HTMLElement | null }) {
  useFocusRescue(anchor);
  return null;
}

function mount(anchor: () => HTMLElement | null) {
  render(<Harness anchor={anchor} />);
}

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

    anchor = second;
    act(() => first.remove());
    await waitFor(() => expect(document.activeElement).toBe(second));
  });
});
