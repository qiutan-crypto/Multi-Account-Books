"use client";

// QuickBooks Desktop exports — ported from the Bank Transaction Categorizer.
// Chart of Accounts (IIF), Journal Entries (IIF), .qbo Web Connect per bank
// account, and an Excel of classified transactions.

import { useEffect, useMemo, useState, useTransition } from "react";
import { getExportData, type ExportDataDTO } from "./feed-actions";
import {
  generateCoaIif,
  generateJournalIif,
  generateQbo,
  qbName,
  download,
} from "@/lib/feed/qbexport";

export default function QuickBooksExportView({ entityId }: { entityId: string }) {
  const [data, setData] = useState<ExportDataDTO | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stripRoot, setStripRoot] = useState(true);
  const [qboAccount, setQboAccount] = useState("");
  const [qboType, setQboType] = useState<"BANK" | "CREDITCARD">("BANK");
  const [last4, setLast4] = useState("");
  const [includeCategory, setIncludeCategory] = useState(true);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const d = await getExportData(entityId, {
        from: from || undefined,
        to: to || undefined,
      });
      setData(d);
      if (d) {
        const banks = d.accounts.filter((a) => a.type === "Assets" || a.type === "Liabilities");
        setQboAccount((prev) => (prev && banks.some((b) => b.account === prev) ? prev : banks[0]?.account || ""));
      }
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const bankAccounts = useMemo(
    () =>
      (data?.accounts || []).filter((a) => a.type === "Assets" || a.type === "Liabilities"),
    [data]
  );

  function note(key: string, text: string) {
    setMsg((m) => ({ ...m, [key]: text }));
  }

  function exportCoa() {
    if (!data) return;
    const res = generateCoaIif(
      data.accounts.map((a) => ({ ...a, description: data.coaDesc[a.account] || "" })),
      { stripRoot }
    );
    if (!res.count) {
      note("coa", "No accounts to export.");
      return;
    }
    download(entityId + "-coa.iif", res.content);
    note("coa", `Exported ${res.count} account(s).`);
  }

  function exportJournal() {
    if (!data) return;
    const res = generateJournalIif(data.txns, { stripRoot });
    if (!res.count) {
      note("journal", "No transactions in this date range.");
      return;
    }
    download(entityId + "-journal.iif", res.content);
    note("journal", `Exported ${res.count} journal entrie(s).`);
  }

  function exportQbo() {
    if (!data) return;
    if (!/^\d{4}$/.test(last4)) {
      note("qbo", "Enter the account's last 4 digits.");
      return;
    }
    if (!qboAccount) {
      note("qbo", "Pick a bank account.");
      return;
    }
    const res = generateQbo(data.txns, qboAccount, {
      acctType: qboType,
      last4,
      includeCategory,
      stripRoot,
    });
    if (!res.count) {
      note("qbo", "No transactions for this account in the date range.");
      return;
    }
    download(entityId + "-" + last4 + ".qbo", res.content, "application/x-qbo");
    note("qbo", `Exported ${res.count} transaction(s) for ${qboAccount}.`);
  }

  async function exportExcel() {
    if (!data) return;
    const XLSX = await import("xlsx");
    // One row per bank leg: from that account's perspective, with the
    // category as the counter side — the classic "classified transactions".
    const bankSet = new Set(bankAccounts.map((b) => b.account));
    const rows: Record<string, string | number>[] = [];
    for (const t of data.txns) {
      const bankLegs = t.postings.filter((p) => bankSet.has(p.account));
      const legs = bankLegs.length ? bankLegs : t.postings.slice(0, 1);
      for (const leg of legs) {
        const others = t.postings.filter((p) => p !== leg);
        const category =
          others.length === 1 ? qbName(others[0].account, stripRoot) : others.length ? "Split" : "";
        rows.push({
          Date: t.date,
          Account: qbName(leg.account, stripRoot),
          Payee: t.payee,
          Description: t.narration,
          Ref: t.ref,
          Amount: leg.amountCents / 100,
          Category: category,
        });
      }
    }
    if (!rows.length) {
      note("excel", "No transactions in this date range.");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Classified Transactions");
    XLSX.writeFile(wb, entityId + "-classified.xlsx");
    note("excel", `Exported ${rows.length} row(s).`);
  }

  return (
    <div className="grid">
      <div className="panel span-12">
        <h2 style={{ marginTop: 0 }}>QuickBooks Desktop exports</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Convert this ledger into QuickBooks Desktop formats: a Chart of Accounts IIF, Journal
          Entries IIF, per-account .qbo Web Connect files, and a classified-transactions Excel.
        </p>

        <div className="form-grid" style={{ alignItems: "end" }}>
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            <button onClick={load} disabled={pending}>
              {pending ? "Loading…" : "Apply date range"}
            </button>
          </label>
          <label className="radio" style={{ alignSelf: "center" }}>
            <input type="checkbox" checked={stripRoot} onChange={(e) => setStripRoot(e.target.checked)} />
            Strip root prefix (Assets:, Expenses:, …) from names
          </label>
        </div>
        {data ? (
          <p className="muted" style={{ fontSize: 12 }}>
            {data.txns.length.toLocaleString()} transaction(s) · {data.accounts.length} account(s) in scope.
          </p>
        ) : null}
      </div>

      <div className="panel span-6">
        <h3 style={{ marginTop: 0 }}>Chart of Accounts (IIF)</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Every ledger account with an inferred QuickBooks account type (BANK, CCARD, INC, EXP, …)
          and its description.
        </p>
        <button className="primary" onClick={exportCoa} disabled={!data}>
          Download COA IIF
        </button>
        {msg.coa ? <p className="muted" style={{ fontSize: 12 }}>{msg.coa}</p> : null}
      </div>

      <div className="panel span-6">
        <h3 style={{ marginTop: 0 }}>Journal Entries (IIF)</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Every transaction in the date range as a GENERAL JOURNAL entry — bank line plus category
          lines, exactly as posted.
        </p>
        <button className="primary" onClick={exportJournal} disabled={!data}>
          Download Journal IIF
        </button>
        {msg.journal ? <p className="muted" style={{ fontSize: 12 }}>{msg.journal}</p> : null}
      </div>

      <div className="panel span-6">
        <h3 style={{ marginTop: 0 }}>QuickBooks Desktop (.qbo)</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Web Connect file for one bank / credit-card account, importable via Bank Feeds.
        </p>
        <div className="form-grid">
          <label className="wide">
            Account
            <select value={qboAccount} onChange={(e) => setQboAccount(e.target.value)}>
              {bankAccounts.map((a) => (
                <option key={a.account} value={a.account}>
                  {a.account}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={qboType} onChange={(e) => setQboType(e.target.value as "BANK" | "CREDITCARD")}>
              <option value="BANK">Bank</option>
              <option value="CREDITCARD">Credit card</option>
            </select>
          </label>
          <label>
            Last 4 digits
            <input value={last4} maxLength={4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} placeholder="1234" />
          </label>
          <label className="radio" style={{ alignSelf: "center" }}>
            <input
              type="checkbox"
              checked={includeCategory}
              onChange={(e) => setIncludeCategory(e.target.checked)}
            />
            Category in NAME field
          </label>
        </div>
        <button className="primary" onClick={exportQbo} disabled={!data} style={{ marginTop: 8 }}>
          Download .qbo
        </button>
        {msg.qbo ? <p className="muted" style={{ fontSize: 12 }}>{msg.qbo}</p> : null}
      </div>

      <div className="panel span-6">
        <h3 style={{ marginTop: 0 }}>Classified transactions (Excel)</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          All transactions with Date, Account, Payee, Description, Amount and Category — one row per
          bank leg.
        </p>
        <button className="primary" onClick={exportExcel} disabled={!data}>
          Download Excel
        </button>
        {msg.excel ? <p className="muted" style={{ fontSize: 12 }}>{msg.excel}</p> : null}
      </div>
    </div>
  );
}
