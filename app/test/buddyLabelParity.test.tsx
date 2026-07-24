// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { buddyLabel } from "../src/model";
import { importGraph } from "../src/io/importGraph";
import BuddyList from "../src/panels/BuddyList";
import Slips from "../src/panels/Slips";

describe("buddyLabel unit", () => {
  it("joins buddy names with ', ' and shows an em dash for none", () => {
    // triangle + isolated vertex: person 3 has no buddies.
    const view = importGraph({ version: 1, people: [0, 1, 2, 3].map((id) => ({ id, name: `P${id}` })), edges: [[0, 1], [1, 2], [2, 0]] });
    expect(buddyLabel(view, 0)).toBe("P1, P2");
    expect(buddyLabel(view, 3)).toBe("—");
  });
});

// Class: the on-screen buddy list and the printed slips must render the SAME projection for
// every person — a divergent separator/empty-glyph would silently disagree. Both now route
// through buddyLabel; this pins them to it, including the isolated (0-buddy) case.
describe("BuddyList and Slips render identical buddy cells (via buddyLabel)", () => {
  it("agree with buddyLabel for every person, incl. an isolated one", () => {
    const view = importGraph({ version: 1, people: [0, 1, 2, 3].map((id) => ({ id, name: `P${id}` })), edges: [[0, 1], [1, 2], [2, 0]] });

    const list = render(<BuddyList view={view} selected={null} onSelect={() => {}} />);
    const rowCells = [...list.container.querySelectorAll(".brow .bd")].map((el) => el.textContent);

    const slips = render(<Slips view={view} />);
    const slipCells = [...slips.container.querySelectorAll(".slip .buddies")].map((el) => el.textContent);

    const expected = view.names.map((_, i) => buddyLabel(view, i));
    expect(rowCells).toEqual(expected);
    expect(slipCells).toEqual(expected);
    expect(rowCells).toEqual(slipCells); // the two sinks never disagree
  });
});
