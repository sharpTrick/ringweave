import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, degreeLabel, isOptimal, nextRerollSeed, rerollBlockReason, type GraphView, type Settings } from "./model";
import { useBuddyGraph } from "./state/useBuddyGraph";
import GraphCanvas, { type LayoutMode } from "./graph/GraphCanvas";
import RosterModal from "./panels/RosterModal";
import LayoutToggle from "./panels/LayoutToggle";
import BuddyList from "./panels/BuddyList";
import QualityPanel from "./panels/QualityPanel";
import PersonSearch from "./panels/PersonSearch";
import PersonPanel from "./panels/PersonPanel";
import PathPanel from "./panels/PathPanel";
import Slips from "./panels/Slips";
import Notice from "./panels/Notice";
import { useNotice } from "./state/useNotice";
import { useExplorerHistory } from "./state/useExplorerHistory";
import { useGraph } from "./state/useGraph";
import { useEscape } from "./state/useEscape";
import { useFocusRescue } from "./state/useFocusRescue";
import { usePathFinder } from "./state/usePathFinder";
import { describeReasons } from "./io/constraintMessages";
import { toNamedPairs, type ConstraintPair, type NamedPair } from "./constraints";
import { exportGraphJson } from "./io/exportGraph";
import { importGraph } from "./io/importGraph";
import { feasibility } from "./io/feasibility";
import { readFileText } from "./io/readFileText";
import { downloadBlob } from "./io/download";

/** Stable identity for the no-view case, so the graph memo doesn't rebuild every render. */
const EMPTY_EDGES: [number, number][] = [];

