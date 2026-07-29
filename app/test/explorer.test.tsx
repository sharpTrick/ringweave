// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, act } from "@testing-library/react";
import { Graph } from "ringweave";
import PersonPanel from "../src/panels/PersonPanel";
import PersonSearch from "../src/panels/PersonSearch";
import { useExplorerHistory } from "../src/state/useExplorerHistory";
import { importGraph } from "../src/io/importGraph";
import type { GraphView } from "../src/model";

afterEach(cleanup);

/** A view plus its rehydrated Graph, built the way the app builds them. */
function fixture(names: string[], edges: [number, number][]): { view: GraphView; graph: Graph } {
  const view = importGraph({
    version: 1,
    people: names.map((name, id) => ({ id, name })),
    edges,
  });
  const graph = new Graph(names.length);
  for (const [a, b] of edges) graph.addEdge(a, b);
  return { view, graph };
}

// A 6-ring: everyone has two buddies, two people two steps away, furthest is 3.
const RING = fixture(
  ["Alice", "Ben", "Chloe", "Dev", "Eve", "Fran"],
  [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]],
);

function renderPanel(
  f: { view: GraphView; graph: Graph },
  index: number,
  extra: Partial<{
    canGoBack: boolean;
    onSelect: (i: number) => void;
    onBack: () => void;
    pathFrom: boolean;
    onFindPath: () => void;
  }> = {},
) {
  const onSelect = extra.onSelect ?? vi.fn();
  const onBack = extra.onBack ?? vi.fn();
  render(
    <PersonPanel
      view={f.view}
      graph={f.graph}
      index={index}
      canGoBack={extra.canGoBack ?? false}
      onSelect={onSelect}
      onBack={onBack}
      onClose={() => {}}
      pathFrom={extra.pathFrom ?? false}
      onFindPath={extra.onFindPath ?? (() => {})}
    />,
  );
  return { onSelect, onBack };
}

