// @vitest-environment jsdom
/**
 * F10: the path finder, its highlight model, and the M2 non-regression guard.
 *
 * The highlight refactor replaced a one-focus scheme with a tagged union, and the
 * riskiest part of that is not the new route mode — it is silently changing what
 * M2 already drew. The first block is therefore a table pinning every class
 * string the old scheme produced, checked against the new one with no route
 * active.
 *
 * Acceptance: the path matches BFS, ties break deterministically, and Escape
 * clears it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, act } from "@testing-library/react";
import { Graph, bfsDistances, shortestPath } from "ringweave";
import { buildHighlight, nodeClass, edgeClass } from "../src/graph/highlight";
import { usePathFinder } from "../src/state/usePathFinder";
import { useEscape } from "../src/state/useEscape";
import PathPanel from "../src/panels/PathPanel";
import { importGraph } from "../src/io/importGraph";

afterEach(cleanup);

const NAMES = ["Ana", "Ben", "Chen", "Dia", "Eli", "Fay"];
// A 6-ring: 0-1-2-3-4-5-0.
const RING_EDGES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]];
const ADJ = [[1, 5], [0, 2], [1, 3], [2, 4], [3, 5], [4, 0]];

function graphOf(n: number, edges: [number, number][]): Graph {
  const g = new Graph(n);
  for (const [a, b] of edges) g.addEdge(a, b);
  return g;
}

describe("highlight: M2 behaviour is unchanged when no route is active", () => {
  it("classes nothing when nothing is focused", () => {
    const h = buildHighlight(ADJ, null, null, null);
    expect(nodeClass(h, 0)).toBe("node");
    expect(edgeClass(h, 0, 1)).toBe("edge");
  });

  it("reproduces the exact M2 node classes around a focus", () => {
    const h = buildHighlight(ADJ, 0, null, null);
    // Focus 0; buddies 1 and 5; two-steps 2 and 4; 3 is beyond.
    expect([0, 1, 2, 3, 4, 5].map((i) => nodeClass(h, i))).toEqual([
      "node sel",
      "node hi",
      "node hi2",
      "node faded",
      "node hi2",
      "node hi",
    ]);
  });

  it("reproduces the exact M2 edge classes around a focus", () => {
    const h = buildHighlight(ADJ, 0, null, null);
    expect(RING_EDGES.map(([u, v]) => edgeClass(h, u, v))).toEqual([
      "edge lit", // 0-1 touches the focus
      "edge lit2", // 1-2 touches a two-step
      "edge lit2", // 2-3 touches a two-step
      "edge lit2", // 3-4 touches a two-step
      "edge lit2", // 4-5 touches a two-step
      "edge lit", // 5-0 touches the focus
    ]);
  });

  it("keeps hover beating selection, as M2 did", () => {
    const h = buildHighlight(ADJ, 0, 3, null);
    expect(h.kind).toBe("neighborhood");
    expect(nodeClass(h, 3)).toBe("node sel");
    expect(nodeClass(h, 0)).toBe("node faded");
  });
});

describe("highlight: route mode", () => {
  const route = [0, 1, 2, 3];
  const h = buildHighlight(ADJ, null, null, route);

  it("marks the endpoints, the people between, and fades the rest", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => nodeClass(h, i))).toEqual([
      "node endpoint",
      "node route",
      "node route",
      "node endpoint",
      "node faded",
      "node faded",
    ]);
  });

  it("lights only the chain edges, not every edge touching the chain", () => {
    // This is the distinction the old node-membership scheme could not draw:
    // 3-4 and 5-0 each touch a route member but are not part of the chain.
    expect(RING_EDGES.map(([u, v]) => edgeClass(h, u, v))).toEqual([
      "edge route",
      "edge route",
      "edge route",
      "edge dim",
      "edge dim",
      "edge dim",
    ]);
  });

  it("survives a hover — reading a name must not destroy the route", () => {
    const hovered = buildHighlight(ADJ, 2, 4, route);
    expect(hovered.kind).toBe("route");
    expect(nodeClass(hovered, 0)).toBe("node endpoint");
  });

  it("agrees with node membership on every graph the app can produce", () => {
    // The "no edgeKeys needed" claim, checked rather than asserted: on a shortest
    // path, two members that are adjacent must be consecutive.
    const g = graphOf(9, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 0], [1, 6]]);
    for (let s = 0; s < g.n; s++) {
      for (let t = s + 1; t < g.n; t++) {
        const path = shortestPath(g, s, t);
        if (path === null) continue;
        const consecutive = new Set(path.slice(1).map((v, i) => `${Math.min(path[i], v)},${Math.max(path[i], v)}`));
        const hi = buildHighlight([], null, null, path);
        for (const [u, v] of g.edgeList()) {
          const key = `${Math.min(u, v)},${Math.max(u, v)}`;
          expect(edgeClass(hi, u, v) === "edge route").toBe(consecutive.has(key));
        }
      }
    }
  });
});

describe("usePathFinder", () => {
  const graph = graphOf(6, RING_EDGES);

  it("produces the BFS shortest path", () => {
    const { result } = renderHook(() => usePathFinder(graph));
    act(() => result.current.start(0));
    act(() => { result.current.complete(3); });
    const route = result.current.route as number[];
    expect(route[0]).toBe(0);
    expect(route[route.length - 1]).toBe(3);
    expect(route.length - 1).toBe(bfsDistances(graph, 0)[3]);
  });

  it("draws the same line whichever end is picked first, read from that end", () => {
    // shortestPath is greedy from its source, so s->t and t->s can be different (both
    // shortest) paths. Picking Ana then Dia is the same question as Dia then Ana, so the
    // canonicalisation is what makes the UI make sense.
    //
    // But "the same line" is a claim about the EDGES LIT, not about array order. Asserting
    // array equality also pinned the reading direction, and that pinned the wrong thing:
    // starting from the higher-indexed person rendered the chain from the other end, while
    // the panel's live region had just said "Starting from Dia". Same line, opposite
    // sentence. So the property splits in two.
    const { result: a } = renderHook(() => usePathFinder(graph));
    act(() => a.current.start(0));
    act(() => { a.current.complete(3); });
    const { result: b } = renderHook(() => usePathFinder(graph));
    act(() => b.current.start(3));
    act(() => { b.current.complete(0); });

    // Same line: identical as a sequence once orientation is removed.
    expect(a.current.route).toEqual([...b.current.route!].reverse());
    // Read from the end the user named: each route starts at that user's own first pick.
    expect(a.current.route![0]).toBe(0);
    expect(b.current.route![0]).toBe(3);
  });

  it("reports no chain rather than an empty route", () => {
    const split = graphOf(4, [[0, 1], [2, 3]]);
    const { result } = renderHook(() => usePathFinder(split));
    act(() => result.current.start(0));
    act(() => { result.current.complete(2); });
    expect(result.current.route).toBeNull();
    expect(result.current.unreachable).toBe(true);
  });

  it("ignores a second pick that is the same person", () => {
    const { result } = renderHook(() => usePathFinder(graph));
    act(() => result.current.start(2));
    let consumed = true;
    act(() => { consumed = result.current.complete(2); });
    expect(consumed).toBe(false);
    expect(result.current.from).toBe(2); // still waiting
  });

  it("does not consume a selection when no route is being drawn", () => {
    const { result } = renderHook(() => usePathFinder(graph));
    let consumed = true;
    act(() => { consumed = result.current.complete(4); });
    expect(consumed).toBe(false);
  });

  it("clears back to nothing", () => {
    const { result } = renderHook(() => usePathFinder(graph));
    act(() => result.current.start(0));
    act(() => { result.current.complete(2); });
    expect(result.current.active).toBe(true);
    act(() => result.current.clear());
    expect(result.current.active).toBe(false);
    expect(result.current.route).toBeNull();
  });
});

describe("route determinism across a round trip", () => {
  it("is the same path after export and re-import", () => {
    const view = importGraph({
      version: 1,
      people: NAMES.map((name, id) => ({ id, name })),
      edges: RING_EDGES,
    });
    const rebuilt = graphOf(view.names.length, view.edges);
    expect(shortestPath(rebuilt, 0, 3)).toEqual(shortestPath(graphOf(6, RING_EDGES), 0, 3));
  });
});

describe("useEscape", () => {
  it("fires on Escape when enabled", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscape(onEscape, true));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("stays silent behind a modal", () => {
    // RosterModal has no Escape handling of its own, so an unguarded handler would
    // clear the route underneath an open dialog and the user would see nothing.
    const onEscape = vi.fn();
    renderHook(() => useEscape(onEscape, false));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("ignores other keys", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscape(onEscape, true));
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("stops listening when unmounted", () => {
    const onEscape = vi.fn();
    const { unmount } = renderHook(() => useEscape(onEscape, true));
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });
});

describe("PathPanel", () => {
  const view = importGraph({
    version: 1,
    people: NAMES.map((name, id) => ({ id, name })),
    edges: RING_EDGES,
  });

  it("renders the chain as text, with every name clickable", () => {
    const onSelect = vi.fn();
    render(
      <PathPanel view={view} from={null} route={[0, 1, 2]} unreachable={false}
        onSelect={onSelect} onClear={() => {}} />,
    );
    for (const name of ["Ana", "Ben", "Chen"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByText("2 steps")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ben" }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("uses the singular for a one-step chain", () => {
    render(
      <PathPanel view={view} from={null} route={[0, 1]} unreachable={false}
        onSelect={() => {}} onClear={() => {}} />,
    );
    expect(screen.getByText("1 step")).toBeTruthy();
  });

  it("prompts for the second person while one end is pending", () => {
    render(
      <PathPanel view={view} from={2} route={null} unreachable={false}
        onSelect={() => {}} onClear={() => {}} />,
    );
    expect(screen.getByText(/now pick the other person/i)).toBeTruthy();
  });

  it("says there is no chain rather than showing an empty one", () => {
    render(
      <PathPanel view={view} from={null} route={null} unreachable
        onSelect={() => {}} onClear={() => {}} />,
    );
    expect(screen.getByText(/No chain — they're in separate groups\./)).toBeTruthy();
  });
});
