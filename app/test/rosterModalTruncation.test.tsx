// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MAX_PARSE_CHARS, MAX_NAMES } from "../src/io/parseRoster";
import { DEFAULT_SETTINGS } from "../src/model";
import RosterModal from "../src/panels/RosterModal";

afterEach(cleanup); // this config has no global auto-cleanup; each test starts from a clean DOM

const renderModal = () =>
  render(
    <RosterModal
      initialText=""
      settings={DEFAULT_SETTINGS}
      canCancel={false}
      onGenerate={() => {}}
      onCancel={() => {}}
    />,
  );

// Class: an over-limit paste must ALWAYS produce a visible truncation notice — including the
// gap where fewer than MAX_NAMES distinct names hide the name-cap warning and capText's pre-cap
// hides parseRoster's char-warning. Both shapes below must notify.
describe("RosterModal surfaces truncation both ways", () => {
  it("a >MAX_PARSE_CHARS paste with few distinct names still shows a char-truncation notice", () => {
    renderModal();
    const huge = "x".repeat(MAX_PARSE_CHARS + 5000); // one long name -> under MAX_NAMES distinct
    fireEvent.change(screen.getByLabelText("Roster names"), { target: { value: huge } });
    expect(screen.getByText(/only the first .* characters were kept/i)).toBeTruthy();
  });

  it("a >MAX_NAMES distinct paste shows the name-cap notice", () => {
    renderModal();
    const many = Array.from({ length: MAX_NAMES + 200 }, (_, i) => `Person${i}`).join("\n");
    fireEvent.change(screen.getByLabelText("Roster names"), { target: { value: many } });
    expect(screen.getByText(/maximum/i)).toBeTruthy();
  });

  it("an in-bounds paste shows no truncation notice", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Roster names"), { target: { value: "Alice\nBob\nCara" } });
    expect(screen.queryByText(/characters were kept|maximum/i)).toBeNull();
  });
});
