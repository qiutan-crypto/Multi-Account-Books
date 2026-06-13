"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getAccountRows,
  addAccount,
  removeAccount,
  type AccountRowDTO,
} from "./actions";

const ROOTS = ["Assets", "Liabilities", "Equity", "Income", "Expenses"];

function money(display: string): string {
  const neg = display.startsWith("-");
  const [intPart, dec] = display.replace("-", "").split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-$" : "$") + withCommas + "." + dec;
}

export default function ChartView({
  entityId,
  onChange,
}: {
  entityId: string;
  onChange?: () => void;
}) {
  const [rows, setRows] = useState<AccountRowDTO[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [root, setRoot] = useState("Expenses");
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");

  function refresh() {
    startTransition(async () => {
      setRows(await getAccountRows(entityId));
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  function fullName(): string {
    const n = name.trim();
    if (!n) return "";
    // If the user didn't prefix a root, prepend the selected one.
    return ROOTS.some((r) => n.startsWith(r + ":") || n === r) ? n : root + ":" + n;
  }

  function submit() {
    setError(null);
    const account = fullName();
    startTransition(async () => {
      const res = await addAccount(entityId, account, opening || undefined);
      if (!res.ok) {
        setError(res.error || "Could not add account");
        return;
      }
      setName("");
      setOpening("");
      setRows(await getAccountRows(entityId));
      onChange?.();
    });
  }

  function remove(account: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeAccount(entityId, account);
      if (!res.ok) {
        setError(res.error || "Could not remove account");
        return;
      }
      setRows(await getAccountRows(entityId));
      onChange?.();
    });
  }

  return (
    <div className="grid">
      <div className="panel span-12">
        <h2>Add account</h2>
        {error ? <div className="notice">{error}</div> : null}
        <div className="form-grid">
          <label>
            Type
            <select value={root} onChange={(e) => setRoot(e.target.value)}>
              {ROOTS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Name
            <input
              placeholder="Bank:Checking  (or full Assets:Bank:Checking)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </label>
          <label>
            Opening balance
            <input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
          </label>
          <label className="wide">
            <button className="primary" onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Add account"}
            </button>
          </label>
        </div>
        {name.trim() ? (
          <p className="muted" style={{ marginTop: 8 }}>
            Will create: <code>{fullName()}</code>
            {opening ? " · opening balance offsets to Equity:Owner" : ""}
          </p>
        ) : null}
      </div>

      <div className="panel span-12">
        <h2>Chart of accounts</h2>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th className="amount">Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="muted" colSpan={4}>
                  No accounts yet
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.account}>
                  <td>{r.account}</td>
                  <td>
                    <span className="pill">{r.type}</span>
                  </td>
                  <td className="amount">{money(r.balance)}</td>
                  <td className="amount">
                    <button
                      onClick={() => remove(r.account)}
                      disabled={pending || !r.removable}
                      title={r.removable ? "Remove account" : "Has activity — cannot remove"}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
