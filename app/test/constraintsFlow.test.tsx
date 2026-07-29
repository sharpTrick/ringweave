// @vitest-environment jsdom
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
    fireEvent.change(screen.getByLabelText("Roster names"), {
      target: { value: ROSTER.slice(0, 5).join("\n") },
    });
    expect(screen.getByText(/1 buddy rule names someone who isn't in this roster/)).toBeTruthy();
  });

  it("keeps a rule pointing at the same people when the roster is reordered", () => {
    const { onGenerate } = renderModal({ rules: toNamedPairs([{ a: 0, b: 5, kind: "required" }], ROSTER) });
    // Not a simple swap: a swap would leave a positional pair saying {0,5} and still meaning
    // the same two people, by luck.
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
    const { onGenerate } = renderModal();
    addRule();
    setRow(1, "Alice", "Nobody");
    addRule();
    setRow(2, "Ben", "Chloe", "prohibited");

    fireEvent.click(screen.getByText("Generate buddy graph"));
    const [, , resolvedPairs, rows] = onGenerate.mock.calls[0];
    expect(resolvedPairs).toEqual([{ a: 1, b: 2, kind: "prohibited" }]);
    expect(rows).toEqual([
      { a: "Alice", b: "Nobody", kind: "required" },
      { a: "Ben", b: "Chloe", kind: "prohibited" },
    ]);
  });

  it("redisplays the unresolved row when the editor is reopened", () => {
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
    renderModal();
    addRule();
    expect(screen.queryByText(/isn't in this roster/)).toBeNull();
    expect(screen.getByText(/still missing a name/)).toBeTruthy();
  });

  it("still reports a genuinely unknown name", () => {
    renderModal();
    addRule();
    setRow(1, "Alice", "Nobody");
    // The AGGREGATE note specifically: each flagged field also carries its own per-row reason,
    // so a looser match would find two things and pass on either.
    expect(screen.getByText(/buddy rule.* names? someone who isn't in this roster/)).toBeTruthy();
  });
});

describe("a flagged rule row carries its own reason", () => {
  it("points the flagged field at a description that names the person", () => {
    renderModal();
    addRule();
    setRow(1, "Alice", "Zoe");

    const flagged = screen.getByLabelText("Rule 1, second person");
    expect(flagged.getAttribute("aria-invalid")).toBe("true");
    // The NAME is unchanged — that is the control's identity, and it must not move as the user
    // types. The reason rides on the description, which is the part allowed to vary.
    const describedBy = flagged.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy!);
    expect(description?.textContent).toMatch(/Zoe.*isn't in this roster/);

    // The matched field points at nothing — a reason on every field explains nothing.
    const ok = screen.getByLabelText("Rule 1, first person");
    expect(ok.getAttribute("aria-invalid")).toBeNull();
    expect(ok.getAttribute("aria-describedby")).toBeNull();
  });
});
