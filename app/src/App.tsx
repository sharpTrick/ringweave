import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type GraphView, type Settings } from "./model";
import { useBuddyGraph } from "./state/useBuddyGraph";
import GraphCanvas, { type LayoutMode } from "./graph/GraphView";
import RosterModal from "./panels/RosterModal";
import BuddyList from "./panels/BuddyList";
import QualityPanel from "./panels/QualityPanel";
import Slips from "./panels/Slips";
import { exportGraphJson } from "./io/exportGraph";
import { importGraph, ImportError } from "./io/importGraph";
import { downloadBlob } from "./io/download";

export default function App() {
  const bg = useBuddyGraph();
  const view = bg.view;

  const [modalOpen, setModalOpen] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [names, setNames] = useState<string[]>([]);
  const [layout, setLayout] = useState<LayoutMode>("ring");
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (bg.status === "error" && bg.error) setNotice(bg.error);
  }, [bg.status, bg.error]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? null : n)), 4000);
  };

  const handleGenerate = (roster: string[], s: Settings) => {
    setNames(roster);
    setSettings(s);
    setSelected(null);
    setHovered(null);
    bg.generate(roster, s);
    setModalOpen(false);
  };

  const handleReroll = () => {
    const s = { ...settings, seed: settings.seed + 1 };
    setSettings(s);
    setSelected(null);
    bg.generate(names, s);
  };

  const handleExport = () => {
    if (view) downloadBlob("buddygraph.json", "application/json", exportGraphJson(view));
  };

  const applyImported = (v: GraphView) => {
    bg.loadView(v);
    setNames(v.names);
    setSettings(v.settings);
    setSelected(null);
    setHovered(null);
    setModalOpen(false);
  };

  const handleImportFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyImported(importGraph(JSON.parse(String(reader.result ?? ""))));
      } catch (err) {
        flash(err instanceof ImportError || err instanceof SyntaxError
          ? `Couldn't import that file: ${err.message}`
          : "Couldn't import that file.");
      }
    };
    reader.readAsText(file);
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
                <div className="rail-sub">people · {view.settings.buddies} buddies each</div>
                <div className="rail-btns">
                  <button className="btn btn-warm" onClick={handleReroll}>↻ Different arrangement</button>
                  <button className="btn btn-ghost" onClick={() => setModalOpen(true)}>Edit people</button>
                </div>
              </div>

              <div id="toggle" className="glass" role="group" aria-label="Layout">
                <button className={"ring" + (layout === "ring" ? " on" : "")} onClick={() => setLayout("ring")}>Ring</button>
                <button className={"force" + (layout === "force" ? " on" : "")} onClick={() => setLayout("force")}>Force</button>
              </div>
              <div className="hint">Hover a person to light their buddies</div>

              <BuddyList view={view} selected={selected} onSelect={setSelected} />
              <QualityPanel view={view} onExport={handleExport} onImport={() => importRef.current?.click()} />
            </>
          )}

          {modalOpen && (
            <RosterModal
              initialText={names.join("\n")}
              settings={settings}
              canCancel={view !== null}
              onGenerate={handleGenerate}
              onCancel={() => setModalOpen(false)}
            />
          )}

          {bg.status === "running" && <div className="busy">Generating…</div>}
        </main>
      </div>

      {view && <Slips view={view} />}

      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => handleImportFile(e.target.files?.[0])}
      />

      {notice && (
        <div
          role="status"
          style={{
            position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)",
            background: "var(--panel-solid)", border: "1px solid var(--line2)", color: "var(--ink)",
            padding: "10px 16px", borderRadius: 10, fontSize: 13, zIndex: 40, maxWidth: "90vw",
          }}
          onClick={() => setNotice(null)}
        >
          {notice}
        </div>
      )}
    </>
  );
}
