// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
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

  // Class: a transient notice must not outlive the text it described — EVERY text-replacing action
  // (type, try-example, file read) clears it, not only the path that raised it.
  const raiseTruncation = () => {
    fireEvent.change(screen.getByLabelText("Roster names"), { target: { value: "x".repeat(MAX_PARSE_CHARS + 5000) } });
    expect(screen.getByText(/characters were kept/i)).toBeTruthy();
  };

  it("clears the truncation notice when new text is typed", () => {
    renderModal();
    raiseTruncation();
    fireEvent.change(screen.getByLabelText("Roster names"), { target: { value: "Alice\nBob" } });
    expect(screen.queryByText(/characters were kept/i)).toBeNull();
  });

  it("clears the truncation notice when 'try example names' replaces the text", () => {
    renderModal();
    raiseTruncation();
    fireEvent.click(screen.getByRole("button", { name: /try example names/i }));
    expect(screen.queryByText(/characters were kept/i)).toBeNull();
  });

  it("clears a stale file-error notice when the roster is replaced (try example names)", async () => {
    const { container } = renderModal();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const oversized = new File(["x".repeat(9_000_000)], "big.txt", { type: "text/plain" }); // over the 8 MB gate
    fireEvent.change(fileInput, { target: { files: [oversized] } });
    await waitFor(() => expect(screen.getByText(/too large/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /try example names/i }));
    expect(screen.queryByText(/too large/i)).toBeNull(); // the red error doesn't outlive the sample text
  });
});
