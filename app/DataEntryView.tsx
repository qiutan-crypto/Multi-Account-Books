"use client";

import { useEffect, useState, useTransition } from "react";
import { addTransaction, getAccounts } from "./actions";
import RegisterView from "./RegisterView";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function DataEntryView({
  entityId,
  onChange,
  focus,
  onFocusConsumed,
}: {
  entityId: string;
  onChange?: () => void;
  focus?: { account: string; txId: string } | null;
  onFocusConsumed?: () => void;
}) {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [registerVersion, setRegisterVersion] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [date, setDate] = useState(todayISO());
  const [payee, setPayee] = useState("");
  const [narration, setNarration] = useState("");
  const [debit, setDebit] = useState("");
  const [credit, setCredit] = useState("");
  const [amount, setAmount] = useState("");

  function refresh() {
    startTransition(async () => {
      const accs = await getAccounts(entityId);
      setAccounts(accs);
      setDebit((d) => d || accs.find((a) => a.startsWith("Expenses")) || accs[0] || "");
      setCredit((c) => c || accs.find((a) => a.startsWith("Assets")) || accs[0] || "");
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  function submit() {
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      const res = await addTransaction(entityId, {
        date,
        payee,
        narration,
        debitAccount: debit,
        creditAccount: credit,
        amount,
      });
      if (!res.ok) {
        setError(res.error || "Could not save");
        return;
      }
      setOkMsg("Transaction added.");
      setPayee("");
      setNarration("");
      setAmount("");
      setRegisterVersion((v) => v + 1);
      onChange?.();
    });
  }

  return (
    <div className="grid">
      <div className="panel span-12">
        <h2>Basic data entry</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Adds a balanced two-posting transaction. The full ledger is validated
          by the Beancount engine before anything is saved.
        </p>
        {error ? <div className="notice">{error}</div> : null}
        {okMsg ? (
          <div className="notice" style={{ borderColor: "var(--accent)", background: "#e7f1ec", color: "#1c4d3e" }}>
            {okMsg}
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
              placeholder="Customer, vendor, bank"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </label>
          <label className="wide">
            Description
            <input
              placeholder="What happened"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
            />
          </label>
          <label>
            Amount
            <input
              type="number"
              step="0.01"
              placeholder="125.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="wide">
            Debit (first posting)
            <select value={debit} onChange={(e) => setDebit(e.target.value)}>
              {accounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Credit (offset)
            <select value={credit} onChange={(e) => setCredit(e.target.value)}>
              {accounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            <button className="primary" onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Add balanced transaction"}
            </button>
          </label>
        </div>
      </div>

      <RegisterView
        key={entityId + ":" + registerVersion}
        entityId={entityId}
        accountsHint={accounts}
        focus={focus}
        onFocusConsumed={onFocusConsumed}
        onChange={() => {
          setRegisterVersion((v) => v + 1);
          onChange?.();
        }}
      />
    </div>
  );
}
