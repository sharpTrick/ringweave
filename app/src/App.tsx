import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS, buddiesEachLabel, isOptimal, peopleNoun, nextRerollSeed, pathStatusText, rerollBlockReason,
  selectionStatusText, targetShortfall, type GraphView, type Settings,
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
  // A re-roll that regenerates a byte-identical graph (small unique / polish-converged) is a
  // no-op; explain it rather than silently doing nothing. Word it from the KEPT graph's actual
  // quality so it never claims "best" over a gauge showing < 100%.
  const bg = useBuddyGraph((kept) =>
    flash(
      // `isOptimal` alone said "already optimal" to someone who asked for 4 buddies and got 3
      // — true of the graph, and not the answer to the question they asked. When the target
      // was missed, the honest line is the one that points at the settings.
      isOptimal(kept.metrics) && targetShortfall(kept) === null
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
   * WHAT THE EDITOR REOPENS SHOWING — one object, not three states, and that is the whole point.
   *
   * These three describe ONE generation together, and three separately-written copies is a
   * defect this loop closed three times before removing the copies: the seed a graph was not
   * built with (round 13), the roster a refusal was worded from (round 15), and the rule rows a
   * reroll left behind (round 20). Each fix added a writer to a site that had forgotten one; the
   * instruction "remember to write all three" failed twice, so it is gone. There is now one
   * setter, and every dispatch site calls it with a whole triple — writing two of three is not
   * expressible.
   *
   * `rows` are the rules AS TYPED (name-keyed), never rebuilt from `view.constraints`: index
   * pairs are what SURVIVED resolution, so rebuilding deletes the unresolved rows the editor
   * contracts to keep and flag. They travel on the view for the same reason the roster does.
   */
  const [draft, setDraft] = useState<{ names: string[]; settings: Settings; rows: NamedPair[] }>({
    names: [],
    settings: DEFAULT_SETTINGS,
    rows: [],
  });
  const { names, settings, rows: constraintRows } = draft;
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
  // The stable place focus goes when a panel removes itself.
  //
  // It was the search input, chosen because it is mounted for the whole life of a view. That is
  // true and it was the wrong property to choose on: an input is a CARET, and putting one under a
  // user who did not ask for it opens the soft keyboard and scrolls the viewport to it on every
  // phone. Reported from a phone against this branch — finishing a generation raised the keyboard.
  //
  // `<main>` carries `tabIndex={-1}` so it can receive a programmatic rescue while staying out of
  // the tab order, which is the standard landing spot for exactly this: the next Tab continues
  // from the top of the content rather than the top of the document, and nothing is typed into.
  const mainRef = useRef<HTMLElement>(null);

  // ONE rescue for the whole app, at the commit boundary — see useFocusRescue. There is
  // deliberately no per-call-site helper: two rounds of review found the call sites that had
  // been missed, because "remember to call the helper" is not a mechanism.
  //
  // The anchor is resolved lazily at rescue time, not captured: which element is on screen
  // depends on whether a graph exists yet, and the modal's roster field is the only landing
  // spot during a first generation.
  useFocusRescue(() => {
    // `??` was not enough, and the reason is the OTHER fix from the same round. Opening the
    // roster editor makes `#app` inert in the same commit, and everything inside it — `<main>`
    // included — is still mounted but silently unfocusable, and `??` never falls through for a
    // non-null value. Focus stayed on <body> with the dialog open, which is the case the rescue
    // exists for.
    //
    // Ask whether the candidate can actually take focus, not whether it exists.
    const reachable = (el: HTMLElement | null | undefined) =>
      el && !el.closest("[inert]") ? el : null;
    // Three candidates, because there is a state where the first two are both unavailable: on
    // the FIRST generation the roster field unmounts with the modal while #app is still inert
    // behind the busy overlay. The overlay's own Cancel button is the only focusable thing on
    // screen at that moment, and it is outside #app.
    //
    // The roster field IS a text input and stays second on purpose: it is the landing spot only
    // when the setup dialog is the whole accessible document, where putting the caret in the
    // first field is what the user came to do rather than something done to them.
    return (
      reachable(mainRef.current) ??
      reachable(document.querySelector<HTMLElement>(`[aria-label="${ROSTER_FIELD_LABEL}"]`)) ??
      reachable(document.querySelector<HTMLElement>(".busy button"))
    );
  });

  // Re-sync the editor's settings from the graph that is actually on screen, whenever a new one
  // is adopted. Three consecutive rounds argued about this one line and each answer was half
  // right: reading `view.settings` directly (r7) made ONE dialog input view-derived while its
  // neighbours stayed dispatch-derived; reverting to `settings` (r8) made them consistent but
  // left the Advanced → Seed field showing a seed that does not produce the displayed graph,
  // because a reroll advances the seed on the view only. Adopting into the single `settings`
  // state is the answer both critics actually recommended: one copy, consistent with the roster
  // text and rule rows beside it, and never stale.
  useEffect(() => {
    if (view) setDraft({ names: view.names, settings: view.settings, rows: view.rows });
  }, [view]);

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
  // STABLE IDENTITY, because `BuddyList` and `Slips` are memoized and a fresh arrow each render
  // would defeat both. `path.complete` and `explorer.select` are themselves stable (`useCallback`
  // in their hooks), so this closes over nothing that changes per render.
  // Destructured so the dependency list names plain identifiers: the lint rule cannot see that
  // `path.complete` and `explorer.select` are themselves stable, and a member expression in a
  // dep array is exactly the shape it refuses to reason about.
  const completePath = path.complete;
  const selectPerson = explorer.select;
  const setSelected = useCallback(
    (i: number | null) => {
      if (i !== null && completePath(i)) return;
      selectPerson(i);
    },
    [completePath, selectPerson],
  );

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
      // Into the DIALOG, not the toast: the toast is inert while the dialog is open, and inert
      // removes it from the accessibility tree, so a message shown there in the same commit that
      // opens this was never announced.
      setReopenReason(describeReasons(bg.refusals, names)[0] ?? "Those buddy rules can't all be met.");
      setModalOpen(true);
    } else if (bg.status === "error") {
      // Recovery must not hinge on the message being non-empty: a "" error would otherwise skip
      // BOTH the toast and the reopen. Always surface something and, on a first-generation failure
      // (no view, no running overlay), reopen the setup modal so the user is never stranded.
      // Same split: if the dialog is about to open, the message goes INTO it; otherwise there is
      // no dialog to be contained by and the toast is both visible and announced.
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
    resetSelection();
    // EVERY DISPATCH COMMITS ITS DISPATCH. These three are App's dispatch-time copies: they are
    // what the reopened editor shows and what words a refusal, and both of those describe the
    // generation that was actually SENT. `handleGenerate` committed them and this path did not,
    // so after a superseded Edit→Generate the two disagreed: the reroll correctly sent the view's
    // roster while the refusal was worded against the abandoned edit's, naming a person who is in
    // no graph. There are exactly two dispatch sites, and now both do this — which is what makes
    // the array that resolves a `Reason.person` the same array that was generated from.
    //
    // COMMIT WHAT IS A COPY, SYNTHESISE NOTHING, AND REBUILD NOTHING. Four rounds argued over
    // these lines, and the reason it took four is that the three pieces of state look alike and
    // are not:
    //   - `names` is a COPY: `view.names` is exactly what `parseRoster` emitted, so writing it
    //     back cannot lose anything. Not writing it was the refusal-names-the-wrong-roster bug.
    //   - `settings` is a copy too EXCEPT the seed, which this path SYNTHESISES with
    //     `nextRerollSeed` and which only becomes true if the reroll succeeds. Committing `s`
    //     showed a seed the displayed graph was not built with; committing nothing left a buddy
    //     count from an abandoned edit beside a roster re-committed from the view. `view.settings`
    //     is the copy, without the synthesised part.
    //   - the rule ROWS are NOT a copy and are not written here at all. `view.constraints` is
    //     resolved INDEX pairs; rebuilding rows from them silently deleted every row that had not
    //     resolved — one naming somebody no longer in the roster, one half-typed, a duplicate —
    //     which is the exact index-reconstruction `RosterModal`'s `rules` prop documents as
    //     forbidden and the editor's "kept and flagged, never deleted" contract forbids. Nothing
    //     needs writing: a reroll changes neither the roster nor the rules, and `constraintRows`
    //     already holds what the user submitted.
    setDraft({ names: view.names, settings: view.settings, rows: view.rows });
    bg.generate(view.names, s, view.constraints, view.rows, { reroll: true }); // identical -> notice
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
      // Shape before parse, the same gate-before-the-work discipline importGraph follows
      // internally: `JSON.parse` allocates per node, and 8 MB of pathological JSON blocks this
      // thread for ~1.8 s and ~238 MB before importGraph gets to reject it in 0 ms.
      checkJsonShape(text);
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
          cascades to every descendant with no way to opt back in. They are siblings
          below, and `appErrorRecovery.test.tsx` asserts the containment.

          (History, since it is why the rule is shouted: an earlier version of this
          comment claimed the same thing while the JSX rendered RosterModal inside
          <main> in here. `modalOpen` starts `true`, so the entire first paint — the
          dialog included — was unreachable by keyboard and absent from the
          accessibility tree. The comment described the design, the JSX did something
          else, and nothing checked. That is what the test is for.)

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

              <div id="rail" className="glass">
                <div className="rail-lbl">This roster</div>
                <div className="rail-big tabnum">{view.names.length}</div>
                <div className="rail-sub">{peopleNoun(view.names.length)} · {buddiesEachLabel(view.metrics)}</div>
                <div className="rail-btns">
                  <button className="btn btn-warm" onClick={handleReroll}>↻ Different arrangement</button>
                  <button className="btn btn-ghost" onClick={() => setModalOpen(true)}>Edit people</button>
                </div>
              </div>

              {/* DOM ORDER FOLLOWS THE VISUAL LAYOUT, deliberately. Every panel here is
                  absolutely positioned by app.css, so JSX order and reading order are
                  independent — and they had diverged: Tab went rail -> toggle -> search
                  (bottom-left) -> person (top-right) -> route (bottom-left, ABOVE search)
                  -> buddies (top-right), jumping the viewport four times. Sighted keyboard
                  users track focus spatially, so the order below is top row left-to-right,
                  then the bottom-left stack downward, then the metrics band. */}
              <LayoutToggle layout={layout} onChange={setLayout} />
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
              <BuddyList view={view} selected={selected} onSelect={setSelected} />
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
              <PersonSearch names={view.names} onSelect={setSelected} />
              <div className="hint">Hover a person to light their buddies</div>
              <QualityPanel view={view} onExport={handleExport} onImport={() => importRef.current?.click()} />
            </>
          )}

        </main>
      </div>

      {/* Outside `#app` — see the inert comment above. Both are `position: fixed` so
          they cover the viewport rather than only <main>'s box, which additionally
          fixes the narrow-window case where `main { overflow: auto }` let content
          scroll out from under the scrim. */}
      {/* All three RosterModal inputs are DISPATCH-time: the roster text, the rule rows and the
          settings are what the user last submitted, which is what an editor should reopen showing.
          Last round `settings` was switched to `view?.settings ?? settings` to fix a seed drift —
          but that drift's real cause was a pre-emptive setSettings in handleReroll, removed in the
          same round. Changing the source as well made one input view-derived while its two
          neighbours stayed dispatch-derived, so the dialog contradicted itself. Two fixes for one
          bug, and the second one was the defect. */}
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

      {/* The REGION is always mounted; only its contents change. A live region has to exist
          in the accessibility tree BEFORE its text changes for the change to register as a
          change — Notice.tsx documents exactly this and keeps its own region permanent, and
          three regions in this app were still mounting together with their first text. The
          scrim itself stays conditional: it is a visual element, and an empty one would
          swallow clicks. */}
      <div className="busy-live" role="status" aria-live="polite">
        {bg.status === "running" ? "Generating…" : ""}
      </div>
      {/* The path finder's SPOKEN half, mounted for the whole life of a view while the visible
          panel stays conditional. Same reason as the busy region above. */}
      <div className="sr-live" role="status" aria-live="polite">
        {view ? pathStatusText(view, path.from, path.route, path.unreachable) : ""}
      </div>
      {/* And the same for SELECTION. Choosing a person from the buddy list or a search result is
          the app's headline task and announced nothing: the panel it opens precedes both controls
          in DOM order — deliberately, so the DOM follows the visual layout — so Tab had already
          gone past it, and reaching it meant Shift+Tab through several stops with nothing on
          screen saying so. Announcing the outcome resolves that without re-litigating the order. */}
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
          gets inert), and it contains a real button, so it was the one focusable thing Tab could
          reach from inside an aria-modal dialog. That is precisely the containment `inert` was
          added to provide, leaking through the one element the containment could not cover.
          Nothing is lost: the message is announced by its own role="status" and the dialog that
          reopened with it is the actionable surface. */}
      <div inert={modalOpen}>
        <Notice message={notice} onDismiss={clear} />
      </div>
    </>
  );
}
