import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import { BUDDY_MAX, MAX_ROSTER_N } from "../model";

export interface Pt {
  x: number;
  y: number;
}

/**
 * Ring layout in normalized unit-circle space. GraphCanvas fits these points into a fixed viewBox
 * via computeFit(), so a resize is CSS scaling rather than a re-layout.
 */
export function ringLayout(n: number): Pt[] {
  const pts: Pt[] = [];
  const denom = Math.max(n, 1);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / denom;
    pts.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return pts;
}

// Above either cap the settle falls back to ring, so a pathological graph cannot freeze the
// render. The edge cap covers the densest graph the app can produce, so a max-settings generation
// keeps its force view instead of silently rendering as ring.
export const FORCE_MAX_N = MAX_ROSTER_N;
export const FORCE_MAX_EDGES = Math.ceil((MAX_ROSTER_N * BUDDY_MAX) / 2);

// The settle is synchronous and O(n · ticks), so ticks scale DOWN past a knee to bound the
// main-thread cost. A pure function of n, so the layout stays deterministic run-to-run.
const FORCE_FULL_TICKS = 300;
/** Exported for the cost-budget test: re-stating the bound there would mirror this constant. */
export const FORCE_MIN_TICKS = 40;
const FORCE_TICK_KNEE_N = 120;

export function forceIters(n: number): number {
  if (n <= FORCE_TICK_KNEE_N) return FORCE_FULL_TICKS;
  return Math.max(FORCE_MIN_TICKS, Math.round((FORCE_FULL_TICKS * FORCE_TICK_KNEE_N) / n));
}

interface SimNode extends SimulationNodeDatum {
  index: number;
  x: number;
  y: number;
}

interface SimLink {
  source: number;
  target: number;
}

/**
 * Force layout, settled SYNCHRONOUSLY: seeded from the ring (no Math.random) and ticked a fixed
 * count with the auto-timer stopped, so the result is deterministic run-to-run as the determinism
 * contract requires.
 */
export function forceLayout(n: number, edges: [number, number][], iters = forceIters(n)): Pt[] {
  if (n > FORCE_MAX_N || edges.length > FORCE_MAX_EDGES) return ringLayout(n);
  const nodes: SimNode[] = ringLayout(n).map((p, i) => ({ index: i, x: p.x, y: p.y }));
  const links: SimLink[] = edges.map(([source, target]) => ({ source, target }));

  const sim = forceSimulation<SimNode>(nodes)
    .force("charge", forceManyBody<SimNode>().strength(-0.6))
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.index)
        .distance(0.35)
        .strength(0.25),
    )
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide<SimNode>(0.05))
    .stop();

  sim.tick(iters);
  return nodes.map((d) => ({ x: d.x ?? 0, y: d.y ?? 0 }));
}
