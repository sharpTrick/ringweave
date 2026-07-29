import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS, buddiesEachLabel, connectionSummary, peopleNoun, nextRerollSeed, pathStatusText, rerollBlockReason,
  meetsEverySetting, selectionStatusText, type GraphView, type Settings,
} from "./model";
import { useBuddyGraph } from "./state/useBuddyGraph";
import GraphCanvas, { type LayoutMode } from "./graph/GraphCanvas";
import RosterModal, { ROSTER_FIELD_LABEL } from "./panels/RosterModal";
import LayoutToggle from "./panels/LayoutToggle";
import BuddyList from "./panels/BuddyList";
import QualityPanel from "./panels/QualityPanel";
import PersonSearch from "./panels/PersonSearch";
import PersonPanel from "./panels/PersonPanel";
import PathPanel from "./panels/PathPanel";
import Slips from "./panels/Slips";
import Notice from "./panels/Notice";
import { useNotice } from "./state/useNotice";
import { isShownRelated } from "./neighborhood";
import { useExplorerHistory } from "./state/useExplorerHistory";
import { useGraph } from "./state/useGraph";
import { useEscape } from "./state/useEscape";
import { useFocusRescue } from "./state/useFocusRescue";
import { usePathFinder } from "./state/usePathFinder";
import { describeReasons } from "./io/constraintMessages";
import { type ConstraintPair, type NamedPair } from "./constraints";
import { exportGraphJson } from "./io/exportGraph";
import { importGraph } from "./io/importGraph";
import { feasibility } from "./io/feasibility";
import { checkJsonShape, readFileText } from "./io/readFileText";
import { downloadBlob } from "./io/download";

/** Stable identity for the no-view case, so the graph memo doesn't rebuild every render. */
const EMPTY_EDGES: [number, number][] = [];

