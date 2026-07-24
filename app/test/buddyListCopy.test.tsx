// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { buildBuddyGraph } from "ringweave";
import { buddyLabel, DEFAULT_SETTINGS, viewFromResult } from "../src/model";
import { importGraph } from "../src/io/importGraph";
import BuddyList from "../src/panels/BuddyList";

// Capture what the Copy button writes to the clipboard without touching the real navigator.
const copyText = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../src/io/download", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/io/download")>();
  return { ...mod, copyText }; // keep neutralizeCell/toCsv real; only intercept the sink
});

beforeEach(() => copyText.mockClear());

describe("BuddyList Copy neutralizes formula-injecting names (parity with CSV)", () => {
  it("prefixes a name starting with '=' so a pasted cell isn't a live formula", async () => {
    // A hostile-but-valid imported name: non-empty, unique, no comma/newline -> passes import.
    const roster = ['=HYPERLINK("http://evil","x")', "Bob", "Cara", "Dana"];
    const view = viewFromResult(roster, DEFAULT_SETTINGS, buildBuddyGraph(4, 2, { seed: 1 }));

    render(<BuddyList view={view} selected={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    const text = copyText.mock.calls[0][0] as string;
    // The line for the hostile person must begin with the apostrophe guard, not a bare '='.
    expect(text.split("\n")[0]).toMatch(/^'=HYPERLINK/);
  });

  it("copies the SAME buddy projection the list shows (buddyLabel), incl. an isolated person", async () => {
    // triangle + isolated vertex: person 3 has no buddies -> must copy '—', not an empty tail.
    const view = importGraph({ version: 1, people: [0, 1, 2, 3].map((id) => ({ id, name: `P${id}` })), edges: [[0, 1], [1, 2], [2, 0]] });

    render(<BuddyList view={view} selected={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    const lines = (copyText.mock.calls[0][0] as string).split("\n");
    view.names.forEach((name, i) => {
      expect(lines[i]).toBe(`${name}: ${buddyLabel(view, i)}`); // separator AND empty glyph shared
    });
    expect(lines[3]).toBe("P3: —"); // the isolated person copies the em dash, not "P3: "
  });
});
