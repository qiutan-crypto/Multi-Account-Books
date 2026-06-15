"use client";

import { useEffect, useState } from "react";
import {
  addEntity,
  duplicateEntity,
  listEntities,
  getEntityProtection,
  verifyLogin,
  deleteEntity,
  verifyAdmin,
  type EntitySummary,
} from "./actions";
import DashboardView from "./DashboardView";
import ReportsView from "./ReportsView";
import StatementView from "./StatementView";
import DataEntryView from "./DataEntryView";
import ChartView from "./ChartView";
import ImportView from "./ImportView";
import ExportView from "./ExportView";

const TABS = ["Dashboard", "Reports", "Statements", "Data entry", "Chart", "Paste import", "Export"] as const;
type Tab = (typeof TABS)[number];

export default function Shell({ initialEntities }: { initialEntities: EntitySummary[] }) {
  const [entities, setEntities] = useState<EntitySummary[]>(initialEntities);
  const [activeId, setActiveId] = useState<string>(initialEntities[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [busy, setBusy] = useState(false);
  // Entity-creation modal
  const [showNew, setShowNew] = useState(false);
  const [nName, setNName] = useState("");
  const [nOwner, setNOwner] = useState("");
  const [nPass, setNPass] = useState("");
  const [nErr, setNErr] = useState("");
  // Data source: "" = start from scratch, else duplicate from that entity id.
  const [nSource, setNSource] = useState("");
  const [nSrcPass, setNSrcPass] = useState("");
  const [nSrcProtected, setNSrcProtected] = useState(false);
  // Login modal (when opening a protected entity)
  const [loginFor, setLoginFor] = useState<EntitySummary | null>(null);
  const [lOwner, setLOwner] = useState("");
  const [lPass, setLPass] = useState("");
  const [lErr, setLErr] = useState("");
  // Entities unlocked this session (ids)
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  // Bumped after any write so the Reports view refetches when revisited.
  const [dataVersion, setDataVersion] = useState(0);
  // Cross-tab focus: open a specific txn in the register (set from Statements).
  const [registerFocus, setRegisterFocus] = useState<{ account: string; txId: string } | null>(null);
  // Theme: purely a visual skin. "default" | "pretty" | "dark". No data change.
  const [theme, setTheme] = useState<"default" | "pretty" | "dark">("default");
  const [collapsed, setCollapsed] = useState(false);
  // Admin mode (UI gate; deterrent only — see deleteEntity note).
  const [admin, setAdmin] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("beanbooks.theme");
    if (t === "pretty" || t === "dark" || t === "default") setTheme(t);
    setCollapsed(localStorage.getItem("beanbooks.navCollapsed") === "1");
    // Remembered owner name prefills both modals.
    const savedOwner = localStorage.getItem("beanbooks.owner") || "";
    setNOwner(savedOwner);
    setLOwner(savedOwner);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("pretty", theme === "pretty");
    document.body.classList.toggle("dark", theme === "dark");
    localStorage.setItem("beanbooks.theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("beanbooks.navCollapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // When the duplicate source changes, learn whether it's password-protected.
  useEffect(() => {
    setNSrcPass("");
    if (!nSource) {
      setNSrcProtected(false);
      return;
    }
    getEntityProtection(nSource).then((p) => setNSrcProtected(p.protected));
  }, [nSource]);

  const active = entities.find((e) => e.id === activeId);

  function openNewModal() {
    setNName("");
    setNPass("");
    setNErr("");
    setNSource("");
    setNSrcPass("");
    setNOwner(localStorage.getItem("beanbooks.owner") || "");
    setShowNew(true);
  }

  async function handleCreate() {
    const name = nName.trim();
    if (!name) {
      setNErr("Entity name is required.");
      return;
    }
    if ((nOwner.trim() && !nPass) || (!nOwner.trim() && nPass)) {
      setNErr("To protect this entity, provide both an owner name and a password.");
      return;
    }
    const owner = nOwner.trim();
    setBusy(true);
    setNErr("");
    try {
      let created: EntitySummary;
      if (nSource) {
        // Duplicate from an existing entity. Protected sources need a password.
        const src = entities.find((e) => e.id === nSource);
        const res = await duplicateEntity(nSource, name, {
          owner: owner || undefined,
          password: nPass || undefined,
          sourceOwner: localStorage.getItem("beanbooks.owner") || "",
          sourcePassword: nSrcPass || undefined,
        });
        if (!res.ok || !res.id) {
          setNErr(res.error || "Could not duplicate.");
          setBusy(false);
          return;
        }
        created = { id: res.id, name: res.name || name };
        void src;
      } else {
        created = await addEntity(name, owner || undefined, nPass || undefined);
      }
      if (owner) localStorage.setItem("beanbooks.owner", owner);
      setEntities((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setUnlocked((s) => new Set(s).add(created.id)); // creator is unlocked
      setActiveId(created.id);
      setShowNew(false);
      setDataVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }

  // Selecting an entity: prompt for login if it's protected and not yet unlocked.
  async function selectEntity(e: EntitySummary) {
    if (unlocked.has(e.id)) {
      setActiveId(e.id);
      return;
    }
    const prot = await getEntityProtection(e.id);
    if (!prot.protected) {
      setUnlocked((s) => new Set(s).add(e.id));
      setActiveId(e.id);
      return;
    }
    setLErr("");
    setLPass("");
    setLOwner(localStorage.getItem("beanbooks.owner") || prot.owner || "");
    setLoginFor(e);
  }

  async function toggleAdmin() {
    if (admin) {
      setAdmin(false);
      return;
    }
    const pw = window.prompt("Enter admin password:");
    if (pw === null) return;
    const res = await verifyAdmin(pw);
    if (res.ok) setAdmin(true);
    else window.alert("Incorrect admin password.");
  }

  async function handleDelete(e: EntitySummary) {
    if (
      !window.confirm(
        `Permanently delete "${e.name}"? This removes the company file and cannot be undone.`
      )
    )
      return;
    const res = await deleteEntity(e.id);
    if (!res.ok) {
      window.alert(res.error || "Could not delete.");
      return;
    }
    setEntities((prev) => prev.filter((x) => x.id !== e.id));
    if (activeId === e.id) {
      const remaining = entities.filter((x) => x.id !== e.id);
      setActiveId(remaining[0]?.id ?? "");
    }
  }

  async function handleLogin() {
    if (!loginFor) return;
    const res = await verifyLogin(loginFor.id, lOwner.trim(), lPass);
    if (!res.ok) {
      setLErr("Incorrect owner name or password.");
      return;
    }
    localStorage.setItem("beanbooks.owner", lOwner.trim());
    setUnlocked((s) => new Set(s).add(loginFor.id));
    setActiveId(loginFor.id);
    setLoginFor(null);
    setLPass("");
  }

  return (
    <div className={"app" + (collapsed ? " nav-collapsed" : "")}>
      <aside>
        <div className="brand">
          {!collapsed && (
            <div className="brand-head">
              <h1>PlainGL<span style={{ opacity: 0.55, fontWeight: 600 }}>.com</span></h1>
              <div className="brand-sub">
                <span className="pill version-pill">v1.0.13</span>
                <button className="feedback-link" onClick={() => setShowFeedback(true)}>
                  FEEDBACK
                </button>
              </div>
            </div>
          )}
          <button
            className="nav-toggle"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        {!collapsed && (
          <>
            <label className="theme-select" style={{ marginBottom: 16 }}>
              Theme:
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as "default" | "pretty" | "dark")}
              >
                <option value="default">Default</option>
                <option value="pretty">Pretty</option>
                <option value="dark">Dark</option>
              </select>
            </label>

            <div className="entity-list">
              {entities.map((e) => (
                <div key={e.id} className="entity-row">
                  <button
                    className={"entity" + (e.id === activeId ? " active" : "")}
                    onClick={() => selectEntity(e)}
                  >
                    {e.name}
                  </button>
                  {admin && e.id !== "sample-company" ? (
                    <button
                      className="danger entity-del"
                      title={"Delete " + e.name}
                      onClick={() => handleDelete(e)}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="stack">
              <button className="primary" onClick={openNewModal}>
                + New entity
              </button>
            </div>
          </>
        )}

        {!collapsed && (
          <div className="nav-footer">
            <button
              className={admin ? "danger" : ""}
              style={{ width: "100%" }}
              onClick={toggleAdmin}
              title="Admin mode lets you delete company files"
            >
              {admin ? "🔓 Admin mode: ON" : "🔒 Admin mode"}
            </button>
          </div>
        )}
      </aside>

      <main>
        <div className="toolbar">
          <div>
            <strong>{active?.name ?? "No entity"}</strong>
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
        ) : tab === "Dashboard" ? (
          <DashboardView key={active.id + ":" + dataVersion} entityId={active.id} />
        ) : tab === "Reports" ? (
          <ReportsView key={active.id + ":" + dataVersion} entityId={active.id} />
        ) : tab === "Statements" ? (
          <StatementView
            key={active.id + ":" + dataVersion}
            entityId={active.id}
            onOpenTransaction={(account, txId) => {
              setRegisterFocus({ account, txId });
              setTab("Data entry");
            }}
          />
        ) : tab === "Data entry" ? (
          <DataEntryView
            entityId={active.id}
            onChange={() => setDataVersion((v) => v + 1)}
            focus={registerFocus}
            onFocusConsumed={() => setRegisterFocus(null)}
          />
        ) : tab === "Chart" ? (
          <ChartView entityId={active.id} onChange={() => setDataVersion((v) => v + 1)} />
        ) : tab === "Paste import" ? (
          <ImportView entityId={active.id} onChange={() => setDataVersion((v) => v + 1)} />
        ) : (
          <ExportView key={active.id + ":" + dataVersion} entityId={active.id} />
        )}
      </main>

      {showNew && (
        <div className="modal-overlay" onClick={() => !busy && setShowNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>New entity</h2>
            {nErr ? <div className="notice">{nErr}</div> : null}
            <div className="modal-grid">
              <label>
                Entity name
                <input
                  autoFocus
                  placeholder="e.g. Acme LLC"
                  value={nName}
                  onChange={(e) => setNName(e.target.value)}
                />
              </label>
              <label>
                File owner (name)
                <input
                  placeholder="e.g. Hector Garcia"
                  value={nOwner}
                  onChange={(e) => setNOwner(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  placeholder="Used to open this entity later"
                  value={nPass}
                  onChange={(e) => setNPass(e.target.value)}
                />
              </label>
              <label>
                Start from
                <select value={nSource} onChange={(e) => setNSource(e.target.value)}>
                  <option value="">Scratch (empty ledger)</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      Duplicate: {e.name}
                    </option>
                  ))}
                </select>
              </label>
              {nSource && nSrcProtected ? (
                <label>
                  Source password
                  <input
                    type="password"
                    placeholder="Password of the entity you're copying"
                    value={nSrcPass}
                    onChange={(e) => setNSrcPass(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Leave owner &amp; password blank for an unprotected entity. Note: this
              is a convenience lock — the underlying file is not encrypted.
            </p>
            <div className="modal-actions">
              <button onClick={() => setShowNew(false)} disabled={busy}>
                Cancel
              </button>
              <button className="primary" onClick={handleCreate} disabled={busy}>
                {busy ? "Creating…" : "Create entity"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loginFor && (
        <div className="modal-overlay" onClick={() => setLoginFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Open “{loginFor.name}”</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              This entity is protected. Enter the owner name and password.
            </p>
            {lErr ? <div className="notice">{lErr}</div> : null}
            <div className="modal-grid">
              <label>
                Owner name
                <input
                  autoFocus
                  value={lOwner}
                  onChange={(e) => setLOwner(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={lPass}
                  onChange={(e) => setLPass(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLogin();
                  }}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button onClick={() => setLoginFor(null)}>Cancel</button>
              <button className="primary" onClick={handleLogin}>
                Open
              </button>
            </div>
          </div>
        </div>
      )}

      {showFeedback && (
        <div className="modal-overlay" onClick={() => setShowFeedback(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>About PlainGL.com</h2>
            <div className="feedback-body">
              <p>
                <strong>“PlainGL”</strong> is a trademark owned by Hector Garcia, CPA.
                This project is currently an open source project — you can download
                all the code for free at{" "}
                <a
                  href="https://github.com/hexgarcia/plaingl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/hexgarcia/plaingl
                </a>
                .
              </p>
              <p>
                This app will continue to improve every week with Hector’s updates
                and those from the <strong>REFRAME SOCIETY</strong> community. Hector
                will be using this app as the ongoing use case for the{" "}
                <strong>“AI Coding Academy for Accountants”</strong> program that
                starts in July 2026. If you are not a current member, check out{" "}
                <a
                  href="https://www.hectorgarcia.com/ai"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  hectorgarcia.com/ai
                </a>
                .
              </p>
            </div>
            <div className="modal-actions">
              <button className="primary" onClick={() => setShowFeedback(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