export default function App() {
  const { notice, flash, show, clear } = useNotice();
  // A re-roll that regenerates a byte-identical graph is a no-op; explain it rather than silently
  // doing nothing. "Optimal" has to mean every disclosure the quality panel is making is clear,
  // not just the buddy count: at 12 people with the stock settings the graph sits exactly on the
  // Moore bound while the panel says "Buddies are 3 steps apart, not the 5 in Settings", and the
  // toast called that optimal.
  const bg = useBuddyGraph((kept) =>
    flash(
      meetsEverySetting(kept)
        ? "That's already an optimal arrangement — a re-roll can't improve it."
        : "Couldn't find a different arrangement — this is what the current settings produce.",
    ),
  );
  const view = bg.view;

  const [modalOpen, setModalOpen] = useState(true);
  // Cleared whenever the dialog is dismissed or a generation is dispatched, so a stale reason
  // never outlives the attempt it describes.
  const [reopenReason, setReopenReason] = useState<string | null>(null);
  /**
   * WHAT THE EDITOR REOPENS SHOWING — one object, not three states: these three describe ONE
   * generation, and one setter makes writing two of the three inexpressible.
   *
   * `rows` are the rules AS TYPED, never rebuilt from `view.constraints`: index pairs are what
   * SURVIVED resolution, so rebuilding deletes the unresolved rows the editor contracts to keep.
   */
  const [draft, setDraft] = useState<{ names: string[]; settings: Settings; rows: NamedPair[] }>({
    names: [],
    settings: DEFAULT_SETTINGS,
    rows: [],
  });
  const { names, settings, rows: constraintRows } = draft;
  const [layout, setLayout] = useState<LayoutMode>("ring");
  // A selection that is not one of the chips on the card in front of you starts a new trail —
  // see `useExplorerHistory`. The hook holds the latest predicate in a ref and calls it only
  // during a select, so reading `view` here cannot go stale.
  const explorer = useExplorerHistory((from, to) =>
    view !== null && isShownRelated(view.buddies, from, to),
  );
  // Guard the index against the view it will be read with, so that an index outliving its view
  // cannot reach `eccentricity`, whose vertex guard throws with no error boundary above it.
  const rawSelected = explorer.current;
  const selected =
    rawSelected !== null && view !== null && rawSelected < view.names.length ? rawSelected : null;
  const [hovered, setHovered] = useState<number | null>(null);

  const importRef = useRef<HTMLInputElement>(null);
  // The stable place focus goes when a panel removes itself. NOT an input: a caret placed under
  // a user who did not ask for it opens the soft keyboard and scrolls the viewport on every
  // phone. `<main tabIndex={-1}>` takes a programmatic rescue while staying out of the tab order.
  const mainRef = useRef<HTMLElement>(null);

  // ONE rescue for the whole app, at the commit boundary — see useFocusRescue. The anchor is
  // resolved lazily rather than captured: which element is on screen depends on whether a graph
  // exists yet and whether the dialog is up.
  useFocusRescue(() => {
    // Ask whether a candidate can TAKE focus, not whether it exists: opening the roster editor
    // makes `#app` inert in the same commit, so `<main>` is still mounted but unfocusable and
    // `??` would never fall through it.
    const reachable = (el: HTMLElement | null | undefined) =>
      el && !el.closest("[inert]") ? el : null;
    // Three candidates: on the FIRST generation the roster field unmounts with the modal while
    // #app is still inert behind the busy overlay, leaving the overlay's own Cancel — outside
    // #app — the only focusable thing on screen.
    return (
      reachable(mainRef.current) ??
      reachable(document.querySelector<HTMLElement>(`[aria-label="${ROSTER_FIELD_LABEL}"]`)) ??
      reachable(document.querySelector<HTMLElement>(".busy button"))
    );
  });

  // Adopt the graph that is actually on screen into the SAME state the editor reads, so all
  // three inputs share one source: a reroll advances the seed on the view only, so a
  // dispatch-derived Seed field would show a seed that does not produce the displayed graph.
  useEffect(() => {
    if (view) setDraft({ names: view.names, settings: view.settings, rows: view.rows });
  }, [view]);

  // Rebuilt only when the edge set changes; the explorer and the path finder both
  // need real core queries and neither may reimplement them.
  const graph = useGraph(view?.names.length ?? 0, view?.edges ?? EMPTY_EDGES);
  const path = usePathFinder(graph);

  /**
   * The ONE way a person becomes selected, from any surface. While a route is being drawn the
   * next pick completes it instead of navigating.
   */
  // Stable identity, because `BuddyList` and `Slips` are memoized and a fresh arrow each render
  // would defeat both. Destructured so the dependency list names plain identifiers: the lint rule
  // cannot see that a member expression like `path.complete` is itself stable.
  const completePath = path.retarget;
  const selectPerson = explorer.select;
  const setSelected = useCallback(
    (i: number | null) => {
      if (i !== null && completePath(i)) return;
      selectPerson(i);
    },
    [completePath, selectPerson],
  );

  // Path first, then selection — most-transient first, so one press never throws away more than
  // the user meant. Suspended while the roster modal is open: clearing state behind a dialog is
  // invisible.
  useEscape(() => {
    if (path.active) path.clear();
    else explorer.select(null);
  }, !modalOpen);

  useEffect(() => {
    if (bg.status === "refused") {
      // Into the DIALOG, not the toast: the toast is inert while the dialog is open, and inert
      // removes it from the accessibility tree, so a message shown there in the same commit that
      // opens this was never announced.
      setReopenReason(describeReasons(bg.refusals, names)[0] ?? "Those buddy rules can't all be met.");
      setModalOpen(true);
    } else if (bg.status === "error") {
      // Never hinge recovery on the message being non-empty: a "" error would otherwise skip
      // BOTH the toast and the reopen. Same dialog/toast split as above.
      if (!view) {
        setReopenReason(bg.error || "Generation failed.");
        setModalOpen(true);
      } else {
        show(bg.error || "Generation failed.");
      }
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
    setDraft({ names: roster, settings: s, rows });
    resetSelection();
    setReopenReason(null);
    bg.generate(roster, s, rules, rows);
    setModalOpen(false);
  };

  const handleReroll = () => {
    // EVERYTHING here comes from `view`, never the draft: the draft is committed when a
    // generation is DISPATCHED and `view` only advances when one SUCCEEDS, so after a cancelled,
    // errored or refused attempt the draft describes a roster that was never built — and this
    // button's promise is a different arrangement OF THE GRAPH ON SCREEN.
    if (!view) return;
    const s = { ...view.settings, seed: nextRerollSeed(view.settings.seed) };
    const feas = feasibility(view.names.length, s.buddies);
    if (!feas.canGenerate) {
      flash(feas.messages[0] ?? "Can't re-arrange this roster — use “Edit people” to adjust it.");
      return;
    }
    // Cheap pre-hoc gate for the cases we can predict; the polish-converged plateau is caught
    // post-hoc by the identical-reroll callback above.
    const reason = rerollBlockReason(view.names.length, s, view.constraints.length > 0);
    if (reason) {
      flash(reason);
      return;
    }
    resetSelection();
    // EVERY DISPATCH COMMITS ITS DISPATCH, so the array that resolves a `Reason.person` is the
    // array that was generated from. `view.settings` and not `s`: the synthesised seed only
    // becomes true if this reroll succeeds. `view.rows` and never rows rebuilt from
    // `view.constraints`, which would delete every row that did not resolve.
    setDraft({ names: view.names, settings: view.settings, rows: view.rows });
    bg.generate(view.names, s, view.constraints, view.rows, { reroll: true });
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
    // `v.rows` was derived by `importGraph`, the one place rebuilding rows from indices is
    // lossless, so this path writes the same whole triple every other dispatch site writes.
    setDraft({ names: v.names, settings: v.settings, rows: v.rows });
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
      // Shape before parse for the same reason: `JSON.parse` allocates per node, so a
      // pathological file blocks this thread for seconds before importGraph can reject it.
      checkJsonShape(text);
      applyImported(importGraph(JSON.parse(text)));
    } catch (err) {
      flash(err instanceof Error ? `Couldn't import that file: ${err.message}` : "Couldn't import that file.");
    }
  };

  return (
    <>
      {/* `inert` while an overlay owns the screen, so Tab cannot walk out of an aria-modal
          dialog into the graph, the buddy list and the export buttons behind it.

          THE OVERLAYS MUST BE SIBLINGS OF THIS DIV, NOT DESCENDANTS: `inert` cascades to every
          descendant with no way to opt back in, and `modalOpen` starts `true`, so a dialog
          nested in here is unreachable on the entire first paint.
          `appErrorRecovery.test.tsx` asserts the containment. */}
      <div id="app" inert={modalOpen || bg.status === "running"}>
        <header>
          <div className="brand">
            <div className="mark"><div className="r" /><div className="d d1" /><div className="d d2" /><div className="d d3" /></div>
            <h1>BuddyGraph</h1>
          </div>
          <div className="privacy"><span className="dot" />Runs on your device · roster never uploaded</div>
        </header>

        <main ref={mainRef} tabIndex={-1}>
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

              <div id="upper">
                <div id="rail" className="glass">
                  <div className="rail-lbl">This roster</div>
                  <div className="rail-big tabnum">{view.names.length}</div>
                  <div className="rail-sub">{peopleNoun(view.names.length)} · {buddiesEachLabel(view.metrics)}</div>
                  <div className="rail-btns">
                    <button className="btn btn-warm" onClick={handleReroll}>↻ Different arrangement</button>
                    <button className="btn btn-ghost" onClick={() => setModalOpen(true)}>Edit people</button>
                  </div>
                </div>

                {/* DOM ORDER FOLLOWS THE VISUAL LAYOUT, deliberately: the panels in here are
                    absolutely positioned by app.css, so JSX order is the tab order and nothing
                    else — reorder these and focus starts jumping across the viewport. */}
                <LayoutToggle layout={layout} onChange={setLayout} />
                {/* The cards and the buddy list are ONE column, not two panels that happen to sit
                    side by side, so a narrow viewport can stack them without either being placed
                    by an offset measured across the other. Path sits ABOVE the person card: the
                    path widget re-renders the whole graph, so it has to be visible from the
                    control that arms it — parked elsewhere, it read as nothing having happened. */}
                <div id="rightcol">
                  <div id="sidecol">
                    {path.active && (
                      <PathPanel
                        view={view}
                        from={path.pending}
                        route={path.route}
                        unreachable={path.unreachable}
                        onSelect={setSelected}
                        onClear={path.clear}
                      />
                    )}
                    {selected !== null && (
                      <PersonPanel
                        view={view}
                        graph={graph}
                        index={selected}
                        canGoBack={explorer.canGoBack}
                        onSelect={setSelected}
                        onBack={explorer.back}
                        onClose={() => setSelected(null)}
                        pathFrom={path.source === selected}
                        onFindPath={() => path.toggle(selected)}
                      />
                    )}
                  </div>
                  <BuddyList view={view} selected={selected} onSelect={setSelected} />
                </div>
              </div>

              <div id="bottom">
                <PersonSearch names={view.names} onSelect={setSelected} />
                <div className="hint">Hover a person to light their buddies</div>
                <QualityPanel view={view} onExport={handleExport} onImport={() => importRef.current?.click()} />
              </div>
            </>
          )}

        </main>
      </div>

      {/* Outside `#app` — see the inert comment above. Both are `position: fixed` so they cover
          the viewport rather than only <main>'s box, which also stops content scrolling out
          from under the scrim in a narrow window. */}
      {modalOpen && (
        <RosterModal
          initialText={names.join("\n")}
          settings={settings}
          rules={constraintRows}
          reopenReason={reopenReason}
          canCancel={view !== null}
          onGenerate={handleGenerate}
          onCancel={() => {
            setReopenReason(null);
            setModalOpen(false);
          }}
        />
      )}

      {/* The REGION is always mounted; only its contents change. A live region has to exist in
          the accessibility tree BEFORE its text changes for the change to register. The scrim
          itself stays conditional: an empty one would swallow clicks. */}
      <div className="busy-live" role="status" aria-live="polite">
        {/* A region going EMPTY is not reliably announced, so a run that reported "Generating…"
            and then fell silent left a screen-reader user with no way to know it had finished
            short of tabbing back to the metrics and re-reading them. */}
        {bg.status === "running"
          ? "Generating…"
          : view !== null
            ? `Arrangement ready — ${connectionSummary(view.metrics)}`
            : ""}
      </div>
      {/* The path finder's SPOKEN half, always mounted for the same reason. */}
      <div className="sr-live" role="status" aria-live="polite">
        {view ? pathStatusText(view, path.pending, path.route, path.unreachable) : ""}
      </div>
      {/* And the same for SELECTION, which otherwise announces nothing: the panel it opens
          precedes both controls in DOM order, so Tab has already gone past it. */}
      <div className="sr-live" role="status" aria-live="polite">
        {view ? selectionStatusText(view, selected) : ""}
      </div>
      {bg.status === "running" && (
        <div className="busy">
          <div className="busy-inner">
            <span aria-hidden="true">Generating…</span>
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

      {/* Inert while the dialog is open. The toast lives OUTSIDE #app (it has to — #app is what
          gets inert) and contains a real button, so it was the one focusable thing Tab could
          reach out of an aria-modal dialog. Nothing is lost: its own role="status" still
          announces the message. */}
      <div inert={modalOpen}>
        <Notice message={notice} onDismiss={clear} />
      </div>
    </>
  );
}
