"use client";

// Reclassify — bulk-move posted transactions to a different category.
//
// Filter the ledger's postings by account (e.g. Expenses:Uncategorized),
// date range and text; select rows (shift-click for ranges) and assign them
// a new category. Only the selected posting legs move — the bank side of
// each transaction stays put, so everything remains balanced.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getAccounts } from "./actions";
import { getPostingRows, reclassifyPostings, type PostingRowDTO } from "./feed-actions";

const UNCATEGORIZED = "Expenses:Uncategorized";

function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const body = "$" + Math.floor(abs / 100).toLocaleString() + "." + String(abs % 100).padStart(2, "0");
  return neg ? "-" + body : body;
}

type RowKey = string; // txId + ":" + postingIndex

export default function ReclassifyView({
  entityId,
  onChange,
}: {
  entityId: string;
  onChange?: () => void;
}) {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [rows, setRows] = useState<PostingRowDTO[]>([]);
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [target, setTarget] = useState(UNCATEGORIZED);
  const [selected, setSelected] = useState<Set<RowKey>>(new Set());
  const [lastKey, setLastKey] = useState<RowKey | null>(null);
  const shiftRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    startTransition(async () => {
      const accs = await getAccounts(entityId);
      setAccounts(accs);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  function keyOf(r: PostingRowDTO): RowKey {
    return r.txId + ":" + r.postingIndex;
  }

  function search() {
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      const res = await getPostingRows(entityId, {
        account: account || undefined,
        from: from || undefined,
        to: to || undefined,
        q: q || undefined,
      });
      setRows(res);
      setSelected(new Set());
      setLastKey(null);
      setLoaded(true);
    });
  }

  const categoryAccounts = useMemo(() => {
    const set = new Set(accounts);
    set.add(UNCATEGORIZED);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [accounts]);

  function handleCheck(r: PostingRowDTO) {
    const k = keyOf(r);
    const shift = shiftRef.current;
    shiftRef.current = false;
    const willSelect = !selected.has(k);
    if (shift && lastKey != null) {
      const anchor = rows.findIndex((x) => keyOf(x) === lastKey);
      const cur = rows.findIndex((x) => keyOf(x) === k);
      if (anchor !== -1 && cur !== -1) {
        const [lo, hi] = [Math.min(anchor, cur), Math.max(anchor, cur)];
        setSelected((prev) => {
          const next = new Set(prev);
          for (const x of rows.slice(lo, hi + 1)) {
            if (willSelect) next.add(keyOf(x));
            else next.delete(keyOf(x));
          }
          return next;
        });
        setLastKey(k);
        return;
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (willSelect) next.add(k);
      else next.delete(k);
      return next;
    });
    setLastKey(k);
  }

  function selectAll(state: boolean) {
    setSelected(state ? new Set(rows.map(keyOf)) : new Set());
  }

  function reclassify() {
    setError(null);
    setOkMsg(null);
    if (!selected.size) {
      setError("Select at least one row.");
      return;
    }
    if (!target) {
      setError("Choose the new category.");
      return;
    }
    const changes = rows
      .filter((r) => selected.has(keyOf(r)))
      .map((r) => ({ txId: r.txId, postingIndex: r.postingIndex, toAccount: target }));
    startTransition(async () => {
      const res = await reclassifyPostings(entityId, changes);
      if (!res.ok) {
        setError(res.error || "Could not reclassify.");
        return;
      }
      setOkMsg(`Reclassified ${res.changed} posting(s) to ${target}.`);
      onChange?.();
      // Refresh the current view.
      const refreshed = await getPostingRows(entityId, {
        account: account || undefined,
        from: from || undefined,
        to: to || undefined,
        q: q || undefined,
      });
      setRows(refreshed);
      setSelected(new Set());
      setLastKey(null);
    });
  }

  const selectedTotal = rows
    .filter((r) => selected.has(keyOf(r)))
    .reduce((s, r) => s + r.amountCents, 0);

  // Render at most this many rows to keep huge ledgers responsive; selection
  // and reclassification still operate on the full result set.
  const RENDER_CAP = 1500;
  const shownRows = rows.length > RENDER_CAP ? rows.slice(0, RENDER_CAP) : rows;

  return (
    <div className="grid">
      <div className="panel span-12">
        <h2 style={{ marginTop: 0 }}>Reclassify transactions</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Find posted transactions by category, date or text, select them, and move them to a
          different category — like the categorizer&apos;s “Reclassify Selected”, but working
          directly on the ledger. The bank side of each transaction is untouched.
        </p>

        {error ? <div className="notice">{error}</div> : null}
        {okMsg ? (
          <div className="notice" style={{ borderColor: "var(--accent)", background: "#e7f1ec", color: "#1c4d3e" }}>
            {okMsg}
          </div>
        ) : null}

        <div className="form-grid" style={{ alignItems: "end" }}>
          <label className="wide">
            Category / account (prefix matches sub-accounts)
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">All accounts</option>
              {categoryAccounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="wide">
            Search payee / description
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. amazon"
              onKeyDown={(e) => {
                if (e.key === "Enter") search();
              }}
            />
          </label>
          <label>
            <button className="primary" onClick={search} disabled={pending}>
              {pending ? "Loading…" : "Find transactions"}
            </button>
          </label>
        </div>
      </div>

      <div className="panel span-12">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Results</h2>
          {rows.length ? (
            <span className="pill">
              {selected.size} of {rows.length} selected
              {selected.size ? " · " + money(selectedTotal) : ""}
            </span>
          ) : null}
        </div>

        {rows.length ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => selectAll(true)}>Select all</button>
            <button onClick={() => selectAll(false)}>Select none</button>
            <span className="bf-lbl" style={{ marginLeft: 8 }}>Reclassify selected to</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ minWidth: 240 }}>
              {categoryAccounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <button className="primary" onClick={reclassify} disabled={pending || !selected.size}>
              {pending ? "Working…" : `Reclassify ${selected.size || ""}`}
            </button>
          </div>
        ) : null}

        <div style={{ overflowX: "auto" }}>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={(e) => selectAll(e.target.checked)}
                    disabled={!rows.length}
                  />
                </th>
                <th style={{ width: 92 }}>Date</th>
                <th>Payee</th>
                <th>Description</th>
                <th style={{ width: 70 }}>Ref</th>
                <th>Current category</th>
                <th>Other side</th>
                <th className="amount" style={{ width: 110 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={8}>
                    {loaded ? "No postings match these filters." : "Use the filters above, then “Find transactions”."}
                  </td>
                </tr>
              ) : (
                shownRows.map((r) => {
                  const k = keyOf(r);
                  const isSel = selected.has(k);
                  return (
                    <tr key={k} className={isSel ? "bf-selected" : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onClick={(e) => (shiftRef.current = (e as React.MouseEvent).shiftKey)}
                          onChange={() => handleCheck(r)}
                        />
                      </td>
                      <td>{r.date}</td>
                      <td>{r.payee || "—"}</td>
                      <td>{r.narration || "—"}</td>
                      <td>{r.ref || "—"}</td>
                      <td>
                        <span className="pill" style={{ fontSize: 11 }}>{r.account}</span>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{r.counterLabel}</td>
                      <td className="amount" style={r.amountCents < 0 ? { color: "#b3261e" } : undefined}>
                        {money(r.amountCents)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {rows.length > RENDER_CAP ? (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Showing the first {RENDER_CAP.toLocaleString()} of {rows.length.toLocaleString()} rows —
            narrow the filters to see the rest. “Select all” still selects every result.
          </p>
        ) : null}
      </div>
    </div>
  );
}
