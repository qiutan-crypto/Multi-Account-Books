"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  getAccountRows,
  addAccount,
  removeAccount,
  importAccounts,
  type AccountRowDTO,
} from "./actions";
import {
  getAuxData,
  saveCoaDescriptions,
  extractAccountsFromTransactions,
} from "./feed-actions";
import { normalizeAccountName, rootForType } from "@/lib/feed/normalize";

const ROOTS = ["Assets", "Liabilities", "Equity", "Income", "COGS", "Expenses"];

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
  onOpenAccount,
}: {
  entityId: string;
  onChange?: () => void;
  onOpenAccount?: (account: string) => void;
}) {
  const [rows, setRows] = useState<AccountRowDTO[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [root, setRoot] = useState("Expenses");
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  const [coaDesc, setCoaDesc] = useState<Record<string, string>>({});
  const coaFileRef = useRef<HTMLInputElement>(null);
  // COA-file import wizard
  const [coaStage, setCoaStage] = useState<{
    fileName: string;
    columns: string[];
    rows: Record<string, unknown>[];
    nameCol: string;
    typeCol: string;
    descCol: string;
  } | null>(null);

  function refresh() {
    startTransition(async () => {
      setRows(await getAccountRows(entityId));
      const aux = await getAuxData(entityId);
      setCoaDesc(aux.coaDesc || {});
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  // ---- COA file import (CSV/Excel with Account Name / Type / Description) ---
  async function onCoaFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setOkMsg(null);
    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
      const columns = (grid[0] || []).map((c) => String(c ?? "").trim()).filter(Boolean);
      const dataRows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[];
      if (!columns.length || !dataRows.length) {
        setError("The file appears to be empty.");
        return;
      }
      const guess = (hints: string[]) =>
        columns.find((c) => hints.includes(c.toLowerCase().replace(/[^a-z]/g, ""))) ||
        columns.find((c) => hints.some((h) => c.toLowerCase().replace(/[^a-z]/g, "").includes(h))) ||
        "";
      setCoaStage({
        fileName: file.name,
        columns,
        rows: dataRows,
        nameCol: guess(["accountname", "account", "name"]) || columns[0],
        typeCol: guess(["accounttype", "type"]),
        descCol: guess(["description", "desc", "memo"]),
      });
    } catch (err) {
      setError("Could not read the file: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      if (coaFileRef.current) coaFileRef.current.value = "";
    }
  }

  function confirmCoaImport() {
    if (!coaStage) return;
    if (!coaStage.nameCol) {
      setError("Pick the Account Name column.");
      return;
    }
    const names: string[] = [];
    const descs: Record<string, string> = {};
    for (const raw of coaStage.rows) {
      const label = String(raw[coaStage.nameCol] ?? "").trim();
      if (!label) continue;
      const typeLabel = coaStage.typeCol ? String(raw[coaStage.typeCol] ?? "").trim() : "";
      const account = normalizeAccountName(label, rootForType(typeLabel) || undefined);
      if (!account) continue;
      names.push(account);
      const d = coaStage.descCol ? String(raw[coaStage.descCol] ?? "").trim() : "";
      if (d) descs[account] = d;
    }
    if (!names.length) {
      setError("No usable accounts found in the file.");
      return;
    }
    setCoaStage(null);
    startTransition(async () => {
      const res = await importAccounts(entityId, names);
      if (!res.ok) {
        setError(res.error || "Could not import accounts.");
        return;
      }
      if (Object.keys(descs).length) await saveCoaDescriptions(entityId, descs);
      setOkMsg(
        `Imported ${res.added} account(s)` +
          (res.skipped ? `, ${res.skipped} already existed` : "") +
          (res.invalid?.length ? `, ${res.invalid.length} invalid` : "") +
          "."
      );
      refresh();
      onChange?.();
    });
  }

  function extractFromTransactions() {
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      const res = await extractAccountsFromTransactions(entityId);
      if (!res.ok) {
        setError(res.error || "Could not extract accounts.");
        return;
      }
      setOkMsg(
        res.added
          ? `Added ${res.added} account(s) found in transactions.`
          : "All accounts used by transactions are already in the chart."
      );
      refresh();
      onChange?.();
    });
  }

  async function exportCoaCsv() {
    const esc = (s: string) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
    const lines = ["Account Name,Account Type,Balance,Description"];
    for (const r of rows) {
      lines.push(
        [esc(r.account), esc(r.type), r.balance, esc(coaDesc[r.account] || "")].join(",")
      );
    }
    const a = document.createElement("a");
    a.href =
      "data:text/csv;charset=utf-8;base64," +
      btoa(unescape(encodeURIComponent(lines.join("\r\n"))));
    a.download = entityId + "-coa.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Map common singular/typo roots to the canonical Beancount root.
  const ROOT_ALIASES: Record<string, string> = {
    asset: "Assets",
    assets: "Assets",
    liability: "Liabilities",
    liabilities: "Liabilities",
    equity: "Equity",
    income: "Income",
    revenue: "Income",
    revenues: "Income",
    cogs: "COGS",
    expense: "Expenses",
    expenses: "Expenses",
  };

  // Beancount account segments must be single CamelCase tokens (no spaces or
  // punctuation). Turn a friendly label like "Chase Checking" into "ChaseChecking".
  function toSegment(raw: string): string {
    const words = raw.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  }

  function fullName(): string {
    const n = name.trim();
    if (!n) return "";
    // Split into segments; the user may or may not have typed a root prefix.
    const rawSegs = n.split(":").map((s) => s.trim()).filter(Boolean);
    if (rawSegs.length === 0) return "";

    // Detect a leading root (canonical, singular, or a known alias).
    const firstLower = rawSegs[0].toLowerCase();
    const hasRoot = firstLower in ROOT_ALIASES;
    const rootSeg = hasRoot ? ROOT_ALIASES[firstLower] : root;
    const bodySegs = (hasRoot ? rawSegs.slice(1) : rawSegs).map(toSegment).filter(Boolean);

    return [rootSeg, ...bodySegs].join(":");
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
        <td className="muted" style={{ fontSize: 12 }}>
          {node.row ? coaDesc[node.full] || "" : ""}
        </td>
        <td className="amount" style={{ fontWeight: hasChildren ? 600 : 400 }}>
          {isPostable && onOpenAccount ? (
            <button
              type="button"
              className="coa-amount"
              onClick={() => onOpenAccount(node.full)}
              title={"Open " + node.full + " in the Ledger (all dates)"}
            >
              {money(centsToStr(shown))}
            </button>
          ) : (
            money(centsToStr(shown))
          )}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Add account</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "inline-block" }}>
              <span className="pill" style={{ cursor: "pointer" }} title="Load a chart of accounts from a CSV/Excel file (Account Name, Type, Description)">
                Load COA…
              </span>
              <input
                ref={coaFileRef}
                type="file"
                accept=".csv,.xlsx,.xls,.txt"
                onChange={onCoaFile}
                style={{ display: "none" }}
              />
            </label>
            <button onClick={extractFromTransactions} disabled={pending} title="Add any account referenced by transactions but missing from the chart">
              Extract from transactions
            </button>
            <button onClick={exportCoaCsv} disabled={!rows.length}>
              Export COA CSV
            </button>
          </div>
        </div>
        {error ? <div className="notice">{error}</div> : null}
        {okMsg ? (
          <div className="notice" style={{ borderColor: "var(--accent)", background: "#e7f1ec", color: "#1c4d3e" }}>
            {okMsg}
          </div>
        ) : null}
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
              placeholder="Chase Checking  ·  Bank:Checking  ·  Assets:Bank:Checking"
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
            <br />
            <span style={{ fontSize: 11 }}>
              Spaces are removed and each word capitalized (Beancount account
              names can&apos;t contain spaces). Use <code>:</code> to nest
              sub-accounts, e.g. <code>Bank:Chase Checking</code> →{" "}
              <code>Assets:Bank:ChaseChecking</code>.
            </span>
          </p>
        ) : null}
      </div>

      <div className="panel span-12">
        <h2>Chart of accounts</h2>
        <p className="muted" style={{ marginTop: -4, marginBottom: 10 }}>
          Sub-accounts are indented under their parent. Parent rows show a
          rolled-up balance (the account plus all of its sub-accounts). Click any
          account balance to open that account in the Ledger (all dates).
        </p>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th>Description</th>
              <th className="amount">Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="muted" colSpan={5}>
                  No accounts yet
                </td>
              </tr>
            ) : (
              tree.flatMap((node) => renderNode(node))
            )}
          </tbody>
        </table>
      </div>

      {coaStage ? (
        <div className="modal-overlay" onClick={() => setCoaStage(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 style={{ marginTop: 0 }}>Load chart of accounts</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              {coaStage.fileName} · {coaStage.rows.length} row(s). Map the columns — friendly names
              like &quot;Advertising&quot; become <code>Expenses:Advertising</code> using the type
              column (or a smart guess).
            </p>
            <div className="modal-grid">
              <label>
                Account Name column *
                <select
                  value={coaStage.nameCol}
                  onChange={(e) => setCoaStage((s) => (s ? { ...s, nameCol: e.target.value } : s))}
                >
                  <option value="">(choose)</option>
                  {coaStage.columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Account Type column
                <select
                  value={coaStage.typeCol}
                  onChange={(e) => setCoaStage((s) => (s ? { ...s, typeCol: e.target.value } : s))}
                >
                  <option value="">(none)</option>
                  {coaStage.columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Description column
                <select
                  value={coaStage.descCol}
                  onChange={(e) => setCoaStage((s) => (s ? { ...s, descCol: e.target.value } : s))}
                >
                  <option value="">(none)</option>
                  {coaStage.columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button onClick={() => setCoaStage(null)}>Cancel</button>
              <button className="primary" onClick={confirmCoaImport} disabled={pending}>
                Import accounts
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
