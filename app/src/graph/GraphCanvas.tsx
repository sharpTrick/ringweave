import { useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
import { forceLayout, ringLayout, type Pt } from "./layout";

export type LayoutMode = "ring" | "force";

/** Every user-selectable layout mode (what the toggle offers). */
export const LAYOUT_MODES: LayoutMode[] = ["ring", "force"];

/**
 * The POSITION-STABLE layouts whose union defines the fixed viewBox (`fit`) — the ones whose
 * points depend only on the graph, not on the current selection. A future SELECTION-DEPENDENT
 * mode (F8 focus, whose points move per hover/click) is added to `LAYOUT_MODES` and `positionsFor`
 * but deliberately NOT here: folding its per-selection points into the frame would rescale the
 * viewBox on every interaction, defeating the fixed-frame invariant (see graphCanvasFit test).
 */
export const FIT_MODES: LayoutMode[] = ["ring", "force"];

function assertNever(x: never): never {
  throw new Error(`Unhandled layout mode: ${String(x)}`);
}

/**
 * The ONE place a layout mode maps to its display positions. Force falls back to ring until its
 * (lazily computed) settle exists. Consumed by the render `target`, the animation destination, and
 * `fit`, so those three can never disagree. EXHAUSTIVE over LayoutMode via assertNever: a future
 * selection-keyed mode (F8 focus) added to LAYOUT_MODES will fail to COMPILE here until it gets a
 * branch — a loud single-seam edit, not a silent ring fallback. (It stays out of FIT_MODES so it
 * can't perturb the fixed frame.)
 */
export function positionsFor(layout: LayoutMode, ringPos: Pt[], forcePos: Pt[] | null): Pt[] {
  switch (layout) {
    case "ring":
      return ringPos;
    case "force":
      return forcePos ?? ringPos;
    default:
      return assertNever(layout);
  }
}

interface GraphCanvasProps {
  names: string[];
  edges: [number, number][];
  /** The buddy list (`view.buddies`) under a graph-generic name — used for hover glow. */
  adjacency: number[][];
  layout: LayoutMode;
  selected: number | null;
  hovered: number | null;
  onSelect: (i: number | null) => void;
  onHover: (i: number | null) => void;
}

const VB_W = 800;
const VB_H = 600;
const PAD = 60;

interface Fit {
  s: number;
  cx: number;
  cy: number;
}

/** A stable normalized->pixel transform covering both layouts, so points move but the
    frame doesn't rescale mid-animation. Pure (no state) — exported for framing tests. */
export function computeFit(pts: Pt[]): Fit {
  if (pts.length === 0) return { s: 1, cx: VB_W / 2, cy: VB_H / 2 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const s = Math.min((VB_W - 2 * PAD) / spanX, (VB_H - 2 * PAD) / spanY);
  const cx = VB_W / 2 - ((minX + maxX) / 2) * s;
  const cy = VB_H / 2 - ((minY + maxY) / 2) * s;
  return { s, cx, cy };
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function GraphCanvas({
  names, edges, adjacency, layout, selected, hovered, onSelect, onHover,
}: GraphCanvasProps) {
  const n = names.length;
  const ringPos = useMemo(() => ringLayout(n), [n]);
  // Compute the force settle LAZILY — only when the force layout is on. A ring-mode view (the
  // default) and every re-roll while in ring mode then pay nothing, so the synchronous settle
  // (bounded but non-trivial at large n) never runs unless the user actually asks for force.
  // `layout` is a dep, so switching to force computes it in the same render (never null then).
  const forcePos = useMemo(() => (layout === "force" ? forceLayout(n, edges) : null), [layout, n, edges]);

  // Keep the union frame STABLE across ring<->force toggles. `forcePos` is null in ring mode
  // (the settle is deferred), so framing off it alone would collapse the frame back to ring on
  // every toggle and re-pop the scale. Instead, remember the force settle once computed for THIS
  // graph (keyed on the edges identity, which changes only on a new graph) and frame the union
  // from that — so a return to ring keeps the same frame. The first switch to force reframes once
  // (unavoidable without settling eagerly, which we avoid to keep ring mode cheap); after that,
  // toggling only pans. A new graph invalidates the cache back to a ring-only frame.
  const forceFitRef = useRef<{ edges: [number, number][]; pts: Pt[] } | null>(null);
  if (forcePos && forceFitRef.current?.edges !== edges) {
    forceFitRef.current = { edges, pts: forcePos };
  }
  const forceForFit = forceFitRef.current?.edges === edges ? forceFitRef.current.pts : null;
  // Frame the union of the POSITION-STABLE layouts (FIT_MODES) so a settled toggle pans within a
  // fixed viewBox; a selection-dependent mode is excluded so it can't rescale the frame per click.
  const fit = useMemo(
    () => computeFit(FIT_MODES.flatMap((m) => positionsFor(m, ringPos, forceForFit))),
    [ringPos, forceForFit],
  );

  const target = positionsFor(layout, ringPos, forcePos);
  const [display, setDisplay] = useState<Pt[]>(target);
  const displayRef = useRef(display);
  displayRef.current = display;

  const rafRef = useRef(0);
  // A cheap size fingerprint, not a full graph identity: it changes when the roster size
  // or edge count changes, which is enough to force a snap when `to`/`from` differ in
  // length. A same-size re-roll (same n, same edge count, different edges) is NOT caught
  // here — it still snaps correctly because a re-roll doesn't change `layout`, so the
  // `!layoutChanged` branch below fires. Only a layout toggle animates.
  const sizeKey = `${n}:${edges.length}`;
  const prevSize = useRef(sizeKey);
  const prevLayout = useRef(layout);

  // Animate (cubic ease, ~650ms) only on a layout toggle at a stable size; otherwise snap
  // (new/resized graph, same-size re-roll, or reduced-motion).
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const to = positionsFor(layout, ringPos, forcePos); // same resolver as `target` — never desyncs
    const sizeChanged = prevSize.current !== sizeKey;
    const layoutChanged = prevLayout.current !== layout;
    prevSize.current = sizeKey;
    prevLayout.current = layout;
    const from = displayRef.current;
    if (sizeChanged || !layoutChanged || reducedMotion() || from.length !== to.length) {
      setDisplay(to);
      return;
    }
    const t0 = performance.now();
    const dur = 650;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setDisplay(to.map((tp, i) => ({
        x: from[i].x + (tp.x - from[i].x) * e,
        y: from[i].y + (tp.y - from[i].y) * e,
      })));
      if (k < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [layout, ringPos, forcePos, sizeKey]);

  // Pan/zoom via d3-zoom; the transform is applied to the root <g>.
  const svgRef = useRef<SVGSVGElement>(null);
  const [zt, setZt] = useState<ZoomTransform>(zoomIdentity);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const sel = select(el);
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 6])
      .on("zoom", (ev) => setZt(ev.transform));
    sel.call(behavior);
    return () => { sel.on(".zoom", null); };
  }, []);

  const focus = hovered ?? selected;
  const { first, second } = useMemo(() => {
    const f = new Set<number>();
    const s = new Set<number>();
    if (focus != null) {
      for (const b of adjacency[focus] ?? []) f.add(b);
      for (const b of adjacency[focus] ?? []) {
        for (const c of adjacency[b] ?? []) if (c !== focus && !f.has(c)) s.add(c);
      }
    }
    return { first: f, second: s };
  }, [focus, adjacency]);

  const px = (p: Pt) => ({ x: fit.cx + p.x * fit.s, y: fit.cy + p.y * fit.s });

  const nodeClass = (i: number): string => {
    if (focus == null) return "node";
    if (i === focus) return "node sel";
    if (first.has(i)) return "node hi";
    if (second.has(i)) return "node hi2";
    return "node faded";
  };

  const edgeClass = (u: number, v: number): string => {
    if (focus == null) return "edge";
    if (u === focus || v === focus) return "edge lit";
    if (second.has(u) || second.has(v)) return "edge lit2";
    return "edge dim";
  };

  return (
    <svg
      ref={svgRef}
      className="graph"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      role="img"
      aria-label={`Buddy graph of ${n} people. Use the buddy list for a keyboard-navigable view.`}
      onClick={(e) => { if (e.target === svgRef.current) onSelect(null); }}
    >
      <g transform={`translate(${zt.x},${zt.y}) scale(${zt.k})`}>
        {display.length === n &&
          edges.map(([u, v], idx) => {
            const a = px(display[u]);
            const b = px(display[v]);
            return (
              <line
                key={idx}
                className={edgeClass(u, v)}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              />
            );
          })}
        {display.length === n &&
          display.map((p, i) => {
            const c = px(p);
            const label = names[i].split(" ")[0];
            return (
              <g
                key={i}
                className={nodeClass(i)}
                transform={`translate(${c.x},${c.y})`}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                onClick={(e) => { e.stopPropagation(); onSelect(i); }}
              >
                <circle r={14} fill="transparent" />
                <circle className="dot" r={6} />
                <text x={9} y={4}>{label}</text>
              </g>
            );
          })}
      </g>
    </svg>
  );
}