export default function App() {
  const { notice, flash, show, clear } = useNotice();
  // A re-roll that regenerates a byte-identical graph (small unique / polish-converged) is a
  // no-op; explain it rather than silently doing nothing. Word it from the KEPT graph's actual
  // quality so it never claims "best" over a gauge showing < 100%.
  const bg = useBuddyGraph((kept) =>
    flash(
      isOptimal(kept.metrics)
        ? "That's already an optimal arrangement — a re-roll can't improve it."
        : "Couldn't find a different arrangement — this is what the current settings produce.",
    ),
  );
  const view = bg.view;

  const [modalOpen, setModalOpen] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [names, setNames] = useState<string[]>([]);
  // The rules the current graph was generated under. Indices into `names`; the two are
  // only ever replaced together (by generate or by import), so they cannot drift apart.
  // What the user TYPED. There is deliberately no sibling `constraints` state: the rules a
  // GENERATION ran under live on `view.constraints` (which is what reroll and export read,
  // and the only copy that is guaranteed to describe the graph on screen), and the rules the
  // EDITOR is holding live here. A third copy committed at dispatch time was write-only once
  // reroll stopped reading it, and a write-only copy of state that two other places already
  // disagree about is how the reroll desync happened in the first place.
  //
  // Name-keyed rather than derived from index pairs. A row naming someone no longer in the roster resolves to no index at all, so
  // rebuilding rows from `constraints` deleted exactly the rows the editor promises to keep
  // and flag. The two are only ever set together, by generate or by import.
  const [constraintRows, setConstraintRows] = useState<NamedPair[]>([]);
  const [layout, setLayout] = useState<LayoutMode>("ring");
  // Selection carries a back stack: in the explorer every name is a link, so
  // "where was I" is part of the model rather than something the user re-derives.
  const explorer = useExplorerHistory();
  // Guard the index against the view it will be read with. `resetSelection` runs
  // BEFORE `bg.generate`, and generation is asynchronous — so a person selected
  // while "Generating…" was showing survived into the replacement view. If the new
  // roster is shorter, PersonPanel then hands an out-of-range index to
  // `eccentricity`, whose own vertex guard throws. Reading through this makes the
  // pair consistent by construction rather than by ordering luck.
  const rawSelected = explorer.current;
  const selected =
    rawSelected !== null && view !== null && rawSelected < view.names.length ? rawSelected : null;
  const [hovered, setHovered] = useState<number | null>(null);

  const importRef = useRef<HTMLInputElement>(null);
  // The stable place focus goes when a panel removes itself. The search box is mounted
  // for the whole life of a view, which is what makes it a valid anchor.
  const searchRef = useRef<HTMLInputElement>(null);

  // ONE rescue for the whole app, at the commit boundary — see useFocusRescue. There is
  // deliberately no per-call-site helper: two rounds of review found the call sites that had
  // been missed, because "remember to call the helper" is not a mechanism.
  //
  // The anchor is resolved lazily at rescue time, not captured: which element is on screen
  // depends on whether a graph exists yet, and the modal's roster field is the only landing
  // spot during a first generation.
  useFocusRescue(() =>
    searchRef.current ?? document.querySelector<HTMLElement>('[aria-label="Roster names"]'),
  );

  // Rebuilt only when the edge set changes; the explorer and the path finder both
  // need real core queries and neither may reimplement them.
  const graph = useGraph(view?.names.length ?? 0, view?.edges ?? EMPTY_EDGES);
  const path = usePathFinder(graph);

  /**
   * The ONE way a person becomes selected, from any surface — the graph, the buddy
   * list, a search result, an explorer chip. While a route is being drawn, the next
   * pick completes it instead of navigating; routing that through a single seam is
   * what keeps "pick the second person" working from every one of those places.
   */
  const setSelected = (i: number | null) => {
    if (i !== null && path.complete(i)) return;
    explorer.select(i);
  };

  // Escape clears the path first, then the selection — most-transient first, so one
  // press never throws away more than the user meant. Suspended while the roster
  // modal is open: it has no Escape handling of its own, and clearing state behind
  // an open dialog is invisible.
  useEscape(() => {
    if (path.active) path.clear();
    else explorer.select(null);
  }, !modalOpen);

  useEffect(() => {
    if (bg.status === "refused") {
      // A refusal is not a failure: the rules simply admit no graph. Reopen the editor
      // so the user is next to the controls that caused it — the reasons name people,
      // and the roster modal is where those people are edited.
      show(describeReasons(bg.refusals, names)[0] ?? "Those buddy rules can't all be met.");
      setModalOpen(true);
    } else if (bg.status === "error") {
      // Recovery must not hinge on the message being non-empty: a "" error would otherwise skip
      // BOTH the toast and the reopen. Always surface something and, on a first-generation failure
      // (no view, no running overlay), reopen the setup modal so the user is never stranded.
      show(bg.error || "Generation failed.");
      if (!view) setModalOpen(true);
    } else if (bg.status === "running") {
      clear(); // clear a stale error over a new run
    }
  }, [bg.status, bg.error, bg.refusals, names, view, show, clear]);

  // Every graph-replacing action clears transient selection + hover, so no stale
  // highlight survives onto a different graph (keyboard reroll never fires mouseleave).
  const resetSelection = () => {
    explorer.reset();
    path.clear();
    setHovered(null);
  };

  const handleGenerate = (
    roster: string[],
    s: Settings,
    rules: ConstraintPair[],
    rows: NamedPair[],
  ) => {
    setNames(roster);
    setSettings(s);
    setConstraintRows(rows);
    resetSelection();
    bg.generate(roster, s, rules);
    setModalOpen(false);
  };

  const handleReroll = () => {
    // EVERYTHING here comes from `view`, never from `names`/`settings`/`constraints`.
    // Those three are committed when a generation is DISPATCHED, while `view` only
    // advances when one SUCCEEDS — so after a cancelled, errored or refused attempt
    // they describe a roster that was never built. Reading them made "↻ Different
    // arrangement", whose entire promise is a different arrangement OF THE GRAPH ON
    // SCREEN, silently replace it with a different roster, and computed the
    // feasibility and block-reason preflight against the wrong n as well.
    if (!view) return;
    // Advance the seed within its declared range [0, SEED_MAX] (nextRerollSeed) so a stored
    // seed always honors the contract and can't drift past float-safe integer range.
    const s = { ...view.settings, seed: nextRerollSeed(view.settings.seed) };
    const feas = feasibility(view.names.length, s.buddies);
    if (!feas.canGenerate) {
      flash(feas.messages[0] ?? "Can't re-arrange this roster — use “Edit people” to adjust it.");
      return;
    }
    // Cheap pre-hoc gate for the cases we can predict (the core would not polish this
    // configuration / polish is off) with actionable copy. The uniquely-determined or
    // polish-converged plateau is caught post-hoc by the identical-reroll callback above.
    const reason = rerollBlockReason(view.names.length, s, view.constraints.length > 0);
    if (reason) {
      flash(reason);
      return;
    }
    setSettings(s);
    resetSelection();
    // Intent: an identical result surfaces a notice.
    bg.generate(view.names, s, view.constraints, { reroll: true });
  };

  const cancelGeneration = () => {
    bg.cancel();
    if (!view) setModalOpen(true); // first generation has no graph to fall back to
  };

  const handleExport = () => {
    if (view) downloadBlob("buddygraph.json", "application/json", exportGraphJson(view));
  };

  const applyImported = (v: GraphView) => {
    bg.loadView(v);
    setNames(v.names);
    setSettings(v.settings);
    // An imported file carries only index pairs, so the rows are derived here — the one
    // place that conversion is correct, because the file's names and indices do agree.
    setConstraintRows(toNamedPairs(v.constraints, v.names));
    resetSelection();
    clear(); // a superseding import must not leave a stale error/notice over the fresh graph
    setModalOpen(false);
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      // Size-gate the read BEFORE parsing: importGraph's caps operate on the parsed
      // object and can't bound a giant JSON.parse that precedes them.
      const text = await readFileText(file);
      applyImported(importGraph(JSON.parse(text)));
    } catch (err) {
      flash(err instanceof Error ? `Couldn't import that file: ${err.message}` : "Couldn't import that file.");
    }
  };

  return (
    <>
      {/* `inert` while an overlay owns the screen, so Tab cannot walk out of an
          aria-modal dialog into the graph, the buddy list and the export buttons
          behind it. One attribute does what a focus trap would, and the browser
          enforces it.

          THE OVERLAYS MUST BE SIBLINGS OF THIS DIV, NOT DESCENDANTS. `inert`
          cascades to every descendant with no way to opt back in, and the previous
          version of this comment claimed RosterModal was a sibling while it was
          actually rendered inside <main> in here. Since `modalOpen` starts `true`,
          that made the entire first paint — the dialog included — unreachable by
          keyboard and absent from the accessibility tree. The comment described the
          design; the JSX did something else; nothing checked.

          The busy overlay is in the same position for the same reason, and it also
          closes a hole the mouse-blocking scrim never did: while "Generating…" is up,
          the buddy-list rows and search box behind it stayed focusable and
          Enter-activatable. */}
      <div id="app" inert={modalOpen || bg.status === "running"}>
        <header>
          <div className="brand">
            <div className="mark"><div className="r" /><div className="d d1" /><div className="d d2" /><div className="d d3" /></div>
            <h1>BuddyGraph</h1>
          </div>
          <div className="privacy"><span className="dot" />Runs on your device · roster never uploaded</div>
        </header>

        <main>
          {view && (
            <>
              <div id="stage">
                <GraphCanvas
                  names={view.names}
                  edges={view.edges}
                  adjacency={view.buddies}
                  layout={layout}
                  selected={selected}
                  hovered={hovered}
                  onSelect={setSelected}
                  onHover={setHovered}
                  route={path.route}
                />
              </div>

              <div id="rail" className="glass">
                <div className="rail-lbl">This roster</div>
                <div className="rail-big tabnum">{view.names.length}</div>
                <div className="rail-sub">people · {degreeLabel(view.metrics)} buddies each</div>
                <div className="rail-btns">
                  <button className="btn btn-warm" onClick={handleReroll}>↻ Different arrangement</button>
                  <button className="btn btn-ghost" onClick={() => setModalOpen(true)}>Edit people</button>
                </div>
              </div>

              <LayoutToggle layout={layout} onChange={setLayout} />
              <div className="hint">Hover a person to light their buddies</div>
              <PersonSearch names={view.names} onSelect={setSelected} inputRef={searchRef} />

              {selected !== null && (
                <PersonPanel
                  view={view}
                  graph={graph}
                  index={selected}
                  canGoBack={explorer.canGoBack}
                  onSelect={setSelected}
                  onBack={explorer.back}
                  onClose={() => setSelected(null)}
                  onFindPath={() => path.start(selected)}
                />
              )}

              {path.active && (
                <PathPanel
                  view={view}
                  from={path.from}
                  route={path.route}
                  unreachable={path.unreachable}
                  onSelect={(i) => explorer.select(i)}
                  onClear={path.clear}
                />
              )}

              <BuddyList view={view} selected={selected} onSelect={setSelected} />
              <QualityPanel view={view} onExport={handleExport} onImport={() => importRef.current?.click()} />
            </>
          )}

        </main>
      </div>

      {/* Outside `#app` — see the inert comment above. Both are `position: fixed` so
          they cover the viewport rather than only <main>'s box, which additionally
          fixes the narrow-window case where `main { overflow: auto }` let content
          scroll out from under the scrim. */}
      {modalOpen && (
        <RosterModal
          initialText={names.join("\n")}
          settings={settings}
          rules={constraintRows}
          canCancel={view !== null}
          onGenerate={handleGenerate}
          onCancel={() => setModalOpen(false)}
        />
      )}

      {bg.status === "running" && (
        <div className="busy" role="status" aria-live="polite">
          <div className="busy-inner">
            <span>Generating…</span>
            <button className="btn btn-ghost" onClick={cancelGeneration}>Cancel</button>
          </div>
        </div>
      )}

      {view && <Slips view={view} />}

      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow re-selecting the same filename after an external edit
          void handleImportFile(file);
        }}
      />

      <Notice message={notice} onDismiss={clear} />
    </>
  );
}
