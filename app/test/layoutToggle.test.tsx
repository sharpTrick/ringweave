// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LAYOUT_MODES } from "../src/graph/GraphCanvas";
import LayoutToggle from "../src/panels/LayoutToggle";

afterEach(cleanup);

// Class: LAYOUT_MODES is the load-bearing source of selectable layouts — the toggle renders
// exactly one control per mode, so adding a mode there genuinely opens the UI (not just a comment).
describe("LayoutToggle is driven by LAYOUT_MODES", () => {
  it("renders exactly one button per mode, title-cased, with the active one marked", () => {
    render(<LayoutToggle layout="ring" onChange={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(LAYOUT_MODES.length);
    LAYOUT_MODES.forEach((m, i) => {
      expect(buttons[i].textContent).toBe(m[0].toUpperCase() + m.slice(1)); // "Ring"/"Force"
      expect(buttons[i].className).toContain(m); // CSS hook is the mode name
    });
    const active = buttons[LAYOUT_MODES.indexOf("ring")];
    expect(active.className).toContain("on"); // the selected mode is marked
  });

  it("calls onChange with the mode when its button is clicked", () => {
    const onChange = vi.fn();
    render(<LayoutToggle layout="ring" onChange={onChange} />);
    for (const m of LAYOUT_MODES) {
      fireEvent.click(screen.getByRole("button", { name: m[0].toUpperCase() + m.slice(1) }));
      expect(onChange).toHaveBeenCalledWith(m);
    }
  });
});
