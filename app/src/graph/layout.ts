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

// Force settling is super-linear (charge is O(n²) per tick) and blows up past a few
// thousand nodes; above this it falls back to the ring layout so an oversized imported
// graph can't freeze the render. Generated graphs are far smaller, so this only affects
// large imports (themselves bounded by MAX_IMPORT_N).
export const FORCE_MAX_N = 1000;

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
export function forceLayout(n: number, edges: [number, number][], iters = 300): Pt[] {
  if (n > FORCE_MAX_N) return ringLayout(n); // too large to settle synchronously
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
