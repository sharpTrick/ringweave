import { useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
import { forceLayout, ringLayout, type Pt } from "./layout";

/** Above this n a layout change snaps: the tween re-renders every node and edge, every frame. */
const ANIM_MAX_N = 400;
import { buildHighlight, edgeClass, nodeClass } from "./highlight";

export type LayoutMode = "ring" | "force";

/** Every user-selectable layout mode; LayoutToggle renders one button per entry. */
export const LAYOUT_MODES = ["ring", "force"] as const satisfies readonly LayoutMode[];

/**
 * The POSITION-STABLE subset, whose union defines the fixed viewBox. A SELECTION-DEPENDENT mode
 * must stay out: folding its per-selection points into the frame rescales the viewBox on every
 * interaction.
 */
export const FIT_MODES = ["ring", "force"] as const satisfies readonly LayoutMode[];

function assertNever(x: never): never {
  throw new Error(`Unhandled layout mode: ${String(x)}`);
}

/**
 * The ONE place a layout maps to display positions — the render target, the animation destination
 * and `fit` all read it, so they cannot disagree. Exhaustive via `assertNever`, so a new mode
 * fails to COMPILE here rather than silently falling back to ring.
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
  /** `view.buddies` under a graph-generic name. */
  adjacency: number[][];
  layout: LayoutMode;
  selected: number | null;
  hovered: number | null;
  onSelect: (i: number | null) => void;
  onHover: (i: number | null) => void;
  /** An active route to light, or null. Takes precedence over hover — see buildHighlight. */
  route?: number[] | null;
}

const VB_W = 800;
const VB_H = 600;
const PAD = 60;

interface Fit {
  s: number;
  cx: number;
  cy: number;
}

/** One normalized->pixel transform covering both layouts, so points move but the frame does not
    rescale mid-animation. */
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
  names, edges, adjacency, layout, selected, hovered, onSelect, onHover, route,
}: GraphCanvasProps) {
  const n = names.length;
  const ringPos = useMemo(() => ringLayout(n), [n]);
  // LAZY: the settle is synchronous, so ring mode and every ring-mode re-roll must not pay it.
  // `layout` is a dep, so switching to force computes it in the same render (never null then).
  const forcePos = useMemo(() => (layout === "force" ? forceLayout(n, edges) : null), [layout, n, edges]);

  // `forcePos` is null in ring mode, so framing off it alone collapses the frame back to ring on
  // every toggle and re-pops the scale. Remembering the settle for THIS graph (keyed on the edges
  // identity) keeps the frame across toggles.
  const forceFitRef = useRef<{ edges: [number, number][]; pts: Pt[] } | null>(null);
  if (forcePos && forceFitRef.current?.edges !== edges) {
    forceFitRef.current = { edges, pts: forcePos };
  }
  const forceForFit = forceFitRef.current?.edges === edges ? forceFitRef.current.pts : null;
  const fit = useMemo(
    () => computeFit(FIT_MODES.flatMap((m) => positionsFor(m, ringPos, forceForFit))),
    [ringPos, forceForFit],
  );

  const target = positionsFor(layout, ringPos, forcePos);
  const [display, setDisplay] = useState<Pt[]>(target);
  const displayRef = useRef(display);
  displayRef.current = display;

  const rafRef = useRef(0);
  // A size fingerprint, not a graph identity: a same-size re-roll is NOT caught here, and snaps
  // only because a re-roll leaves `layout` unchanged and the `!layoutChanged` branch fires.
  const sizeKey = `${n}:${edges.length}`;
  const prevSize = useRef(sizeKey);
  const prevLayout = useRef(layout);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const to = positionsFor(layout, ringPos, forcePos); // same resolver as `target` — never desyncs
    const sizeChanged = prevSize.current !== sizeKey;
    const layoutChanged = prevLayout.current !== layout;
    prevSize.current = sizeKey;
    prevLayout.current = layout;
    const from = displayRef.current;
    if (
      sizeChanged ||
      !layoutChanged ||
      reducedMotion() ||
      from.length !== to.length ||
      to.length > ANIM_MAX_N
    ) {
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

  const highlight = useMemo(
    () => buildHighlight(adjacency, selected, hovered, route ?? null),
    [adjacency, selected, hovered, route],
  );

  const px = (p: Pt) => ({ x: fit.cx + p.x * fit.s, y: fit.cy + p.y * fit.s });

  return (
    // The background click is a mouse convenience: every operation it offers is also on the
    // keyboard-navigable buddy list, so a key handler here would add a focus stop leading nowhere.
    // Suppressed at the site, so a new non-interactive click handler elsewhere still fails lint.
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */
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
                className={edgeClass(highlight, u, v)}
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
                className={nodeClass(highlight, i)}
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
