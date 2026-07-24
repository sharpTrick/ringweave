import type { GraphView } from "../model";
import type { BuddyGraphFile } from "./schema";

/** Order an edge as [min, max] so the exported list is canonical and diff-stable. */
function canonical(e: [number, number]): [number, number] {
  return e[0] <= e[1] ? [e[0], e[1]] : [e[1], e[0]];
}

/**
 * Serialize a GraphView to the file schema. Edges are canonicalized (u<v) and sorted;
 * metrics are already Infinity->null (normalized in `model.ts`), so `JSON.stringify`
 * can't silently corrupt them.
 */
export function exportGraph(view: GraphView): BuddyGraphFile {
  const edges = view.edges
    .map(canonical)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    version: 1,
    people: view.names.map((name, id) => ({ id, name })),
    constraints: { required: [], prohibited: [] },
    edges,
    settings: {
      buddies: view.settings.buddies,
      minSeparation: view.settings.minSeparation,
      polish: view.settings.polish,
      seed: view.settings.seed,
    },
    meta: { app: "BuddyGraph", metrics: view.metrics },
  };
}

export function exportGraphJson(view: GraphView): string {
  return JSON.stringify(exportGraph(view), null, 2);
}
