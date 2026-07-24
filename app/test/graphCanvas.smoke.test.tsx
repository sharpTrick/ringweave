import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBuddyGraph } from "ringweave";
import GraphCanvas from "../src/graph/GraphCanvas";

// SSR render smoke: effects (matchMedia / rAF / d3-zoom) don't fire, so this exercises
// the pure render path — a node per person and a line per edge in the ring layout.
describe("GraphCanvas smoke", () => {
  it("renders an SVG with a node per person and a line per edge", () => {
    const r = buildBuddyGraph(12, 4, { seed: 1 });
    const names = Array.from({ length: 12 }, (_, i) => `P${i}`);
    const html = renderToStaticMarkup(
      <GraphCanvas
        names={names}
        edges={r.edges}
        adjacency={r.buddies}
        layout="ring"
        selected={null}
        hovered={null}
        onSelect={() => {}}
        onHover={() => {}}
      />,
    );
    expect(html).toContain("<svg");
    expect((html.match(/<text/g) ?? []).length).toBe(12);
    expect((html.match(/<line/g) ?? []).length).toBe(r.edges.length);
  });
});
