"use client";

// Classification rules — QuickBooks Online style conditions.
//
// Each rule: text match (contains / doesn't contain / starts with / exact /
// regex, with comma-separated alternatives), direction (money in/out), an
// amount condition, an optional source-account restriction, and the category
// (ledger account) to assign. Rules run top-to-bottom; first match wins.
// They apply in the Bank Feed (automatically on load, or via "Apply rules").

import { useEffect, useMemo, useState, useTransition } from "react";
import { getAccounts } from "./actions";
import { getAuxData, saveRules } from "./feed-actions";
import { blankRule, parseRulesFile, type Rule } from "@/lib/feed/rules";

const UNCATEGORIZED = "Expenses:Uncategorized";

export default function RulesView({
  entityId,
  onChange,
}: {
  entityId: string;
  onChange?: () => void;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const [aux, accs] = await Promise.all([getAuxData(entityId), getAccounts(entityId)]);
      setRules(aux.rules || []);
      setAccounts(accs);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const categoryAccounts = useMemo(() => {
    const set = new Set(accounts);
    set.add(UNCATEGORIZED);
    for (const r of rules) if (r.category) set.add(r.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [accounts, rules]);

  const sourceAccounts = useMemo(
    () => accounts.filter((a) => a.startsWith("Assets") || a.startsWith("Liabilities")),
    [accounts]
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rules;
    return rules.filter(
      (r) =>
        r.match.toLowerCase().includes(needle) || r.category.toLowerCase().includes(needle)
    );
  }, [rules, q]);

  function patch(id: string, p: Partial<Rule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
    setDirty(true);
    setOkMsg(null);
  }
  function remove(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
    setDirty(true);
    setOkMsg(null);
  }
  function move(id: string, delta: number) {
    setRules((prev) => {
      const i = prev.findIndex((r) => r.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item);
      return next;
    });
    setDirty(true);
  }
  function add() {
    const r = blankRule();
    r.category = UNCATEGORIZED;
    setRules((prev) => [...prev, r]);
    setDirty(true);
  }

  function save() {
    setError(null);
    const bad = rules.find((r) => !r.match.trim() || !r.category.trim());
    if (bad) {
      setError("Every rule needs a keyword/pattern and a category.");
      return;
    }
    startTransition(async () => {
      const res = await saveRules(entityId, rules);
      if (!res.ok) {
        setError(res.error || "Could not save rules.");
        return;
      }
      setDirty(false);
      setOkMsg("Rules saved.");
      onChange?.();
    });
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imported = parseRulesFile(String(reader.result || ""));
      if (!imported.length) {
        setError("No rules found in the file. Expected JSON or 'keyword,category' lines.");
        return;
      }
      setRules((prev) => [...prev, ...imported]);
      setDirty(true);
      setOkMsg(`Imported ${imported.length} rule(s) — review and Save.`);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function exportRules() {
    const data = JSON.stringify(rules, null, 2);
    const a = document.createElement("a");
    a.href = "data:application/json;charset=utf-8;base64," + btoa(unescape(encodeURIComponent(data)));
    a.download = entityId + "-rules.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="grid">
      <div className="panel span-12">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Classification rules</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              placeholder="Search rules…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: 180 }}
            />
            <label style={{ display: "inline-block" }}>
              <span className="pill" style={{ cursor: "pointer" }}>Import rules…</span>
              <input type="file" accept=".json,.csv,.txt" onChange={onImportFile} style={{ display: "none" }} />
            </label>
            <button onClick={exportRules} disabled={!rules.length}>Export JSON</button>
            <button onClick={add}>+ Add rule</button>
            <button className="primary" onClick={save} disabled={pending || !dirty}>
              {pending ? "Saving…" : dirty ? "Save rules" : "Saved ✓"}
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Rules run top to bottom; the first match wins. Keywords accept comma-separated
          alternatives (e.g. <code>shell, chevron, exxon</code>). They apply in the Bank Feed —
          automatically when a file loads, or with the “Apply rules” buttons.
        </p>

        {error ? <div className="notice">{error}</div> : null}
        {okMsg ? (
          <div className="notice" style={{ borderColor: "var(--accent)", background: "#e7f1ec", color: "#1c4d3e" }}>
            {okMsg}
          </div>
        ) : null}

        <div style={{ overflowX: "auto" }}>
          <table style={{ marginTop: 12, minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>On</th>
                <th style={{ width: 46 }}>Order</th>
                <th>Text match</th>
                <th style={{ width: 130 }}>How</th>
                <th style={{ width: 110 }}>Direction</th>
                <th style={{ width: 200 }}>Amount</th>
                <th style={{ width: 160 }}>Bank account</th>
                <th style={{ width: 230 }}>Assign category</th>
                <th style={{ width: 130 }}>Set payee (opt.)</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={10}>
                    {rules.length ? "No rules match the search." : "No rules yet — add one, or import from a JSON/CSV file."}
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} style={r.enabled ? undefined : { opacity: 0.5 }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => patch(r.id, { enabled: e.target.checked })}
                        title="Enable/disable this rule"
                      />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button onClick={() => move(r.id, -1)} style={{ padding: "1px 6px", minHeight: 0 }} title="Move up">↑</button>
                      <button onClick={() => move(r.id, 1)} style={{ padding: "1px 6px", minHeight: 0 }} title="Move down">↓</button>
                    </td>
                    <td>
                      <input
                        value={r.match}
                        placeholder="keyword, alt2, alt3  — or a regex"
                        onChange={(e) => patch(r.id, { match: e.target.value })}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <select value={r.textMode} onChange={(e) => patch(r.id, { textMode: e.target.value as Rule["textMode"] })}>
                        <option value="contains">Contains</option>
                        <option value="not-contains">Doesn&apos;t contain</option>
                        <option value="starts">Starts with</option>
                        <option value="exact">Is exactly</option>
                        <option value="regex">Regex</option>
                      </select>
                    </td>
                    <td>
                      <select value={r.direction} onChange={(e) => patch(r.id, { direction: e.target.value as Rule["direction"] })}>
                        <option value="any">Any</option>
                        <option value="out">Money out</option>
                        <option value="in">Money in</option>
                      </select>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <select
                        value={r.amountOp}
                        onChange={(e) => patch(r.id, { amountOp: e.target.value as Rule["amountOp"] })}
                        style={{ width: 92 }}
                      >
                        <option value="">Any amt</option>
                        <option value="eq">=</option>
                        <option value="lt">&lt;</option>
                        <option value="le">≤</option>
                        <option value="gt">&gt;</option>
                        <option value="ge">≥</option>
                        <option value="between">Between</option>
                      </select>
                      {r.amountOp ? (
                        <input
                          type="number"
                          step="0.01"
                          value={r.amountA ?? ""}
                          onChange={(e) => patch(r.id, { amountA: e.target.value === "" ? undefined : Number(e.target.value) })}
                          style={{ width: 70, marginLeft: 4 }}
                          placeholder="0.00"
                        />
                      ) : null}
                      {r.amountOp === "between" ? (
                        <input
                          type="number"
                          step="0.01"
                          value={r.amountB ?? ""}
                          onChange={(e) => patch(r.id, { amountB: e.target.value === "" ? undefined : Number(e.target.value) })}
                          style={{ width: 70, marginLeft: 4 }}
                          placeholder="and"
                        />
                      ) : null}
                    </td>
                    <td>
                      <select
                        value={r.accounts.length === 1 ? r.accounts[0] : ""}
                        onChange={(e) => patch(r.id, { accounts: e.target.value ? [e.target.value] : [] })}
                        style={{ width: "100%" }}
                        title="Limit this rule to one bank account (or all)"
                      >
                        <option value="">All accounts</option>
                        {sourceAccounts.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={r.category}
                        onChange={(e) => patch(r.id, { category: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        <option value="">(choose)</option>
                        {categoryAccounts.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={r.payee || ""}
                        placeholder="—"
                        onChange={(e) => patch(r.id, { payee: e.target.value })}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <button className="danger" onClick={() => remove(r.id)} title="Delete rule" style={{ padding: "2px 8px", minHeight: 0 }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {dirty ? (
          <p className="muted" style={{ marginTop: 10, color: "#8a6d1a" }}>
            Unsaved changes — click “Save rules”.
          </p>
        ) : null}
      </div>
    </div>
  );
}
