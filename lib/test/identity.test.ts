/**
 * Byte-identity, not tolerance: the fixtures come from `gen_c_cached.ring_greedy_cached`, so any
 * drift here means the two ports diverged rather than that a threshold needs widening.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ringGreedy } from "../src/core/greedy.js";
import { allPairsSummary, girth } from "../src/core/metrics.js";
import { mooreLowerBounds, cycleAspl } from "../src/core/bounds.js";

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(
  readFileSync(join(here, "fixtures", "reference.json"), "utf8"),
);

describe("greedy byte-identity vs Python", () => {
  for (const fx of ref.greedy) {
    it(`n=${fx.n} k=${fx.k} repair=${fx.repair}`, () => {
      const { graph, finalMind } = ringGreedy(fx.n, fx.k, {
        mind: fx.mind,
        repair: fx.repair,
      });
      const edges = graph.edgeList();
      expect(edges.length).toBe(fx.num_edges);
      // Both sides sorted ascending, so this is a set comparison, not an order one.
      expect(edges).toEqual(fx.edges.map((e: number[]) => [e[0], e[1]]));
      expect(finalMind).toBe(fx.final_mind);
      expect(graph.degrees()).toEqual(fx.degrees);
      const { aspl, diameter } = allPairsSummary(graph);
      expect(aspl).toBeCloseTo(fx.aspl, 9);
      expect(diameter).toBe(fx.diameter);
      expect(girth(graph)).toBe(fx.girth);
    });
  }
});

describe("Moore bounds match Python", () => {
  for (const m of ref.moore) {
    it(`n=${m.n} k=${m.k}`, () => {
      const { asplLb, diameterLb } = mooreLowerBounds(m.n, m.k);
      expect(asplLb).toBeCloseTo(m.aspl_lb, 9);
      expect(diameterLb).toBe(m.diam_lb);
    });
  }
});

describe("cycle ASPL matches Python", () => {
  for (const [nStr, val] of Object.entries(ref.metrics.cycle_aspl)) {
    it(`C_${nStr}`, () => {
      expect(cycleAspl(Number(nStr))).toBeCloseTo(val as number, 9);
    });
  }
});
