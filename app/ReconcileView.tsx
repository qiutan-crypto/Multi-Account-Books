"use client";

// Reconcile — compare the ledger against a bank statement, per account.
//
// Pick a bank / credit-card account and a statement period, enter the
// statement's beginning and ending balances (remembered per account), and
// compare against the ledger's cleared activity: beginning balance, payments,
// deposits, computed ending balance, and the difference. A monthly summary
// and a transaction list make hunting differences easier.

import { useEffect, useMemo, useState, useTransition } from "react";
import { getAccounts } from "./actions";
import {
  getReconcileData,
  saveReconcileSettings,
  type ReconcileDTO,
} from "./feed-actions";

function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const body = "$" + Math.floor(abs / 100).toLocaleString() + "." + String(abs % 100).padStart(2, "0");
  return neg ? "-" + body : body;
}

function centsFromInput(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t.replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

export default function ReconcileView({ entityId }: { entityId: string }) {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<ReconcileDTO | null>(null);
  const [begInput, setBegInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [view, setView] = useState<"summary" | "detail">("summary");
  const [monthKey, setMonthKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const accs = await getAccounts(entityId);
      const banks = accs.filter((a) => a.startsWith("Assets") || a.startsWith("Liabilities"));
      setAccounts(banks);
      const first = banks.find((a) => a.startsWith("Assets:Bank")) || banks[0] || "";
      setAccount(first);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  useEffect(() => {
    if (!account) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  function refresh() {
    setError(null);
    startTransition(async () => {
      const d = await getReconcileData(entityId, account, {
        from: from || undefined,
        to: to || undefined,
      });
      setData(d);
      if (d) {
        if (!from) setFrom(d.from);
        if (!to) setTo(d.to);
        setBegInput(
          d.settings.beginningCents != null ? (d.settings.beginningCents / 100).toFixed(2) : ""
        );
        setEndInput(
          d.settings.endingCents != null ? (d.settings.endingCents / 100).toFixed(2) : ""
        );
        setMonthKey("");
      }
    });
  }

  function saveBalances() {
    setError(null);
    startTransition(async () => {
      const res = await saveReconcileSettings(entityId, account, {
        from: from || undefined,
        to: to || undefined,
        beginningCents: centsFromInput(begInput),
        endingCents: centsFromInput(endInput),
      });
      if (!res.ok) {
        setError(res.error || "Could not save.");
        return;
      }
      setOkMsg("Statement balances saved.");
      setTimeout(() => setOkMsg(null), 1500);
      refresh();
    });
  }

  const stmtBeg = centsFromInput(begInput);
  const stmtEnd = centsFromInput(endInput);

  // Difference: statement ending vs (statement beginning + cleared activity).
  // When no statement beginning is set, the ledger's own beginning is used.
  const clearedActivity = data ? data.paymentsCents + data.depositsCents : 0;
  const baseBeginning = stmtBeg != null ? stmtBeg : data?.beginningLedgerCents ?? 0;
  const computedEnding = baseBeginning + clearedActivity;
  const difference = stmtEnd != null ? stmtEnd - computedEnding : null;

  const monthTxns = useMemo(() => {
    if (!data || !monthKey) return data?.txns || [];
    return data.txns.filter((t) => t.date.startsWith(monthKey));
  }, [data, monthKey]);

  return (
    <div className="grid">
      <div className="panel span-12">
        <h2 style={{ marginTop: 0 }}>Reconcile</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Compare a bank account&apos;s ledger activity against the bank statement. Enter the
          statement balances; the difference should reach $0.00 when everything is recorded.
        </p>

        {error ? <div className="notice">{error}</div> : null}
        {okMsg ? (
          <div className="notice" style={{ borderColor: "var(--accent)", background: "#e7f1ec", color: "#1c4d3e" }}>
            {okMsg}
          </div>
        ) : null}

        <div className="form-grid" style={{ alignItems: "end" }}>
          <label className="wide">
            Bank / credit-card account
            <select value={account} onChange={(e) => { setFrom(""); setTo(""); setAccount(e.target.value); }}>
              {accounts.length === 0 ? <option value="">No bank accounts yet</option> : null}
              {accounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label>
            Statement from
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Statement to
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            <button onClick={refresh} disabled={pending || !account}>
              {pending ? "Loading…" : "Refresh"}
            </button>
          </label>
          <label>
            Statement beginning balance
            <input
              type="number"
              step="0.01"
              value={begInput}
              onChange={(e) => setBegInput(e.target.value)}
              placeholder={data ? (data.beginningLedgerCents / 100).toFixed(2) : "0.00"}
            />
          </label>
          <label>
            Statement ending balance
            <input
              type="number"
              step="0.01"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label>
            <button className="primary" onClick={saveBalances} disabled={pending || !account}>
              Save balances
            </button>
          </label>
        </div>
      </div>

      {data ? (
        <div className="panel span-12">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div className="panel" style={{ flex: "1 1 150px", margin: 0 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Beginning balance</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{money(baseBeginning)}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {stmtBeg != null ? "from statement" : "from ledger (before " + data.from + ")"}
              </div>
            </div>
            <div className="panel" style={{ flex: "1 1 150px", margin: 0 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>
                Payments ({data.paymentsCount})
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#b3261e" }}>{money(data.paymentsCents)}</div>
            </div>
            <div className="panel" style={{ flex: "1 1 150px", margin: 0 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>
                Deposits ({data.depositsCount})
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#1c4d3e" }}>{money(data.depositsCents)}</div>
            </div>
            <div className="panel" style={{ flex: "1 1 150px", margin: 0 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Computed ending</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{money(computedEnding)}</div>
            </div>
            <div
              className="panel"
              style={{
                flex: "1 1 150px",
                margin: 0,
                borderColor: difference === 0 ? "var(--accent)" : difference != null ? "#b3261e" : undefined,
              }}
            >
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Difference</div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: difference === 0 ? "var(--accent)" : difference != null ? "#b3261e" : undefined,
                }}
              >
                {difference != null ? money(difference) : "—"}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {difference == null
                  ? "enter the statement ending balance"
                  : difference === 0
                  ? "reconciled ✓"
                  : "statement vs ledger"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button className={view === "summary" ? "primary" : ""} onClick={() => setView("summary")}>
              Monthly summary
            </button>
            <button className={view === "detail" ? "primary" : ""} onClick={() => setView("detail")}>
              Transactions {monthKey ? "(" + monthKey + ")" : ""}
            </button>
          </div>

          {view === "summary" ? (
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="amount">Payments</th>
                  <th className="amount">Deposits</th>
                  <th className="amount">Net</th>
                  <th className="amount">Ledger balance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.months.length === 0 ? (
                  <tr>
                    <td className="muted" colSpan={6}>
                      No activity in this period.
                    </td>
                  </tr>
                ) : (
                  data.months.map((m) => (
                    <tr key={m.key}>
                      <td>{m.label}</td>
                      <td className="amount" style={{ color: "#b3261e" }}>
                        {money(m.paymentsCents)}{" "}
                        <span className="muted" style={{ fontSize: 11 }}>({m.paymentsCount})</span>
                      </td>
                      <td className="amount" style={{ color: "#1c4d3e" }}>
                        {money(m.depositsCents)}{" "}
                        <span className="muted" style={{ fontSize: 11 }}>({m.depositsCount})</span>
                      </td>
                      <td className="amount">{money(m.paymentsCents + m.depositsCents)}</td>
                      <td className="amount">{money(m.endingCents)}</td>
                      <td>
                        <button
                          style={{ padding: "2px 8px", minHeight: 0, fontSize: 12 }}
                          onClick={() => {
                            setMonthKey(m.key);
                            setView("detail");
                          }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <>
              {monthKey ? (
                <p className="muted" style={{ fontSize: 12 }}>
                  Showing {monthKey} only —{" "}
                  <button style={{ padding: "1px 8px", minHeight: 0, fontSize: 12 }} onClick={() => setMonthKey("")}>
                    show all
                  </button>
                </p>
              ) : null}
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 92 }}>Date</th>
                    <th>Payee</th>
                    <th>Description</th>
                    <th style={{ width: 70 }}>Ref</th>
                    <th>Category</th>
                    <th className="amount" style={{ width: 110 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {monthTxns.length === 0 ? (
                    <tr>
                      <td className="muted" colSpan={6}>
                        No transactions.
                      </td>
                    </tr>
                  ) : (
                    monthTxns.map((t, i) => (
                      <tr key={t.txId + ":" + i}>
                        <td>{t.date}</td>
                        <td>{t.payee || "—"}</td>
                        <td>{t.narration || "—"}</td>
                        <td>{t.ref || "—"}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{t.counterLabel}</td>
                        <td className="amount" style={t.amountCents < 0 ? { color: "#b3261e" } : undefined}>
                          {money(t.amountCents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
