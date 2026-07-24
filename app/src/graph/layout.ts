import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";

export interface Pt {
  x: number;
  y: number;
}

/**
 * Ring layout in normalized unit-circle space: vertex i at angle -90° + i·(360°/n).
 * Pure trig, deterministic (mirrors the mock's ring layout). GraphCanvas fits these
 * normalized points into a fixed viewBox via computeFit(), so a resize is CSS scaling,
 * not a re-layout.
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

// Force settling scales with BOTH node and edge count (charge via a quadtree, links per
// edge, all × ticks). Above either cap it falls back to the ring layout so a large or dense
// graph can't freeze the render. Generated graphs are far smaller; this guards imports
// (themselves bounded by MAX_IMPORT_N and the density cap).
export const FORCE_MAX_N = 1000;
export const FORCE_MAX_EDGES = 4000;

// The synchronous settle is O(n · ticks), so at a FIXED 300 ticks it grows to ~1.5 s at
// n=1000 — a main-thread freeze. Ticks are therefore scaled DOWN as n grows past a knee, so
// the wall-clock cost stays bounded (~200 ms at the ceiling) while small graphs keep the full
// settle. This is a pure function of n, so the layout stays deterministic run-to-run. (The
// force pass is also computed lazily — only when the force layout is on — so ring-mode use and
// re-rolls never pay it; see GraphCanvas.)
const FORCE_FULL_TICKS = 300;
const FORCE_MIN_TICKS = 40;
const FORCE_TICK_KNEE_N = 120; // full ticks at/below this; fewer above to cap the wall-clock

/** Deterministic tick budget for an n-node force settle: full ticks up to the knee, then
    scaled so O(n · ticks) — and thus the synchronous main-thread cost — stays bounded. */
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
 * Force layout, settled SYNCHRONOUSLY: seed from the ring (no Math.random), `.stop()`
 * the auto-timer, then `tick(iters)` runs the fixed count with no events/animation, so
 * React renders a settled SVG. d3-force's internal PRNG is seeded and constant, so this
 * is deterministic run-to-run — matching the determinism contract (assignments AND, here,
 * for free, pixels). Normalized space; GraphCanvas fits it via computeFit().
 */
export function forceLayout(n: number, edges: [number, number][], iters = forceIters(n)): Pt[] {
  if (n > FORCE_MAX_N || edges.length > FORCE_MAX_EDGES) return ringLayout(n); // too large/dense to settle synchronously
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
