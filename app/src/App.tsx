import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, degreeLabel, isOptimal, nextRerollSeed, rerollBlockReason, type GraphView, type Settings } from "./model";
import { useBuddyGraph } from "./state/useBuddyGraph";
import GraphCanvas, { type LayoutMode } from "./graph/GraphCanvas";
import RosterModal from "./panels/RosterModal";
import LayoutToggle from "./panels/LayoutToggle";
import BuddyList from "./panels/BuddyList";
import QualityPanel from "./panels/QualityPanel";
import Slips from "./panels/Slips";
import Notice from "./panels/Notice";
import { useNotice } from "./state/useNotice";
import { describeReasons } from "./io/constraintMessages";
import type { ConstraintPair } from "./constraints";
import { exportGraphJson } from "./io/exportGraph";
import { importGraph } from "./io/importGraph";
import { feasibility } from "./io/feasibility";
import { readFileText } from "./io/readFileText";
import { downloadBlob } from "./io/download";

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
  const [constraints, setConstraints] = useState<ConstraintPair[]>([]);
  const [layout, setLayout] = useState<LayoutMode>("ring");
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const importRef = useRef<HTMLInputElement>(null);

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
    setSelected(null);
    setHovered(null);
  };

  const handleGenerate = (roster: string[], s: Settings, rules: ConstraintPair[]) => {
    setNames(roster);
    setSettings(s);
    setConstraints(rules);
    resetSelection();
    bg.generate(roster, s, rules);
    setModalOpen(false);
  };

  const handleReroll = () => {
    // Advance the seed within its declared range [0, SEED_MAX] (nextRerollSeed) so a stored
    // seed always honors the contract and can't drift past float-safe integer range.
    const s = { ...settings, seed: nextRerollSeed(settings.seed) };
    const feas = feasibility(names.length, s.buddies);
    if (!feas.canGenerate) {
      flash(feas.messages[0] ?? "Can't re-arrange this roster — use “Edit people” to adjust it.");
      return;
    }
    // Cheap pre-hoc gate for the two cases we can predict (too large / polish off) with
    // actionable copy. The uniquely-determined / polish-converged plateau is caught post-hoc
    // by the identical-reroll callback above.
    const reason = rerollBlockReason(names.length, s);
    if (reason) {
      flash(reason);
      return;
    }
    setSettings(s);
    resetSelection();
    bg.generate(names, s, constraints, { reroll: true }); // intent: an identical result surfaces a notice
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
    setConstraints(v.constraints);
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
      <div id="app">
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

              <BuddyList view={view} selected={selected} onSelect={setSelected} />
              <QualityPanel view={view} onExport={handleExport} onImport={() => importRef.current?.click()} />
            </>
          )}

          {modalOpen && (
            <RosterModal
              initialText={names.join("\n")}
              settings={settings}
              constraints={constraints}
              constraintNames={names}
              canCancel={view !== null}
              onGenerate={handleGenerate}
              onCancel={() => setModalOpen(false)}
            />
          )}

          {bg.status === "running" && (
            <div className="busy">
              <div className="busy-inner">
                <span>Generating…</span>
                <button className="btn btn-ghost" onClick={cancelGeneration}>Cancel</button>
              </div>
            </div>
          )}
        </main>
      </div>

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
