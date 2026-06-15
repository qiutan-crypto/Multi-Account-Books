"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getRegister,
  getAccounts,
  updateTransaction,
  deleteTransaction,
  type RegisterRowDTO,
} from "./actions";

function money(display: string): string {
  if (!display) return "";
  const neg = display.startsWith("-");
  const [intPart, dec] = display.replace("-", "").split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-$" : "$") + withCommas + "." + dec;
}

/** Quick date-range presets for the register, computed from today. */
function registerPresets(): { label: string; from: string; to: string }[] {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const q = Math.floor(m / 3);
  const ym = (yy: number, mm: number, dd: number) => iso(new Date(Date.UTC(yy, mm, dd)));
  const monthEnd = (yy: number, mm: number) => ym(yy, mm + 1, 0);
  return [
    { label: "This month", from: ym(y, m, 1), to: monthEnd(y, m) },
    { label: "This quarter", from: ym(y, q * 3, 1), to: monthEnd(y, q * 3 + 2) },
    { label: "YTD", from: ym(y, 0, 1), to: iso(now) },
    { label: "This year", from: ym(y, 0, 1), to: ym(y, 11, 31) },
    { label: "Last year", from: ym(y - 1, 0, 1), to: ym(y - 1, 11, 31) },
    { label: "All time", from: "", to: "" },
  ];
}

interface EditState {
  date: string;
  payee: string;
  narration: string;
  postings: { account: string; amount: string }[]; // amount signed: + debit, - credit
}

