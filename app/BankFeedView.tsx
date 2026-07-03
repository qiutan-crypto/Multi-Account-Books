"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getAccounts, commitBankFeed } from "./actions";
import { parseBankRows, toCents, fromCents } from "@/lib/beancount";

const UNCATEGORIZED = "Expenses:Uncategorized";

function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString();
  const body = "$" + dollars + "." + String(abs % 100).padStart(2, "0");
  return neg ? "-" + body : body;
}

function root(account: string): string {
  return (account || "").split(":")[0];
}

type Filter = "all" | "in" | "out";
type SortKey = "original" | "date" | "description" | "amount";

interface Split {
  key: number;
  category: string;
  amount: string; // signed decimal string; only meaningful when a row has 2+ splits
}

interface Row {
  key: number;
  originalIndex: number;
  date: string;
  payee: string;
  description: string;
  ref: string;
  amountCents: number; // effective (flip already applied)
  splits: Split[]; // length 1 = simple (single category); 2+ = split
  selected: boolean;
}

let SEQ = 1;

export default function BankFeedView({
  entityId,
  onChange,
}: {
  entityId: string;
  onChange?: () => void;
}) {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [flip, setFlip] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("original");
  const [bulk, setBulk] = useState(UNCATEGORIZED);
  const [paste, setPaste] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const shiftRef = useRef(false);
  const [lastKey, setLastKey] = useState<number | null>(null);

  useEffect(() => {
    startTransition(async () => {
      const accs = await getAccounts(entityId);
      setAccounts(accs);
      setSource(accs.find((a) => a.startsWith("Assets")) || accs[0] || "");
    });
  }, [entityId]);

  const sourceAccounts = useMemo(
    () => accounts.filter((a) => root(a) === "Assets" || root(a) === "Liabilities"),
    [accounts]
  );
  const categoryAccounts = useMemo(() => {
    const set = new Set(accounts);
    set.add(UNCATEGORIZED);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [accounts]);

  function loadRows(text: string) {
    setError(null);
    setOkMsg(null);
    const parsed = parseBankRows(text);
    if (!parsed.length) {
      setError("No transactions found. Expected columns: Date, Description, Amount, Ref (Payee optional).");
      setRows([]);
      return;
    }
    const s = flip ? -1 : 1;
    setRows(
      parsed.map((r, i) => ({
        key: SEQ++,
        originalIndex: i,
        date: r.date,
        payee: r.payee,
        description: r.description,
        ref: r.ref,
        amountCents: r.amountCents * s,
        splits: [{ key: SEQ++, category: UNCATEGORIZED, amount: "" }],
        selected: false,
      }))
    );
    setLastKey(null);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => loadRows(String(reader.result || ""));
    reader.readAsText(file);
  }

  function toggleFlip(v: boolean) {
    setFlip(v);
    // Negate every amount in place so the effective figures stay consistent —
    // including any split amounts the user already typed.
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        amountCents: -r.amountCents,
        splits: r.splits.map((sp) => ({
          ...sp,
          amount: sp.amount ? fromCents(-toCents(sp.amount)) : sp.amount,
        })),
      }))
    );
  }

  // ---- per-row field editing ----------------------------------------------
  function patchRow(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setOkMsg(null);
  }
  function setSplit(rowKey: number, splitKey: number, patch: Partial<Split>) {
    setRows((prev) =>
      prev.map((r) =>
        r.key === rowKey
          ? { ...r, splits: r.splits.map((s) => (s.key === splitKey ? { ...s, ...patch } : s)) }
          : r
      )
    );
    setOkMsg(null);
  }
  function addSplit(rowKey: number) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== rowKey) return r;
        // First split: seed with the full amount so the user reallocates from it.
        const splits =
          r.splits.length === 1
            ? [{ ...r.splits[0], amount: fromCents(r.amountCents) }]
            : r.splits.slice();
        splits.push({ key: SEQ++, category: UNCATEGORIZED, amount: "" });
        return { ...r, splits };
      })
    );
    setOkMsg(null);
  }
  function removeSplit(rowKey: number, splitKey: number) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== rowKey) return r;
        let splits = r.splits.filter((s) => s.key !== splitKey);
        if (splits.length <= 1) splits = [{ ...splits[0], amount: "" }]; // collapse to simple
        return { ...r, splits };
      })
    );
    setOkMsg(null);
  }

  // ---- filter + sort ------------------------------------------------------
  const visibleRows = useMemo(() => {
    const match = (r: Row) =>
      filter === "all" ? true : filter === "in" ? r.amountCents > 0 : r.amountCents < 0;
    const out = rows.filter(match);
    const byIndex = (a: Row, b: Row) => a.originalIndex - b.originalIndex;
    if (sortKey === "date") out.sort((a, b) => a.date.localeCompare(b.date) || byIndex(a, b));
    else if (sortKey === "description")
      out.sort((a, b) => a.description.localeCompare(b.description) || byIndex(a, b));
    else if (sortKey === "amount") out.sort((a, b) => a.amountCents - b.amountCents || byIndex(a, b));
    else out.sort(byIndex);
    return out;
  }, [rows, filter, sortKey]);

  // ---- split math + validity ---------------------------------------------
  function splitSum(r: Row): number {
    return r.splits.reduce((s, sp) => s + toCents(sp.amount), 0);
  }
  function remaining(r: Row): number {
    return r.amountCents - splitSum(r);
  }
  function rowValid(r: Row): boolean {
    if (r.splits.length === 1) return !!r.splits[0].category && r.amountCents !== 0;
    return (
      r.splits.every((s) => s.category && toCents(s.amount) !== 0) && splitSum(r) === r.amountCents
    );
  }

  // ---- selection ----------------------------------------------------------
  function handleCheck(row: Row) {
    const shift = shiftRef.current;
    shiftRef.current = false;
    const vis = visibleRows;
    const newState = !row.selected;
    if (shift && lastKey != null) {
      const anchor = vis.findIndex((r) => r.key === lastKey);
      const cur = vis.findIndex((r) => r.key === row.key);
      if (anchor !== -1 && cur !== -1) {
        const [lo, hi] = [Math.min(anchor, cur), Math.max(anchor, cur)];
        const keys = new Set(vis.slice(lo, hi + 1).map((r) => r.key));
        setRows((prev) => prev.map((r) => (keys.has(r.key) ? { ...r, selected: newState } : r)));
        setLastKey(row.key);
        return;
      }
    }
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, selected: newState } : r)));
    setLastKey(row.key);
  }
  function selectVisible(state: boolean) {
    const keys = new Set(visibleRows.map((r) => r.key));
    setRows((prev) => prev.map((r) => (keys.has(r.key) ? { ...r, selected: state } : r)));
  }

  const selectedRows = rows.filter((r) => r.selected);
  const selectedInvalid = selectedRows.filter((r) => !rowValid(r)).length;
  const moneyIn = visibleRows.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0);
  const moneyOut = visibleRows.filter((r) => r.amountCents < 0).reduce((s, r) => s + r.amountCents, 0);

  function clearAll() {
    setRows([]);
    setPaste("");
    setFileName("");
    setError(null);
    setOkMsg(null);
    setLastKey(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function applyBulk() {
    setRows((prev) =>
      prev.map((r) =>
        r.splits.length === 1 ? { ...r, splits: [{ ...r.splits[0], category: bulk }] } : r
      )
    );
    setOkMsg(null);
  }

  function commit() {
    setError(null);
    setOkMsg(null);
    if (!source) {
      setError("Choose the source bank or credit-card account first.");
      return;
    }
    if (!selectedRows.length) {
      setError("Select at least one transaction to post.");
      return;
    }
    if (selectedInvalid) {
      setError("Some selected rows aren't fully categorized or their splits don't add up. Fix them or deselect.");
      return;
    }
    const payload = selectedRows.map((r) => ({
      date: r.date,
      payee: r.payee,
      description: r.description,
      ref: r.ref,
      amountCents: r.amountCents,
      splits:
        r.splits.length === 1
          ? [{ category: r.splits[0].category, amountCents: r.amountCents }]
          : r.splits.map((s) => ({ category: s.category, amountCents: toCents(s.amount) })),
    }));
    const postedKeys = new Set(selectedRows.map((r) => r.key));
    startTransition(async () => {
      const res = await commitBankFeed(entityId, source, payload);
      if (!res.ok) {
        setError(res.error || "Could not add transactions.");
        return;
      }
      setAccounts(await getAccounts(entityId)); // pick up any auto-created categories
      const left = rows.filter((r) => !postedKeys.has(r.key));
      setRows(left);
      setLastKey(null);
      setOkMsg(`Added ${res.added} transaction(s). ${left.length} left in the feed.`);
      onChange?.();
    });
  }

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => r.selected);

  return (
    <div className="grid">
      <div className="panel span-12">
        <h2 style={{ marginTop: 0 }}>Bank feed</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Upload a CSV of bank or credit-card transactions (Date, Description, Amount, optional
          Payee and Ref). Pick the one account they belong to, categorize each row (split a row
          into several categories if needed), select the ones to post, and add them to the ledger.
          Negative amounts are money leaving the account; positive amounts are money coming in.
        </p>

        {error ? <div className="notice">{error}</div> : null}
        {okMsg ? (
          <div className="notice" style={{ borderColor: "var(--accent)", background: "#e7f1ec", color: "#1c4d3e" }}>
            {okMsg}
          </div>
        ) : null}

        <div className="form-grid" style={{ alignItems: "end" }}>
          <label className="wide">
            Source account (bank / credit card)
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {sourceAccounts.length === 0 ? <option value="">No bank accounts yet</option> : null}
              {sourceAccounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            CSV file
            <input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFile} className="file-input" />
            {fileName ? <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>Loaded {fileName}</span> : null}
          </label>
          <label className="radio" style={{ alignSelf: "center" }}>
            <input type="checkbox" checked={flip} onChange={(e) => toggleFlip(e.target.checked)} />
            Flip signs
          </label>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
            …or paste rows instead of uploading a file
          </summary>
          <textarea
            style={{
              width: "100%",
              minHeight: 110,
              marginTop: 8,
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: 10,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 13,
              lineHeight: 1.5,
            }}
            placeholder={"Date,Description,Amount,Ref\n6/4/26,SHELL OIL,-64.32,\n6/5/26,CLIENT DEPOSIT,375.00,1042"}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <button style={{ marginTop: 8 }} onClick={() => loadRows(paste)} disabled={!paste.trim()}>
            Load pasted rows
          </button>
        </details>
      </div>

      <div className="panel span-12">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Review &amp; categorize</h2>
          {rows.length ? (
            <span className="pill">
              {selectedRows.length} of {rows.length} selected
            </span>
          ) : null}
        </div>

        {rows.length ? (
          <div className="bf-controls">
            <div className="bf-control">
              <span className="bf-lbl">Show</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                <option value="all">All</option>
                <option value="in">Money in</option>
                <option value="out">Money out</option>
              </select>
            </div>
            <div className="bf-control">
              <span className="bf-lbl">Sort by</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="original">Original order</option>
                <option value="date">Date</option>
                <option value="description">Description</option>
                <option value="amount">Amount</option>
              </select>
            </div>
            <div className="bf-control">
              <button onClick={() => selectVisible(true)}>Select all</button>
              <button onClick={() => selectVisible(false)}>Select none</button>
            </div>
            <div className="bf-control">
              <span className="bf-lbl">Set all to</span>
              <select value={bulk} onChange={(e) => setBulk(e.target.value)}>
                {categoryAccounts.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <button onClick={applyBulk}>Apply</button>
            </div>
          </div>
        ) : null}

        <table className="bf-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 30 }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => selectVisible(e.target.checked)}
                  title="Select all shown"
                  disabled={visibleRows.length === 0}
                />
              </th>
              <th style={{ width: 92 }}>Date</th>
              <th>Payee</th>
              <th>Description</th>
              <th style={{ width: 84 }}>Ref</th>
              <th className="amount" style={{ width: 110 }}>Amount</th>
              <th style={{ width: 300 }}>Category</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td className="muted" colSpan={7}>
                  {rows.length ? "No rows match this filter." : "Upload or paste a CSV to see transactions here."}
                </td>
              </tr>
            ) : (
              visibleRows.map((r) => {
                const rem = remaining(r);
                const invalid = r.selected && !rowValid(r);
                return (
                  <tr key={r.key} className={r.selected ? "bf-selected" : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onClick={(e) => (shiftRef.current = (e as React.MouseEvent).shiftKey)}
                        onChange={() => handleCheck(r)}
                      />
                    </td>
                    <td>{r.date}</td>
                    <td>
                      <input
                        value={r.payee}
                        placeholder="—"
                        onChange={(e) => patchRow(r.key, { payee: e.target.value })}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <input
                        value={r.description}
                        onChange={(e) => patchRow(r.key, { description: e.target.value })}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <input
                        value={r.ref}
                        placeholder="—"
                        onChange={(e) => patchRow(r.key, { ref: e.target.value })}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td className="amount" style={r.amountCents < 0 ? { color: "#b3261e" } : undefined}>
                      {money(r.amountCents)}
                    </td>
                    <td>
                      {r.splits.map((s) => (
                        <div key={s.key} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: r.splits.length > 1 ? 4 : 0 }}>
                          <select
                            value={s.category}
                            onChange={(e) => setSplit(r.key, s.key, { category: e.target.value })}
                            style={{ flex: 1, minWidth: 0 }}
                          >
                            {categoryAccounts.map((a) => (
                              <option key={a} value={a}>
                                {a}
                              </option>
                            ))}
                          </select>
                          {r.splits.length > 1 ? (
                            <>
                              <input
                                type="number"
                                step="0.01"
                                value={s.amount}
                                placeholder="0.00"
                                onChange={(e) => setSplit(r.key, s.key, { amount: e.target.value })}
                                style={{ width: 88, textAlign: "right" }}
                              />
                              <button className="danger" title="Remove split" onClick={() => removeSplit(r.key, s.key)} style={{ padding: "2px 7px", minHeight: 0 }}>
                                ×
                              </button>
                            </>
                          ) : null}
                        </div>
                      ))}
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                        <button onClick={() => addSplit(r.key)} style={{ padding: "2px 8px", minHeight: 0, fontSize: 12 }}>
                          + Split
                        </button>
                        {r.splits.length > 1 ? (
                          <span className="muted" style={{ fontSize: 11, color: rem !== 0 ? "#b3261e" : "var(--accent)" }}>
                            {rem === 0 ? "balanced ✓" : "remaining " + money(rem)}
                          </span>
                        ) : null}
                        {invalid && r.splits.length === 1 ? (
                          <span className="muted" style={{ fontSize: 11, color: "#b3261e" }}>needs a category</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length ? (
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={5} style={{ textAlign: "right" }}>
                  Shown: {visibleRows.length} · Money in {money(moneyIn)} · Money out {money(moneyOut)}
                </td>
                <td className="amount">{money(moneyIn + moneyOut)}</td>
                <td></td>
              </tr>
            </tfoot>
          ) : null}
        </table>

        <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button className="primary" onClick={commit} disabled={pending || selectedRows.length === 0}>
            {pending ? "Adding…" : `Add ${selectedRows.length || ""} selected to ledger`}
          </button>
          {selectedInvalid ? (
            <span className="muted" style={{ color: "#b3261e", fontSize: 12 }}>
              {selectedInvalid} selected row(s) need attention (category or split total).
            </span>
          ) : null}
          {rows.length ? (
            <button onClick={clearAll} disabled={pending}>
              Clear feed
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
