"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
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

// Parse a formatted balance string ("-1,234.56" or "1234.56") to cents.
function toCents(display: string): number {
  const neg = display.trim().startsWith("-");
  const digits = display.replace(/[^0-9.]/g, "");
  const [intPart, dec = "0"] = digits.split(".");
  const cents = parseInt(intPart || "0", 10) * 100 + parseInt(dec.padEnd(2, "0").slice(0, 2), 10);
  return neg ? -cents : cents;
}

function centsToStr(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return (neg ? "-" : "") + Math.floor(abs / 100) + "." + String(abs % 100).padStart(2, "0");
}

// A node in the chart-of-accounts tree.
interface TreeNode {
  segment: string; // leaf segment, e.g. "Checking"
  full: string; // full path, e.g. "Assets:Bank:Checking"
  depth: number; // 0 = root (Assets), 1 = first sub, …
  row?: AccountRowDTO; // present if this exact account is `open` (postable)
  rollupCents: number; // this account's own balance + all descendants
  children: TreeNode[];
}

/** Build a parent→child tree from flat account rows. */
function buildTree(rows: AccountRowDTO[]): TreeNode[] {
  const byFull = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  // Ensure a node exists for every path prefix (so parents without their own
  // `open` directive still appear as headers).
  function ensure(full: string): TreeNode {
    const existing = byFull.get(full);
    if (existing) return existing;
    const segs = full.split(":");
    const node: TreeNode = {
      segment: segs[segs.length - 1],
      full,
      depth: segs.length - 1,
      rollupCents: 0,
      children: [],
    };
    byFull.set(full, node);
    if (segs.length === 1) {
      roots.push(node);
    } else {
      const parent = ensure(segs.slice(0, -1).join(":"));
      parent.children.push(node);
    }
    return node;
  }
  for (const r of rows) {
    const node = ensure(r.account);
    node.row = r;
  }
  // Roll up balances (own + descendants).
  function rollup(node: TreeNode): number {
    let sum = node.row ? toCents(node.row.balance) : 0;
    for (const c of node.children) sum += rollup(c);
    node.rollupCents = sum;
    return sum;
  }
  for (const r of roots) rollup(r);
  // Stable order: roots in canonical accounting order, children alphabetical.
  roots.sort((a, b) => ROOTS.indexOf(a.segment) - ROOTS.indexOf(b.segment));
  function sortKids(node: TreeNode) {
    node.children.sort((a, b) => a.segment.localeCompare(b.segment));
    node.children.forEach(sortKids);
  }
  roots.forEach(sortKids);
  return roots;
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

  const tree = useMemo(() => buildTree(rows), [rows]);

  // Render a tree node and its descendants as indented table rows.
  function renderNode(node: TreeNode): React.ReactElement[] {
    const hasChildren = node.children.length > 0;
    const isPostable = !!node.row;
    // Parent rows (have children) show the rolled-up balance; leaf postable
    // accounts show their own balance.
    const shown = hasChildren ? node.rollupCents : node.row ? toCents(node.row.balance) : 0;
    const out: React.ReactElement[] = [
      <tr key={node.full} className={hasChildren ? "coa-parent" : "coa-leaf"}>
        <td>
          <span style={{ paddingLeft: node.depth * 22 }}>
            <span style={{ fontWeight: hasChildren ? 600 : 400 }}>{node.segment}</span>
            {hasChildren && isPostable ? (
              <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                (postable + {node.children.length} sub)
              </span>
            ) : hasChildren ? (
              <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                ({node.children.length} sub{node.children.length > 1 ? "-accounts" : "-account"})
              </span>
            ) : null}
          </span>
        </td>
        <td>{node.row ? <span className="pill">{node.row.type}</span> : null}</td>
        <td className="amount" style={{ fontWeight: hasChildren ? 600 : 400 }}>
          {money(centsToStr(shown))}
        </td>
        <td className="amount">
          {isPostable ? (
            <button
              onClick={() => remove(node.full)}
              disabled={pending || !node.row!.removable}
              title={node.row!.removable ? "Remove account" : "Has activity — cannot remove"}
            >
              Remove
            </button>
          ) : null}
        </td>
      </tr>,
    ];
    for (const c of node.children) out.push(...renderNode(c));
    return out;
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
        <p className="muted" style={{ marginTop: -4, marginBottom: 10 }}>
          Sub-accounts are indented under their parent. Parent rows show a
          rolled-up balance (the account plus all of its sub-accounts).
        </p>
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
              tree.flatMap((node) => renderNode(node))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
