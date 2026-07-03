"use client";

import { useEffect, useState, useTransition } from "react";
import { getAccounts, addJournalEntry, type JournalLine } from "./actions";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parse a decimal-ish string into cents for the live balance readout. */
function parseCents(raw: string): number {
  const s = (raw || "").trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[$,()\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

function fmt(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString();
  return sign + "$" + dollars + "." + String(abs % 100).padStart(2, "0");
}

/** A single editable line. `key` is a stable id for React list rendering. */
interface Line extends JournalLine {
  key: number;
}

let LINE_SEQ = 1;
function blankLine(): Line {
  return { key: LINE_SEQ++, account: "", debit: "", credit: "" };
}

/**
 * Split a pasted block (Excel = tab-separated, or CSV) into a grid of cells.
 * Handles simple quoted CSV fields. Tabs win when present on the first line.
 */
function splitPaste(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  const useTab = rows.length > 0 && rows[0].includes("\t");
  return rows.map((row) => {
    if (useTab) return row.split("\t").map((c) => c.trim());
    // minimal CSV: respect double-quoted fields containing commas
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (inQ) {
        if (ch === '"') {
          if (row[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

const CSV_HEADER = ["Date", "Payee", "Memo", "Account", "Debit", "Credit"];

export default function JournalEntryView({
  entityId,
  onChange,
}: {
  entityId: string;
  onChange?: () => void;
}) {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [date, setDate] = useState(todayISO());
  const [payee, setPayee] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      setAccounts(await getAccounts(entityId));
    });
  }, [entityId]);

  const totalDebit = lines.reduce((s, l) => s + Math.max(0, parseCents(l.debit)), 0);
  const totalCredit = lines.reduce((s, l) => s + Math.max(0, parseCents(l.credit)), 0);
  const diff = totalDebit - totalCredit;
  const balanced = diff === 0 && totalDebit > 0;

  function setLine(key: number, patch: Partial<JournalLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setOkMsg(null);
  }

  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }

  function removeLine(key: number) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l.key !== key)));
  }

  function reset() {
    setPayee("");
    setMemo("");
    setLines([blankLine(), blankLine()]);
  }

  function save() {
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      const res = await addJournalEntry(entityId, {
        date,
        payee,
        memo,
        lines: lines.map(({ account, debit, credit }) => ({ account, debit, credit })),
      });
      if (!res.ok) {
        setError(res.error || "Could not save the journal entry");
        return;
      }
      setOkMsg("Journal entry posted.");
      setAccounts(await getAccounts(entityId)); // pick up any auto-created accounts
      reset();
      onChange?.();
    });
  }

  // ---- CSV export (the current on-screen entry) ----------------------------
  function toCsvField(v: string): string {
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function exportCsv() {
    const body = lines
      .filter((l) => l.account.trim() || l.debit.trim() || l.credit.trim())
      .map((l) =>
        [date, payee, memo, l.account, l.debit, l.credit].map(toCsvField).join(",")
      );
    const csv = [CSV_HEADER.join(","), ...body].join("\n");
    const dataUrl =
      "data:text/csv;charset=utf-8;base64," + btoa(unescape(encodeURIComponent(csv)));
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `journal-entry-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---- CSV / Excel import (fills the on-screen entry) ----------------------
  function applyPaste() {
    setError(null);
    setOkMsg(null);
    const grid = splitPaste(paste);
    if (!grid.length) {
      setError("Nothing to import — paste rows first.");
      return;
    }
    // Detect a header row and build a column-name → index map.
    const first = grid[0].map((c) => c.toLowerCase());
    const looksLikeHeader = first.some((c) =>
      ["account", "debit", "credit", "date", "payee", "memo", "description"].includes(c)
    );
    const idx: Record<string, number> = {};
    let dataRows = grid;
    if (looksLikeHeader) {
      first.forEach((name, i) => {
        if (name === "description") idx["memo"] = i;
        else idx[name] = i;
      });
      dataRows = grid.slice(1);
    } else {
      // No header: assume Account, Debit, Credit (the common JE shape).
      idx["account"] = 0;
      idx["debit"] = 1;
      idx["credit"] = 2;
    }

    const get = (row: string[], key: string) =>
      idx[key] != null ? (row[idx[key]] ?? "").trim() : "";

    const newLines: Line[] = [];
    let d = "";
    let p = "";
    let m = "";
    for (const row of dataRows) {
      const account = get(row, "account");
      const debit = get(row, "debit");
      const credit = get(row, "credit");
      if (!account && !debit && !credit) continue;
      newLines.push({ key: LINE_SEQ++, account, debit, credit });
      // Header fields come from the first data row that carries them.
      if (!d) d = get(row, "date");
      if (!p) p = get(row, "payee");
      if (!m) m = get(row, "memo");
    }

    if (!newLines.length) {
      setError("No account lines found. Expected columns: Account, Debit, Credit.");
      return;
    }
    while (newLines.length < 2) newLines.push(blankLine());
    setLines(newLines);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d);
    if (p) setPayee(p);
    if (m) setMemo(m);
    setPaste("");
    setShowPaste(false);
    setOkMsg("Loaded " + newLines.filter((l) => l.account).length + " line(s) — review and post.");
  }

  return (
    <div className="grid">
      <div className="panel span-12">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Journal entry</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowPaste((s) => !s)}>
              {showPaste ? "Hide paste/import" : "Paste / import CSV"}
            </button>
            <button onClick={exportCsv}>Export CSV</button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          A raw multi-line entry with Debit and Credit columns. Add as many lines
          as you need; total debits must equal total credits. The full ledger is
          validated by the engine before anything is saved.
        </p>

        {error ? <div className="notice">{error}</div> : null}
        {okMsg ? (
          <div className="notice" style={{ borderColor: "var(--accent)", background: "#e7f1ec", color: "#1c4d3e" }}>
            {okMsg}
          </div>
        ) : null}

        {showPaste ? (
          <div style={{ marginBottom: 14 }}>
            <textarea
              style={{
                width: "100%",
                minHeight: 110,
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: 10,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 13,
                lineHeight: 1.5,
              }}
              placeholder={
                "Paste from Excel (tab-separated) or CSV. Columns: Account, Debit, Credit\n" +
                "Account\tDebit\tCredit\n" +
                "Expenses:Office\t250\t\n" +
                "Assets:Bank:Checking\t\t250"
              }
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="primary" onClick={applyPaste} disabled={!paste.trim()}>
                Load into entry
              </button>
              <button onClick={() => { setPaste(""); setShowPaste(false); }}>Cancel</button>
            </div>
          </div>
        ) : null}

        <div className="form-grid">
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="wide">
            Payee
            <input
              placeholder="Customer, vendor, bank (optional)"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </label>
          <label className="wide">
            Memo
            <input
              placeholder="What this entry is for (optional)"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </label>
        </div>

        <table style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Account</th>
              <th className="amount">Debit</th>
              <th className="amount">Credit</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>
                  <input
                    list="je-accounts"
                    placeholder="Assets:Bank:Checking"
                    value={l.account}
                    onChange={(e) => setLine(l.key, { account: e.target.value })}
                    style={{ width: "100%" }}
                  />
                </td>
                <td className="amount">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={l.debit}
                    onChange={(e) => setLine(l.key, { debit: e.target.value })}
                    style={{ width: "100%", textAlign: "right" }}
                  />
                </td>
                <td className="amount">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={l.credit}
                    onChange={(e) => setLine(l.key, { credit: e.target.value })}
                    style={{ width: "100%", textAlign: "right" }}
                  />
                </td>
                <td>
                  <button
                    className="danger"
                    title="Remove line"
                    onClick={() => removeLine(l.key)}
                    disabled={lines.length <= 2}
                    style={{ padding: "2px 8px" }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 600 }}>
              <td style={{ textAlign: "right" }}>Totals</td>
              <td className="amount">{fmt(totalDebit)}</td>
              <td className="amount">{fmt(totalCredit)}</td>
              <td></td>
            </tr>
            <tr>
              <td style={{ textAlign: "right" }} className="muted">
                {balanced ? "Balanced" : "Out of balance"}
              </td>
              <td className="amount" colSpan={2} style={{ color: balanced ? "var(--accent)" : "#b3261e" }}>
                {diff === 0 ? (balanced ? "✓" : "—") : fmt(diff)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <datalist id="je-accounts">
          {accounts.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>

        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={addLine}>+ Add line</button>
          <div style={{ flex: 1 }} />
          <button onClick={reset} disabled={pending}>Clear</button>
          <button className="primary" onClick={save} disabled={pending || !balanced}>
            {pending ? "Posting…" : "Post journal entry"}
          </button>
        </div>
      </div>
    </div>
  );
}
