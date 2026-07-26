// @vitest-environment jsdom
/**
 * F7 through the UI: the rule editor in the roster modal.
 *
 * The acceptance criterion is that prohibited rules are always respected and
 * required rules are either satisfied or refused with a specific, actionable
 * message — never a silent partial. The generator side of that is covered in
 * generateWorker.test.ts; this covers the half a user actually touches, including
 * the two ways a rule can go wrong here: an impossible set, and a rule whose
 * person was removed from the roster.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import RosterModal from "../src/panels/RosterModal";
import { DEFAULT_SETTINGS } from "../src/model";
import { toNamedPairs, type ConstraintPair, type NamedPair } from "../src/constraints";

afterEach(cleanup);

const ROSTER = ["Alice", "Ben", "Chloe", "Dev", "Eve", "Fran"];

function renderModal(overrides: Partial<{ rules: NamedPair[] }> = {}) {
  // Always a Mock, never a union with a plain function — otherwise `.mock` is not
  // reachable on the returned value, which is the only reason callers want it.
  const onGenerate =
    vi.fn<(n: string[], s: typeof DEFAULT_SETTINGS, c: ConstraintPair[], r: NamedPair[]) => void>();
  render(
    <RosterModal
      initialText={ROSTER.join("\n")}
      settings={DEFAULT_SETTINGS}
      rules={overrides.rules ?? []}
      canCancel={false}
      onGenerate={onGenerate}
      onCancel={() => {}}
    />,
  );
  return { onGenerate };
}

const addRule = () => fireEvent.click(screen.getByText("+ Add a buddy rule"));
const setRow = (row: number, a: string, b: string, kind?: string) => {
  fireEvent.change(screen.getByLabelText(`Rule ${row}, first person`), { target: { value: a } });
  fireEvent.change(screen.getByLabelText(`Rule ${row}, second person`), { target: { value: b } });
  if (kind) fireEvent.change(screen.getByLabelText(`Rule ${row}, kind`), { target: { value: kind } });
};

describe("the buddy-rule editor", () => {
  it("hands generate the resolved index pairs", () => {
    const { onGenerate } = renderModal();
    addRule();
    setRow(1, "Alice", "Dev");
    addRule();
    setRow(2, "Ben", "Chloe", "prohibited");

    fireEvent.click(screen.getByText("Generate buddy graph"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate.mock.calls[0][2]).toEqual([
      { a: 0, b: 3, kind: "required" },
      { a: 1, b: 2, kind: "prohibited" },
    ]);
  });

  it("seeds itself from the rules already in force", () => {
    renderModal({ rules: toNamedPairs([{ a: 1, b: 4, kind: "prohibited" }], ROSTER) });
    expect((screen.getByLabelText("Rule 1, first person") as HTMLInputElement).value).toBe("Ben");
    expect((screen.getByLabelText("Rule 1, second person") as HTMLInputElement).value).toBe("Eve");
    expect((screen.getByLabelText("Rule 1, kind") as HTMLSelectElement).value).toBe("prohibited");
  });

  it("blocks generation on an impossible rule set, naming the person", () => {
    const { onGenerate } = renderModal();
    // Five required buddies for Alice against the default of 4.
    ["Ben", "Chloe", "Dev", "Eve", "Fran"].forEach((other, i) => {
      addRule();
      setRow(i + 1, "Alice", other);
    });

    const button = screen.getByText("Generate buddy graph") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Alice has 5 must-be-buddies rules/)).toBeTruthy();
    fireEvent.click(button);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("says so when a rule's person is no longer in the roster", () => {
    renderModal({ rules: toNamedPairs([{ a: 0, b: 5, kind: "required" }], ROSTER) });
    // Remove Fran from the roster text; the rule naming her can no longer apply.
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: ROSTER.slice(0, 5).join("\n") },
    });
    expect(screen.getByText(/1 buddy rule names someone who isn't in this roster/)).toBeTruthy();
  });

  it("keeps a rule pointing at the same people when the roster is reordered", () => {
    const { onGenerate } = renderModal({ rules: toNamedPairs([{ a: 0, b: 5, kind: "required" }], ROSTER) });
    // Alice moves from position 0 to position 5 and Fran from 5 to 0. A positional
    // pair would still say {0,5} and mean the same two people only by luck; the
    // real test is a reorder that is NOT a simple swap.
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: ["Ben", "Chloe", "Alice", "Dev", "Fran", "Eve"].join("\n") },
    });
    fireEvent.click(screen.getByText("Generate buddy graph"));
    expect(onGenerate.mock.calls[0][2]).toEqual([{ a: 2, b: 4, kind: "required" }]);
  });

  it("flags an unrecognised name in a row without deleting the row", () => {
    renderModal();
    addRule();
    setRow(1, "Alice", "Nobody");
    const second = screen.getByLabelText("Rule 1, second person");
    expect(second.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Rule 1, first person").getAttribute("aria-invalid")).toBeNull();
    // The row survives — the user is mid-edit.
    expect((second as HTMLInputElement).value).toBe("Nobody");
  });

  it("removes a rule row", () => {
    renderModal({ rules: toNamedPairs([{ a: 0, b: 1, kind: "required" }], ROSTER) });
    fireEvent.click(screen.getByLabelText("Remove rule 1"));
    expect(screen.queryByLabelText("Rule 1, first person")).toBeNull();
  });

  it("offers every roster name as a datalist option, once", () => {
    renderModal();
    addRule();
    const options = Array.from(document.querySelectorAll("datalist option"));
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(ROSTER);
  });
});

describe("rules survive the round trip through Generate", () => {
  it("keeps a row naming someone outside the roster instead of deleting it", () => {
    // The editor's stated contract is that an unrecognised row is kept and flagged,
    // "because the user is mid-edit". That held while the modal was open and then broke on
    // Generate: only the RESOLVED index pairs were handed back, so a row naming someone not
    // in the roster had no index to survive as, and reopening "Edit people" could not show
    // it again. The row was silently deleted by the act of generating.
    const { onGenerate } = renderModal();
    addRule();
    setRow(1, "Alice", "Nobody");
    addRule();
    setRow(2, "Ben", "Chloe", "prohibited");

    fireEvent.click(screen.getByText("Generate buddy graph"));
    const [, , resolvedPairs, rows] = onGenerate.mock.calls[0];
    // Only the resolvable rule becomes an index pair...
    expect(resolvedPairs).toEqual([{ a: 1, b: 2, kind: "prohibited" }]);
    // ...but BOTH rows come back, so the editor can redisplay exactly what was typed.
    expect(rows).toEqual([
      { a: "Alice", b: "Nobody", kind: "required" },
      { a: "Ben", b: "Chloe", kind: "prohibited" },
    ]);
  });

  it("redisplays the unresolved row when the editor is reopened", () => {
    // The rows the previous test captured, handed straight back — which is what App now
    // stores. Reconstructing them from index pairs is what could not represent this row.
    renderModal({
      rules: [
        { a: "Alice", b: "Nobody", kind: "required" },
        { a: "Ben", b: "Chloe", kind: "prohibited" },
      ],
    });
    expect((screen.getByLabelText("Rule 1, second person") as HTMLInputElement).value).toBe("Nobody");
    expect(screen.getByLabelText("Rule 1, second person").getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText("Rule 2, first person") as HTMLInputElement).value).toBe("Ben");
  });
});

describe("a row still being typed is not a broken rule", () => {
  it("does not claim an empty row names a missing person", () => {
    // `resolveNamedPairs` looked `""` up like any other name, so the modal announced
    // "names someone who isn't in this roster" the instant a row was added — while the editor's
    // own `unknownName` deliberately exempts empty text and left the row unflagged. Two views of
    // one row, disagreeing, and the wrong one was the one that spoke.
    renderModal();
    addRule();
    expect(screen.queryByText(/isn't in this roster/)).toBeNull();
    expect(screen.getByText(/still missing a name/)).toBeTruthy();
  });

  it("still reports a genuinely unknown name", () => {
    // The exemption must not swallow the real case it was carved out of.
    renderModal();
    addRule();
    setRow(1, "Alice", "Nobody");
    expect(screen.getByText(/isn't in this roster/)).toBeTruthy();
  });
});
