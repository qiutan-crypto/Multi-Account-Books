"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getAccounts, commitBankFeed } from "./actions";
import { parseBankRows } from "@/lib/beancount";

const UNCATEGORIZED = "Expenses:Uncategorized";

function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString();
  const body = "$" + dollars + "." + String(abs % 100).padStart(2, "0");
  return neg ? "-" + body : body;
}

/** The root of an account name, or "" if none. */
function root(account: string): string {
  return (account || "").split(":")[0];
}

interface Row {
  key: number;
  date: string;
  description: string;
  amountCents: number;
  ref: string;
  category: string;
}

let ROW_SEQ = 1;

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
  const [bulk, setBulk] = useState(UNCATEGORIZED);
  const [paste, setPaste] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // This view is keyed by entityId in Shell, so it remounts per entity — all
  // state (rows, source, notices) resets naturally, with no stale carryover.
  useEffect(() => {
    startTransition(async () => {
      const accs = await getAccounts(entityId);
      setAccounts(accs);
      setSource(accs.find((a) => a.startsWith("Assets")) || accs[0] || "");
    });
  }, [entityId]);

  // Source options: bank / credit-card live under Assets or Liabilities.
  const sourceAccounts = useMemo(
    () => accounts.filter((a) => root(a) === "Assets" || root(a) === "Liabilities"),
    [accounts]
  );
  // Category options: every account, plus Uncategorized if it isn't declared yet.
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
      setError("No transactions found. Expected columns: Date, Description, Amount, Ref.");
      setRows([]);
      return;
    }
    setRows(
      parsed.map((r) => ({
        key: ROW_SEQ++,
        date: r.date,
        description: r.description,
        amountCents: r.amountCents,
        ref: r.ref,
        category: UNCATEGORIZED,
      }))
    );
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => loadRows(String(reader.result || ""));
    reader.readAsText(file);
  }

  function setCategory(key: number, category: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, category } : r)));
    setOkMsg(null);
  }

  function applyBulk() {
    setRows((prev) => prev.map((r) => ({ ...r, category: bulk })));
    setOkMsg(null);
  }

  function clearAll() {
    setRows([]);
    setPaste("");
    setFileName("");
    setError(null);
    setOkMsg(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const sign = flip ? -1 : 1;
  const moneyIn = rows.filter((r) => r.amountCents * sign > 0).reduce((s, r) => s + r.amountCents * sign, 0);
  const moneyOut = rows.filter((r) => r.amountCents * sign < 0).reduce((s, r) => s + r.amountCents * sign, 0);

  function commit() {
    setError(null);
    setOkMsg(null);
    if (!source) {
      setError("Choose the source bank or credit-card account first.");
      return;
    }
    startTransition(async () => {
      const res = await commitBankFeed(
        entityId,
        source,
        rows.map((r) => ({
          date: r.date,
          description: r.description,
          amountCents: r.amountCents * sign,
          ref: r.ref,
          category: r.category,
        }))
      );
      if (!res.ok) {
        setError(res.error || "Could not add transactions.");
        return;
      }
      setAccounts(await getAccounts(entityId)); // pick up any auto-created categories
      clearAll(); // resets notices too — set the success message AFTER it
      setOkMsg(`Added ${res.added} transaction(s) to the ledger.`);
      onChange?.();
    });
  }

  return (
    <div className="grid">
      <div className="panel span-12">
        <h2 style={{ marginTop: 0 }}>Bank feed</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Upload a CSV of bank or credit-card transactions (Date, Description, Amount,
          and optional Ref). Pick the one account they belong to, choose a category for
          each row, then add them to the ledger. Amounts that are negative are treated as
          money leaving the account; positive amounts as money coming in.
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
            <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
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
          {rows.length ? <span className="pill">{rows.length} transaction(s)</span> : null}
        </div>

        {rows.length ? (
          <div className="form-grid" style={{ marginTop: 12, alignItems: "end" }}>
            <label className="wide">
              Set all categories to
              <select value={bulk} onChange={(e) => setBulk(e.target.value)}>
                {categoryAccounts.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label>
              &nbsp;
              <button onClick={applyBulk}>Apply to all</button>
            </label>
          </div>
        ) : null}

        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 96 }}>Date</th>
              <th>Description</th>
              <th style={{ width: 90 }}>Ref</th>
              <th className="amount" style={{ width: 120 }}>Amount</th>
              <th style={{ width: 260 }}>Category</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="muted" colSpan={5}>
                  Upload or paste a CSV to see transactions here.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const amt = r.amountCents * sign;
                return (
                  <tr key={r.key}>
                    <td>{r.date}</td>
                    <td>{r.description}</td>
                    <td className="muted">{r.ref}</td>
                    <td className={"amount" + (amt < 0 ? " neg" : "")} style={amt < 0 ? { color: "#b3261e" } : undefined}>
                      {money(amt)}
                    </td>
                    <td>
                      <select value={r.category} onChange={(e) => setCategory(r.key, e.target.value)} style={{ width: "100%" }}>
                        {categoryAccounts.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length ? (
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={3} style={{ textAlign: "right" }}>
                  Money in {money(moneyIn)} · Money out {money(moneyOut)}
                </td>
                <td className="amount">{money(moneyIn + moneyOut)}</td>
                <td></td>
              </tr>
            </tfoot>
          ) : null}
        </table>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="primary" onClick={commit} disabled={pending || rows.length === 0}>
            {pending ? "Adding…" : `Add ${rows.length || ""} to ledger`}
          </button>
          {rows.length ? (
            <button onClick={clearAll} disabled={pending}>
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
