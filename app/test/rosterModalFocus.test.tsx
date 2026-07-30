// @vitest-environment jsdom
/**
 * The setup dialog's two obligations to a keyboard user: Tab stays inside it, and a refusal that
 * asks for a buddy-rule edit does not leave those rows behind a closed disclosure.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import RosterModal from "../src/panels/RosterModal";
import { DEFAULT_SETTINGS } from "../src/model";

afterEach(cleanup);

function paint(props: Partial<Parameters<typeof RosterModal>[0]> = {}) {
  render(
    <RosterModal
      initialText=""
      settings={DEFAULT_SETTINGS}
      rules={[]}
      canCancel={false}
      onGenerate={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  );
  return document.querySelector("#modal") as HTMLElement;
}

/** Every control the browser's own tab order would visit, in order. */
function tabbable(root: HTMLElement): HTMLElement[] {
  const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
    ' textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(sel)].filter((el) => {
    if (el.closest("details:not([open])") !== null && el.closest("summary") === null) return false;
    for (let a: HTMLElement | null = el; a; a = a.parentElement) {
      if (getComputedStyle(a).display === "none") return false;
    }
    return true;
  });
}

describe("Tab cannot leave the setup dialog", () => {
  it("wraps from the last control to the first", () => {
    // `inert` on the page behind stops Tab walking INTO it, which is a different guarantee: with
    // everything else inert or unmounted the native order runs out here and the next Tab lands in
    // the browser's own chrome, with no script-driven way back.
    const modal = paint();
    const items = tabbable(modal);
    expect(items.length, "no controls means nothing to wrap").toBeGreaterThan(2);

    items[items.length - 1].focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("wraps backwards from the first control to the last", () => {
    const modal = paint();
    const items = tabbable(modal);
    items[0].focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("leaves a Tab in the middle of the dialog to the browser", () => {
    // Non-vacuity in the other direction: a hook that hijacked every Tab would pass both wraps
    // above while destroying the ordinary tab order.
    const modal = paint();
    const items = tabbable(modal);
    items[0].focus();
    const handled = fireEvent.keyDown(document, { key: "Tab" });
    expect(handled, "the event was cancelled mid-dialog").toBe(true);
    expect(document.activeElement).toBe(items[0]); // untouched: the browser moves it, not us
  });

  it("counts no control inside a closed disclosure", () => {
    // A closed <details> keeps its contents in the DOM and out of the tab order. Counting them
    // puts "the last control" somewhere Tab never reaches, and the wrap then never fires.
    const modal = paint();
    const inside = modal.querySelector<HTMLElement>(".rules-block .rule-acts .linklike");
    expect(inside, "fixture must have a control behind the disclosure").not.toBeNull();
    expect(tabbable(modal)).not.toContain(inside);

    const last = tabbable(modal).at(-1)!;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(tabbable(modal)[0]);
  });
});

describe("a refusal about a buddy rule opens the rules", () => {
  it("shows the rows the message is asking the user to edit", () => {
    // Asserts the DISCLOSURE, not the presence of the row: jsdom renders a closed <details>'s
    // contents like any other subtree, so `getByText` finds the row either way and would pass with
    // the disclosure removed entirely.
    paint({ reopenReason: "Alice and Ben are set to be buddies and to never be buddies — pick one.", reopenOnRules: true });
    const details = document.querySelector("details.rules-block") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(screen.getByText("+ Add a buddy rule")).toBeTruthy();
  });

  it("leaves them closed for a refusal that is about the roster instead", () => {
    paint({ reopenReason: "That roster has 2000000 people — the limit is 1000000.", reopenOnRules: false });
    const details = document.querySelector("details.rules-block") as HTMLDetailsElement;
    expect(details.open).toBe(false);
  });

  it("lets the user close it again", () => {
    // `<details open={prop}>` springs back open on the next re-render, so the prop can only decide
    // the INITIAL value.
    paint({ reopenReason: "…", reopenOnRules: true });
    const details = document.querySelector("details.rules-block") as HTMLDetailsElement;
    details.open = false;
    fireEvent(details, new Event("toggle", { bubbles: false }));
    fireEvent.change(screen.getByLabelText("Roster names"), { target: { value: "Ana\nBen" } });
    expect(details.open).toBe(false);
  });
});
