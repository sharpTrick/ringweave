// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import QualityPanel from "../src/panels/QualityPanel";
import { generateResult } from "./helpers";
import {
  connectionSummary, constraintSummary, qualityPercent, separationShortfall, targetShortfall,
  viewFromResult, DEFAULT_SETTINGS, type GraphView,
} from "../src/model";
import type { ConstraintPair } from "../src/constraints";

afterEach(cleanup);

function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `P${i}`);
}

function view(n: number, k: number, rules: ConstraintPair[] = []): GraphView {
  const settings = { ...DEFAULT_SETTINGS, buddies: k };
  return viewFromResult(names(n), settings, rules, [], generateResult(n, k));
}

function paint(v: GraphView) {
  render(<QualityPanel view={v} onExport={vi.fn()} onImport={vi.fn()} />);
}

describe("QualityPanel", () => {
  it("shows the same numbers the model derives, not its own arithmetic", () => {
    const v = view(20, 4);
    paint(v);
    expect(screen.getByText(String(qualityPercent(v.metrics)))).toBeTruthy();
    expect(screen.getByText(connectionSummary(v.metrics))).toBeTruthy();
  });

  it("discloses a shortfall between what Settings asked for and what the graph delivered", () => {
    // Deleting either disclosure passes the rest of the suite, because nothing else renders this
    // panel — and a roster that silently received fewer buddies than asked is the whole reason
    // the line exists.
    const asked = 6;
    const v = view(7, asked);
    const shortfall = targetShortfall(v);
    expect(shortfall, "fixture must actually fall short, or this pins nothing").not.toBeNull();
    paint(v);
    // Both disclosures say "not the N in Settings", so the matcher has to name which one.
    expect(screen.getByText(/Each person has/)).toBeTruthy();
    expect(screen.getByText(/Each person has/).textContent).toContain(String(shortfall!.asked));
  });

  it("discloses a separation shortfall when the graph is tighter than Settings asked", () => {
    const v = view(12, 4);
    const separation = separationShortfall(v);
    expect(separation, "fixture must actually fall short, or this pins nothing").not.toBeNull();
    paint(v);
    expect(screen.getByText(/steps apart, not the/)).toBeTruthy();
  });

  it("renders the buddy-rule outcome the model produced, verbatim", () => {
    const rules: ConstraintPair[] = [{ a: 0, b: 1, kind: "required" }];
    const v = view(10, 4, rules);
    const line = constraintSummary(v);
    expect(line).not.toBeNull();
    paint(v);
    expect(screen.getByText(line!)).toBeTruthy();
  });

  it("says nothing about buddy rules when there are none", () => {
    paint(view(10, 4));
    expect(screen.queryByText(/buddy rule/)).toBeNull();
  });

  it("explains the quality number in the accessibility tree, not only on hover", () => {
    // `title` is a pointer affordance: the gauge is a non-focusable <div>, so a keyboard or
    // screen-reader user gets a bare unit-less integer with nothing saying what it measures.
    paint(view(20, 4));
    const gauge = document.querySelector(".gauge") as HTMLElement;
    const described = gauge.getAttribute("aria-label") ?? gauge.textContent ?? "";
    expect(described).toMatch(/quality/i);
    expect(described).toMatch(/%|percent/i);
  });
});