export default function RegisterView({
  entityId,
  accountsHint,
  focus,
  onFocusConsumed,
  onChange,
}: {
  entityId: string;
  accountsHint?: string[];
  focus?: { account: string; txId: string } | null;
  onFocusConsumed?: () => void;
  onChange?: () => void;
}) {
  const [filter, setFilter] = useState(focus?.account || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [focusTxId, setFocusTxId] = useState<string | null>(focus?.txId || null);
  const [rows, setRows] = useState<RegisterRowDTO[]>([]);
  const [accounts, setAccounts] = useState<string[]>(accountsHint ?? []);
  const [opening, setOpening] = useState("");
  const [hasOpening, setHasOpening] = useState(false);
  const [singleLine, setSingleLine] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh(f = filter, fr = from, t = to) {
    startTransition(async () => {
      const reg = await getRegister(entityId, f, {
        from: fr || undefined,
        to: t || undefined,
      });
      setRows(reg.rows);
      setAccounts(reg.accounts);
      setOpening(reg.openingBalance);
      setHasOpening(reg.hasOpening);
    });
  }

  useEffect(() => {
    getAccounts(entityId).then(setAccounts);
    refresh(filter, from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  // When arriving via "open this transaction", open its edit row once loaded.
  useEffect(() => {
    if (!focusTxId || rows.length === 0) return;
    const target = rows.find((r) => r.id === focusTxId);
    if (target) {
      beginEdit(target);
      // scroll it into view after render
      setTimeout(() => {
        document.getElementById("reg-tx-" + focusTxId)?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 60);
    }
    setFocusTxId(null);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, focusTxId]);

  function changeFilter(f: string) {
    setFilter(f);
    setEditingId(null);
    refresh(f, from, to);
  }

  function applyRange(fr: string, t: string) {
    setFrom(fr);
    setTo(t);
    refresh(filter, fr, t);
  }

  function beginEdit(r: RegisterRowDTO) {
    setError(null);
    setEditingId(r.id);
    setEdit({
      date: r.date,
      payee: r.payee,
      narration: r.narration,
      // signed amount: debit positive, credit negative
      postings: r.postings.map((p) => ({
        account: p.account,
        amount: p.debitCents ? p.debit : "-" + p.credit,
      })),
    });
  }

  function setPosting(i: number, field: "account" | "amount", value: string) {
    if (!edit) return;
    const next = { ...edit, postings: edit.postings.map((p) => ({ ...p })) };
    next.postings[i][field] = value;
    setEdit(next);
  }

  function addPostingRow() {
    if (!edit) return;
    setEdit({ ...edit, postings: [...edit.postings, { account: accounts[0] || "", amount: "" }] });
  }

  function removePostingRow(i: number) {
    if (!edit) return;
    setEdit({ ...edit, postings: edit.postings.filter((_, j) => j !== i) });
  }

  function editSum(): number {
    if (!edit) return 0;
    return edit.postings.reduce((s, p) => {
      const n = Number(String(p.amount).replace(/[$,()\s]/g, ""));
      return s + (Number.isFinite(n) ? Math.round(n * 100) : 0);
    }, 0);
  }

  function save() {
    if (!edit || !editingId) return;
    setError(null);
    startTransition(async () => {
      const res = await updateTransaction(entityId, editingId, {
        date: edit.date,
        payee: edit.payee,
        narration: edit.narration,
        postings: edit.postings,
      });
      if (!res.ok) {
        setError(res.error || "Could not save");
        return;
      }
      setEditingId(null);
      setEdit(null);
      refresh();
      onChange?.();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteTransaction(entityId, id);
      if (!res.ok) {
        setError(res.error || "Could not delete");
        return;
      }
      if (editingId === id) {
        setEditingId(null);
        setEdit(null);
      }
      refresh();
      onChange?.();
    });
  }

  const balanced = editSum() === 0;

  return (
    <div className="panel span-12">
      <div className="reg-toolbar">
        <h2 style={{ margin: 0 }}>Ledger</h2>
        <div className="reg-controls">
          <select value={filter} onChange={(e) => changeFilter(e.target.value)} style={{ width: 260 }}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <label className="toggle">
            <input
              type="checkbox"
              checked={singleLine}
              onChange={(e) => setSingleLine(e.target.checked)}
            />
            Single-line (Excel)
          </label>
        </div>
      </div>

      <div className="reg-daterow">
        <div className="presets">
          {registerPresets().map((p) => (
            <button key={p.label} onClick={() => applyRange(p.from, p.to)} disabled={pending}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="reg-dates">
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="primary" onClick={() => refresh(filter, from, to)} disabled={pending}>
            {pending ? "…" : "Apply"}
          </button>
          <button onClick={() => applyRange("", "")} disabled={pending}>
            Clear
          </button>
        </div>
      </div>
      {from && !filter ? (
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Tip: pick an account above to see a beginning balance for the date range.
        </p>
      ) : null}

      {error ? <div className="notice">{error}</div> : null}

      {singleLine ? (
        <table className="reg flat">
          <thead>
            <tr>
              <th>Date</th>
              <th>Payee</th>
              <th>Memo</th>
              <th>{filter ? "Account" : "Postings"}</th>
              <th>{filter ? "Split / counter" : ""}</th>
              <th className="amount">Debit</th>
              <th className="amount">Credit</th>
              {filter ? <th className="amount">Balance</th> : null}
            </tr>
          </thead>
          <tbody>
            {hasOpening ? (
              <tr className="begbal">
                <td colSpan={6}>
                  <strong>Beginning balance</strong>{" "}
                  <span className="muted">(before {from})</span>
                </td>
                <td className="amount"></td>
                <td className="amount">
                  <strong>{money(opening)}</strong>
                </td>
              </tr>
            ) : null}
            {rows.length === 0 ? (
              <tr>
                <td className="muted" colSpan={filter ? 8 : 7}>
                  No transactions
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} onClick={() => beginEdit(r)} style={{ cursor: "pointer" }}>
                  <td>{r.date}</td>
                  <td>{r.payee}</td>
                  <td>{r.narration}</td>
                  <td>{filter ? filter : r.postings.map((p) => p.account).join(", ")}</td>
                  <td>{filter ? r.counterLabel : ""}</td>
                  <td className="amount">{filter ? money(r.filterDebit) : ""}</td>
                  <td className="amount">{filter ? money(r.filterCredit) : ""}</td>
                  {filter ? <td className="amount">{money(r.runningBalance)}</td> : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      ) : (
        <table className="reg">
          <thead>
            <tr>
              <th>Date</th>
              <th>Payee / Memo</th>
              <th>Account</th>
              <th className="amount">Debit</th>
              <th className="amount">Credit</th>
              {filter ? <th className="amount">Balance</th> : null}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {hasOpening ? (
              <tr className="begbal">
                <td colSpan={5}>
                  <strong>Beginning balance</strong>{" "}
                  <span className="muted">(before {from})</span>
                </td>
                <td className="amount">
                  <strong>{money(opening)}</strong>
                </td>
                <td></td>
              </tr>
            ) : null}
            {rows.length === 0 ? (
              <tr>
                <td className="muted" colSpan={filter ? 7 : 6}>
                  No transactions
                </td>
              </tr>
            ) : (
              rows.map((r) =>
                editingId === r.id && edit ? (
                  <EditRows
                    key={r.id}
                    anchorId={"reg-tx-" + r.id}
                    edit={edit}
                    accounts={accounts}
                    filter={filter}
                    balanced={balanced}
                    sum={editSum()}
                    pending={pending}
                    onField={(f, v) => setEdit({ ...edit, [f]: v })}
                    onPosting={setPosting}
                    onAddPosting={addPostingRow}
                    onRemovePosting={removePostingRow}
                    onSave={save}
                    onCancel={() => {
                      setEditingId(null);
                      setEdit(null);
                      setError(null);
                    }}
                  />
                ) : (
                  <ViewRows key={r.id} r={r} filter={filter} onEdit={() => beginEdit(r)} onDelete={() => remove(r.id)} />
                )
              )
            )}
          </tbody>
        </table>
      )}

      <style>{`
        .reg-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; flex-wrap:wrap; }
        .reg-controls { display:flex; align-items:center; gap:14px; }
        .toggle { display:flex; flex-direction:row; align-items:center; gap:6px; color:var(--ink); font-weight:600; }
        .toggle input { width:auto; }
        table.reg td, table.reg th { vertical-align: top; }
        table.flat td { white-space: nowrap; }
        .txgroup td { border-bottom: 0; }
        .txgroup.last td { border-bottom: 1px solid var(--line); }
        .editbar { display:flex; gap:8px; align-items:center; margin-top:8px; }
        .reg-daterow { display:flex; align-items:flex-end; justify-content:space-between; gap:14px; flex-wrap:wrap; margin-bottom:12px; }
        .reg-dates { display:flex; align-items:flex-end; gap:8px; }
        .reg-dates label { display:grid; gap:4px; font-size:11px; }
        .reg-dates input { width:150px; }
        .reg-dates button { white-space:nowrap; }
        tr.begbal td { background: #f1f3ea; border-top: 1px solid var(--line); }
        body.pretty tr.begbal td { background: rgba(14,165,164,0.06); }
      `}</style>
    </div>
  );
}

function ViewRows({
  r,
  filter,
  onEdit,
  onDelete,
}: {
  r: RegisterRowDTO;
  filter: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const span = filter ? 7 : 6;
  return (
    <>
      <tr className="txgroup">
        <td>{r.date}</td>
        <td>
          <strong>{r.payee || "—"}</strong>
          {r.narration ? <div className="muted">{r.narration}</div> : null}
          {filter ? <div className="muted">Counter: {r.counterLabel}</div> : null}
        </td>
        <td>{r.postings[0]?.account}</td>
        <td className="amount">{money(r.postings[0]?.debit)}</td>
        <td className="amount">{money(r.postings[0]?.credit)}</td>
        {filter ? <td className="amount">{money(r.runningBalance)}</td> : null}
        <td className="amount">
          <button onClick={onEdit}>Edit</button>
        </td>
      </tr>
      {r.postings.slice(1).map((p, i) => {
        const last = i === r.postings.length - 2;
        return (
          <tr key={i} className={"txgroup" + (last ? " last" : "")}>
            <td></td>
            <td></td>
            <td>{p.account}</td>
            <td className="amount">{money(p.debit)}</td>
            <td className="amount">{money(p.credit)}</td>
            {filter ? <td></td> : null}
            <td className="amount">{last ? <button className="danger" onClick={onDelete}>Delete</button> : null}</td>
          </tr>
        );
      })}
    </>
  );
}

function EditRows({
  edit,
  accounts,
  filter,
  balanced,
  sum,
  pending,
  onField,
  onPosting,
  onAddPosting,
  onRemovePosting,
  onSave,
  onCancel,
  anchorId,
}: {
  edit: EditState;
  accounts: string[];
  filter: string;
  balanced: boolean;
  sum: number;
  pending: boolean;
  onField: (f: "date" | "payee" | "narration", v: string) => void;
  onPosting: (i: number, field: "account" | "amount", v: string) => void;
  onAddPosting: () => void;
  onRemovePosting: (i: number) => void;
  onSave: () => void;
  onCancel: () => void;
  anchorId?: string;
}) {
  const colSpan = filter ? 7 : 6;
  return (
    <>
      <tr className="txgroup" id={anchorId}>
        <td>
          <input type="date" value={edit.date} onChange={(e) => onField("date", e.target.value)} />
        </td>
        <td colSpan={colSpan - 1}>
          <input
            placeholder="Payee"
            value={edit.payee}
            onChange={(e) => onField("payee", e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <input
            placeholder="Memo / description"
            value={edit.narration}
            onChange={(e) => onField("narration", e.target.value)}
          />
        </td>
      </tr>
      {edit.postings.map((p, i) => (
        <tr key={i} className="txgroup">
          <td></td>
          <td className="muted" style={{ fontSize: 11 }}>
            {i === 0 ? "Postings (debit +, credit −):" : ""}
          </td>
          <td>
            <select value={p.account} onChange={(e) => onPosting(i, "account", e.target.value)}>
              {accounts.includes(p.account) ? null : <option value={p.account}>{p.account}</option>}
              {accounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </td>
          <td colSpan={filter ? 3 : 2}>
            <input
              type="number"
              step="0.01"
              placeholder="signed amount"
              value={p.amount}
              onChange={(e) => onPosting(i, "amount", e.target.value)}
            />
          </td>
          <td className="amount">
            {edit.postings.length > 2 ? (
              <button onClick={() => onRemovePosting(i)} title="Remove posting">
                ×
              </button>
            ) : null}
          </td>
        </tr>
      ))}
      <tr className="txgroup last">
        <td></td>
        <td colSpan={colSpan}>
          <div className="editbar">
            <button onClick={onAddPosting}>+ Add posting</button>
            <span className={"pill " + (balanced ? "good" : "bad")}>
              {balanced ? "balanced ✓" : "off by " + (sum / 100).toFixed(2)}
            </span>
            <span style={{ flex: 1 }} />
            <button className="primary" onClick={onSave} disabled={pending || !balanced}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button onClick={onCancel} disabled={pending}>
              Cancel
            </button>
          </div>
        </td>
      </tr>
    </>
  );
}
