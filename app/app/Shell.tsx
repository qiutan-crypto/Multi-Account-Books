"use client";

import { useState } from "react";
import { addEntity, type EntitySummary } from "./actions";
import ReportsView from "./ReportsView";
import DataEntryView from "./DataEntryView";
import ChartView from "./ChartView";

const TABS = ["Reports", "Data entry", "Chart", "Paste import", "Export"] as const;
type Tab = (typeof TABS)[number];

export default function Shell({ initialEntities }: { initialEntities: EntitySummary[] }) {
  const [entities, setEntities] = useState<EntitySummary[]>(initialEntities);
  const [activeId, setActiveId] = useState<string>(initialEntities[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("Reports");
  const [newName, setNewName] = useState("");
  // Bumped after any write so the Reports view refetches when revisited.
  const [dataVersion, setDataVersion] = useState(0);

  const active = entities.find((e) => e.id === activeId);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    const created = await addEntity(name);
    setEntities((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setActiveId(created.id);
    setNewName("");
  }

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <h1>BeanBooks</h1>
          <span className="pill">Beancount</span>
        </div>
        <div className="entity-list">
          {entities.map((e) => (
            <button
              key={e.id}
              className={"entity" + (e.id === activeId ? " active" : "")}
              onClick={() => setActiveId(e.id)}
            >
              {e.name}
            </button>
          ))}
        </div>
        <div className="stack">
          <input
            placeholder="New business entity name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
          <button className="primary" onClick={handleAdd}>
            Add entity
          </button>
        </div>
      </aside>

      <main>
        <div className="toolbar">
          <div>
            <strong>{active?.name ?? "No entity"}</strong>
            <div className="muted">Server-backed ledger · Beancount engine</div>
          </div>
          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t}
                className={"tab" + (t === tab ? " active" : "")}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {!active ? (
          <div className="panel">
            <p className="muted">Create an entity to get started.</p>
          </div>
        ) : tab === "Reports" ? (
          <ReportsView key={active.id + ":" + dataVersion} entityId={active.id} />
        ) : tab === "Data entry" ? (
          <DataEntryView entityId={active.id} onChange={() => setDataVersion((v) => v + 1)} />
        ) : tab === "Chart" ? (
          <ChartView entityId={active.id} onChange={() => setDataVersion((v) => v + 1)} />
        ) : (
          <div className="panel">
            <h2>{tab}</h2>
            <p className="muted">
              This tab is being migrated to the new React app. For now, the
              classic editor remains available at <code>/</code>.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