describe("PersonPanel", () => {
  it("lists buddies and two-steps-away separately", () => {
    renderPanel(RING, 0); // Alice: buddies Ben and Fran; two steps Chloe and Eve
    for (const name of ["Ben", "Fran", "Chloe", "Eve"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // Dev is three steps away and must not appear as a chip.
    expect(screen.queryByRole("button", { name: "Dev" })).toBeNull();
  });

  it("makes every name a real button that navigates", () => {
    const { onSelect } = renderPanel(RING, 0);
    fireEvent.click(screen.getByRole("button", { name: "Chloe" }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("reports how far the furthest person is", () => {
    renderPanel(RING, 0);
    expect(screen.getByText(/Everyone is within 3 steps of Alice\./)).toBeTruthy();
  });

  it("says the group is split rather than quoting a small reach", () => {
    // Two disjoint triangles: from Alice, three people are unreachable.
    const split = fixture(
      ["Alice", "Ben", "Chloe", "Dev", "Eve", "Fran"],
      [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3]],
    );
    renderPanel(split, 0);
    expect(screen.getByText(/can't be reached from Alice at all/)).toBeTruthy();
    expect(screen.queryByText(/Everyone is within/)).toBeNull();
  });

  it("says so plainly when someone has nobody", () => {
    const lonely = fixture(["Alice", "Ben", "Chloe"], [[1, 2]]);
    renderPanel(lonely, 0);
    expect(screen.getByText("No buddies yet")).toBeTruthy();
  });

  it("offers Back only when there is somewhere to go back to", () => {
    renderPanel(RING, 0, { canGoBack: false });
    expect(screen.queryByText("← Back")).toBeNull();
    cleanup();
    const { onBack } = renderPanel(RING, 0, { canGoBack: true });
    fireEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalled();
  });
});

/** Everything is a step, which is what the pre-existing cases below assume. */
const ALL_RELATED = () => true;

describe("useExplorerHistory", () => {
  it("walks forward and back through people", () => {
    const { result } = renderHook(() => useExplorerHistory(ALL_RELATED));
    expect(result.current.current).toBeNull();
    expect(result.current.canGoBack).toBe(false);

    act(() => result.current.select(2));
    expect(result.current.current).toBe(2);
    expect(result.current.canGoBack).toBe(false); // nowhere to go back TO yet

    act(() => result.current.select(5));
    expect(result.current.current).toBe(5);
    expect(result.current.canGoBack).toBe(true);

    act(() => result.current.back());
    expect(result.current.current).toBe(2);
    expect(result.current.canGoBack).toBe(false);
  });

  it("does not push a re-selection of the person already shown", () => {
    const { result } = renderHook(() => useExplorerHistory(ALL_RELATED));
    act(() => result.current.select(1));
    act(() => result.current.select(1));
    // Otherwise Back would appear enabled and then do nothing visible.
    expect(result.current.canGoBack).toBe(false);
  });

  it("never goes back past the first person", () => {
    const { result } = renderHook(() => useExplorerHistory(ALL_RELATED));
    act(() => result.current.select(3));
    act(() => result.current.back());
    expect(result.current.current).toBe(3);
  });

  it("clears the whole trail on deselect and on reset", () => {
    const { result } = renderHook(() => useExplorerHistory(ALL_RELATED));
    act(() => result.current.select(1));
    act(() => result.current.select(2));
    act(() => result.current.select(null));
    expect(result.current.current).toBeNull();
    expect(result.current.canGoBack).toBe(false);

    act(() => result.current.select(4));
    act(() => result.current.reset());
    expect(result.current.current).toBeNull();
  });

  it("starts a new trail when the person picked is not on the current card", () => {
    // Back is only meaningful along a trail the user walked. Jumping to someone the card in
    // front of them does not list — by search, by tapping the graph, from the buddy list — has
    // no relation to the card behind it, so Back would offer to return to an unrelated stranger.
    const related = (from: number, to: number) => from === 0 && to === 1;
    const { result } = renderHook(() => useExplorerHistory(related));
    act(() => result.current.select(0));
    act(() => result.current.select(1)); // a chip on 0's card
    expect(result.current.canGoBack).toBe(true);

    act(() => result.current.select(9)); // not on 1's card
    expect(result.current.current).toBe(9);
    expect(result.current.canGoBack).toBe(false);
  });

  it("keeps walking when each step is a chip on the card before it", () => {
    // Non-vacuity for the case above: the same hook must still build a trail, or "no back stack"
    // would pass by never having one.
    const chain = (from: number, to: number) => to === from + 1;
    const { result } = renderHook(() => useExplorerHistory(chain));
    for (const i of [0, 1, 2, 3]) act(() => result.current.select(i));
    expect(result.current.current).toBe(3);
    act(() => result.current.back());
    act(() => result.current.back());
    expect(result.current.current).toBe(1);
  });

  it("bounds the retained history", () => {
    const { result } = renderHook(() => useExplorerHistory(ALL_RELATED));
    for (let i = 0; i < 120; i++) act(() => result.current.select(i));
    expect(result.current.current).toBe(119);
    let steps = 0;
    while (result.current.canGoBack && steps < 200) {
      act(() => result.current.back());
      steps++;
    }
    expect(steps).toBeLessThan(60);
  });
});

describe("PersonSearch", () => {
  const NAMES = ["Alice Nguyen", "Ben Carter", "John Smith", "Jo Sanders"];

  const type = (value: string) =>
    fireEvent.change(screen.getByLabelText("Find a person"), { target: { value } });

  it("finds a person by a fuzzy query and selects them", () => {
    const onSelect = vi.fn();
    render(<PersonSearch names={NAMES} onSelect={onSelect} />);
    type("jsmi");
    fireEvent.click(screen.getByRole("option", { name: "John Smith" }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("is fully drivable from the keyboard", () => {
    const onSelect = vi.fn();
    render(<PersonSearch names={NAMES} onSelect={onSelect} />);
    const input = screen.getByLabelText("Find a person");
    type("j");
    // Two matches: "John Smith" (starts at 0) then "Jo Sanders".
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("points aria-activedescendant at the active row", () => {
    render(<PersonSearch names={NAMES} onSelect={() => {}} />);
    const input = screen.getByLabelText("Find a person");
    type("j");
    const first = screen.getAllByRole("option")[0];
    expect(input.getAttribute("aria-activedescendant")).toBe(first.id);
    expect(first.getAttribute("aria-selected")).toBe("true");
  });

  it("wraps around at both ends", () => {
    const onSelect = vi.fn();
    render(<PersonSearch names={NAMES} onSelect={onSelect} />);
    const input = screen.getByLabelText("Find a person");
    type("j");
    fireEvent.keyDown(input, { key: "ArrowUp" }); // from the first row, wrap to the last
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("says nobody matches instead of showing an empty box", () => {
    render(<PersonSearch names={NAMES} onSelect={() => {}} />);
    type("zzz");
    expect(screen.getByText(/Nobody matches/)).toBeTruthy();
  });

  it("clears its own query on Escape without letting it through", () => {
    // Listen on the document, because that is what a global Escape handler is —
    // and a wrapper element with a key handler is (correctly) an a11y-lint error.
    const onEscape = vi.fn();
    document.addEventListener("keydown", onEscape);
    try {
      render(<PersonSearch names={NAMES} onSelect={() => {}} />);
      const input = screen.getByLabelText("Find a person") as HTMLInputElement;
      type("john");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(input.value).toBe("");
      // The global handler must not also fire and clear the selection behind it.
      expect(onEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", onEscape);
    }
  });

  it("lets Escape through when there is no query to clear", () => {
    // After picking a result the box is empty but still focused. Swallowing Escape there would
    // silently disable the global handler, leaving route and selection unclearable by keyboard.
    const onEscape = vi.fn();
    document.addEventListener("keydown", onEscape);
    try {
      render(<PersonSearch names={NAMES} onSelect={() => {}} />);
      const input = screen.getByLabelText("Find a person") as HTMLInputElement;
      expect(input.value).toBe("");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onEscape).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", onEscape);
    }
  });

  it("lets Escape through once its own query has been cleared", () => {
    const onEscape = vi.fn();
    document.addEventListener("keydown", onEscape);
    try {
      render(<PersonSearch names={NAMES} onSelect={() => {}} />);
      const input = screen.getByLabelText("Find a person") as HTMLInputElement;
      type("john");
      fireEvent.keyDown(input, { key: "Escape" }); // clears the query, swallowed
      expect(onEscape).not.toHaveBeenCalled();
      fireEvent.keyDown(input, { key: "Escape" }); // nothing left to clear
      expect(onEscape).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", onEscape);
    }
  });

  it("shows no list at all until something is typed", () => {
    render(<PersonSearch names={NAMES} onSelect={() => {}} />);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
