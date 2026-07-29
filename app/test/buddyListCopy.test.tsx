// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    const view = viewFromResult(roster, DEFAULT_SETTINGS, [], generateResult(4, 2, { seed: 1 }));

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
    const view = viewFromResult(["A", "B", "C", "D"], DEFAULT_SETTINGS, [], generateResult(4, 2, { seed: 1 }));
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
