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

import GraphCanvas, { LAYOUT_MODES, positionsFor } from "../src/graph/GraphCanvas";
import type { Pt } from "../src/graph/layout";

const render = (layout: "ring" | "force", n: number) => {
  const r = buildBuddyGraph(n, 4, { seed: 1, polish: false }); // this test only checks IF force is computed, not polish
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

describe("positionsFor is the single mode->positions resolver", () => {
  const ring: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const force: Pt[] = [{ x: 2, y: 2 }, { x: 3, y: 3 }];

  it("returns force positions in force mode, ring otherwise", () => {
    expect(positionsFor("force", ring, force)).toBe(force);
    expect(positionsFor("ring", ring, force)).toBe(ring);
  });

  it("falls back to ring when the (lazy) force settle hasn't been computed", () => {
    expect(positionsFor("force", ring, null)).toBe(ring);
  });

  it("resolves every declared LayoutMode to a defined position array", () => {
    for (const m of LAYOUT_MODES) expect(positionsFor(m, ring, force)).toHaveLength(ring.length);
  });
});
