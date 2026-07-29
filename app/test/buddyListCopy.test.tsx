// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { buddyLabel, DEFAULT_SETTINGS, viewFromResult } from "../src/model";
import { generateResult } from "./helpers";
import { importGraph } from "../src/io/importGraph";
import BuddyList from "../src/panels/BuddyList";

// Capture what the Copy button writes to the clipboard without touching the real navigator.
// Typed by its ARGS. An untyped mock's `mock.calls` is an array of EMPTY tuples, so
// reading calls[0][0] is a type error whose only escape is a cast asserting a shape
// nobody checked — and the whole point of typechecking the suite is to stop that.
const copyText = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>(async () => true));
vi.mock("../src/io/download", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/io/download")>();
  return { ...mod, copyText }; // keep neutralizeCell/toCsv real; only intercept the sink
});

beforeEach(() => copyText.mockClear());

describe("BuddyList Copy neutralizes formula-injecting names (parity with CSV)", () => {
  it("prefixes a name starting with '=' so a pasted cell isn't a live formula", async () => {
    // A hostile-but-valid imported name: non-empty, unique, no comma/newline -> passes import.
    const roster = ['=HYPERLINK("http://evil","x")', "Bob", "Cara", "Dana"];
    const view = viewFromResult(roster, DEFAULT_SETTINGS, [], [], generateResult(4, 2, { seed: 1 }));

    render(<BuddyList view={view} selected={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    // `String(...)` rather than a cast: the mock is untyped, and asserting a type we
    // have not checked is how a test starts lying about what it received.
    const text = copyText.mock.calls[0]?.[0] ?? "";
    // The line for the hostile person must begin with the apostrophe guard, not a bare '='.
    expect(text.split("\n")[0]).toMatch(/^'=HYPERLINK/);
  });

  it("copies the SAME buddy projection the list shows (buddyLabel), incl. an isolated person", async () => {
    // triangle + isolated vertex: person 3 has no buddies -> must copy '—', not an empty tail.
    const view = importGraph({ version: 1, people: [0, 1, 2, 3].map((id) => ({ id, name: `P${id}` })), edges: [[0, 1], [1, 2], [2, 0]] });

    render(<BuddyList view={view} selected={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    const lines = (copyText.mock.calls[0]?.[0] ?? "").split("\n");
    view.names.forEach((name, i) => {
      expect(lines[i]).toBe(`${name}: ${buddyLabel(view, i)}`); // separator AND empty glyph shared
    });
    expect(lines[3]).toBe("P3: —"); // the isolated person copies the em dash, not "P3: "
  });
});

describe("a repeated Copy is announced again, not silently", () => {
  it("empties and refills the live region on every successful copy", async () => {
    // The region's text is the only feedback a screen-reader user gets, and a live region
    // announces a CHANGE. Setting the identical string on a second press is no DOM mutation at
    // all — and the second press is exactly the one a user makes when unsure the first
    // registered, since the clipboard write is awaited and nothing else is synchronous.
    //
    // Asserted by WATCHING the region rather than by reading the final markup, because the final
    // markup is identical either way — which is how this survived fifteen rounds, and which is
    // the lesson from the round-12 "fix" that could not be observed to have worked.
    const view = viewFromResult(["A", "B", "C", "D"], DEFAULT_SETTINGS, [], [], generateResult(4, 2, { seed: 1 }));
    const { container } = render(<BuddyList view={view} selected={null} onSelect={() => {}} />);
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      seen.push(container.querySelector(".sr-live")?.textContent ?? "");
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    // Scoped to THIS render: the file's earlier tests do not clean up, so a global query would
    // find their buttons too.
    const ui = within(container);
    fireEvent.click(ui.getByRole("button", { name: /^copy$/i }));
    await waitFor(() => expect(container.querySelector(".sr-live")?.textContent).toMatch(/copied/i));
    const afterFirst = seen.length;
    // Press again while the label still reads "Copied" — inside the window, same string.
    fireEvent.click(ui.getByRole("button", { name: /copied/i }));
    await waitFor(() => expect(seen.length).toBeGreaterThan(afterFirst));
    observer.disconnect();

    // Two clipboard writes, and the region was emptied before each message so each is a change.
    expect(copyText).toHaveBeenCalledTimes(2);
    expect(seen.filter((t) => /copied/i.test(t)).length).toBeGreaterThanOrEqual(2);
    expect(seen.filter((t) => t === "").length).toBeGreaterThanOrEqual(2);
  });
});

describe("a newer confirmation is not cut short by an older one's timer", () => {
  it("keeps the second press's confirmation for its own full window", async () => {
    // Each press scheduled its own teardown and none cancelled the previous, so an earlier
    // press's 4 s timer cleared a LATER press's confirmation: press at 0 s, press again at 3 s,
    // and the label reverts at 4.2 s — 1.2 s into a window that should run to 7 s. The existing
    // tests press once, or twice inside one tick, so neither advances the clock across two
    // presses. `useNotice.flash` already had this guard; these are the app's two auto-clearing
    // confirmations and the second one did not.
    vi.useFakeTimers();
    try {
      const view = viewFromResult(["A", "B", "C", "D"], DEFAULT_SETTINGS, [], [], generateResult(4, 2, { seed: 1 }));
      const { container } = render(<BuddyList view={view} selected={null} onSelect={() => {}} />);
      const ui = within(container);
      const label = () => (container.querySelector(".chipbtn") as HTMLElement).textContent;

      fireEvent.click(ui.getByRole("button", { name: /^copy$/i }));
      // EVERY advance inside `act`: a timer-driven setState that React has not flushed never
      // reaches the DOM, so a test that reads `textContent` after a bare advance observes the
      // state before the timer — which made the first version of this test pass with the defect
      // still present. Verified by restoring the defect and watching it fail.
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(label()).toBe("Copied");

      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      fireEvent.click(ui.getByRole("button", { name: /copied/i }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(label()).toBe("Copied");

      // 1.2 s later the FIRST press's timer would have fired. The second press owns the window.
      await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
      expect(label()).toBe("Copied");
      expect(container.querySelector(".sr-live")?.textContent).toMatch(/copied/i);

      // ...and it does still end, on its own schedule.
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(label()).toBe("Copy");
      expect(container.querySelector(".sr-live")?.textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a copy that fails says so", () => {
  it("announces the failure and names the way out", async () => {
    // `copyText` resolves false on any clipboard-write rejection — insecure context, permission
    // denied, no Clipboard API, focus not in the document — and only the success branch did
    // anything: no label change, no live-region text, no toast. A screen-reader user pressing
    // Copy in that state heard nothing at all, and had no way to learn CSV exists.
    copyText.mockResolvedValueOnce(false);
    const view = viewFromResult(["A", "B", "C", "D"], DEFAULT_SETTINGS, [], [], generateResult(4, 2, { seed: 1 }));
    const { container } = render(<BuddyList view={view} selected={null} onSelect={() => {}} />);
    const ui = within(container);
    fireEvent.click(ui.getByRole("button", { name: /^copy$/i }));
    await waitFor(() =>
      expect(container.querySelector(".sr-live")?.textContent).toMatch(/couldn't copy/i),
    );
    expect(container.querySelector(".sr-live")?.textContent).toMatch(/CSV/);
    // The label does NOT claim success.
    expect((container.querySelector(".chipbtn") as HTMLElement).textContent).toBe("Copy");
  });
});
