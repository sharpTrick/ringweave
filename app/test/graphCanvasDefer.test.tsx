import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBuddyGraph } from "ringweave";

// Wrap the real forceLayout in a spy so we can assert WHEN GraphCanvas computes it.
const forceSpy = vi.hoisted(() => vi.fn());
vi.mock("../src/graph/layout", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/graph/layout")>();
  return {
    ...mod,
    forceLayout: (...args: Parameters<typeof mod.forceLayout>) => {
      forceSpy(...args);
      return mod.forceLayout(...args);
    },
  };
});

import GraphCanvas from "../src/graph/GraphCanvas";

const render = (layout: "ring" | "force", n: number) => {
  const r = buildBuddyGraph(n, 4, { seed: 1 });
  const names = Array.from({ length: n }, (_, i) => `P${i}`);
  renderToStaticMarkup(
    <GraphCanvas
      names={names} edges={r.edges} adjacency={r.buddies}
      layout={layout} selected={null} hovered={null}
      onSelect={() => {}} onHover={() => {}}
    />,
  );
};

beforeEach(() => forceSpy.mockClear());

// Class: the synchronous force settle (bounded but non-trivial at large n) must not run unless
// the force layout is actually on — so the default ring view and ring-mode re-rolls stay free.
describe("GraphCanvas defers the force layout to when it's selected", () => {
  it("ring mode never computes the force layout", () => {
    render("ring", 60);
    expect(forceSpy).not.toHaveBeenCalled();
  });

  it("force mode computes it", () => {
    render("force", 60);
    expect(forceSpy).toHaveBeenCalledTimes(1);
  });
});
