"use client";

// Bank feed — multi-account edition.
//
// Load an Excel/CSV file containing transactions for ONE OR MANY bank
// accounts. A column-mapping step lets you pick which columns are Date,
// Description, Amount (or Debit/Credit), Account, Category, Payee and Ref —
// like QuickBooks Online's import. When an Account column is mapped, each
// distinct value is mapped to a ledger bank/credit-card account, so one file
// can feed every account at once. Pre-categorized files (a Category column)
// land ready to post; classification rules fill in the rest. Transfers
// between accounts are detected and the mirror side is skipped automatically.

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getAccounts } from "./actions";
import {
  commitBankFeedMulti,
  getAuxData,
  saveAccountMap,
  type MultiFeedRow,
} from "./feed-actions";
import { parseBankRows, toCents, fromCents } from "@/lib/beancount";
import {
  normalizeDateCell,
  parseAmountCell,
  normalizeAccountName,
  matchExistingAccount,
  toSegment,
} from "@/lib/feed/normalize";
import { applyRules, type Rule } from "@/lib/feed/rules";

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

function shortName(account: string): string {
  const segs = (account || "").split(":");
  return segs.length > 1 ? segs.slice(1).join(":") : account;
}

type Filter = "all" | "in" | "out";
type SortKey = "original" | "date" | "description" | "amount" | "account";

interface Split {
  key: number;
  category: string;
  amount: string;
}

interface Row {
  key: number;
  originalIndex: number;
  date: string;
  payee: string;
  description: string;
  ref: string;
  amountCents: number;
  sourceAccount: string;
  splits: Split[];
  selected: boolean;
  ruleApplied?: boolean;
  /** Set when this row looks like the mirror side of a transfer in this batch. */
  transferMirror?: boolean;
  /** Category came straight from the file's Category column. */
  fromFile?: boolean;
}

// ---- column mapping ---------------------------------------------------------

const MAP_FIELDS = [
  { key: "Date", required: true },
  { key: "Description", required: true },
  { key: "Amount", required: false },
  { key: "Debit", required: false },
  { key: "Credit", required: false },
  { key: "Account", required: false },
  { key: "Category", required: false },
  { key: "Payee", required: false },
  { key: "Ref", required: false },
] as const;
type MapField = (typeof MAP_FIELDS)[number]["key"];

const FIELD_HINTS: Record<MapField, string[]> = {
  Date: ["date", "transactiondate", "posteddate", "posted", "txndate", "cleareddate"],
  Description: ["description", "bankdescription", "memo", "narration", "details", "transaction"],
  Amount: ["amount", "amt"],
  Debit: ["debit", "withdrawal", "withdrawals", "moneyout", "paid out"],
  Credit: ["credit", "deposit", "deposits", "moneyin", "paid in"],
  Account: ["account", "accountname", "bankaccount", "acct", "source", "card"],
  Category: ["category", "schedule c category", "schedulec", "coa", "class", "account assigned"],
  Payee: ["payee", "vendor", "customer", "name", "merchant"],
  Ref: ["ref", "reference", "check", "checknumber", "check#", "docnum", "number"],
};

function normKey(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9#]+/g, "");
}

function guessColumn(columns: string[], field: MapField): string {
  const hints = FIELD_HINTS[field].map(normKey);
  for (const col of columns) if (hints.includes(normKey(col))) return col;
  for (const col of columns) {
    const cn = normKey(col);
    if (hints.some((h) => h && cn.includes(h))) return col;
  }
  return "";
}

interface SheetStage {
  sheetNames: string[];
  current: string;
  columns: string[];
  rows: Record<string, unknown>[];
  fileName: string;
  // Raw workbook kept so switching sheets re-reads columns.
  wb: unknown;
}

interface AccountMapStage {
  labels: string[];
  map: Record<string, string>; // label -> ledger account ("" = unmapped)
  newNames: Record<string, string>; // label -> proposed new account name
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
  const [rules, setRules] = useState<Rule[]>([]);
  const [savedAccountMap, setSavedAccountMap] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [defaultSource, setDefaultSource] = useState("");
  const [flip, setFlip] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [accountFilter, setAccountFilter] = useState("");
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

  // Import wizard state
  const [sheetStage, setSheetStage] = useState<SheetStage | null>(null);
  const [mapping, setMapping] = useState<Record<MapField, string>>({} as Record<MapField, string>);
  const [acctStage, setAcctStage] = useState<AccountMapStage | null>(null);
  // Rows parsed from the file, waiting for the account-mapping step.
  const pendingParsed = useRef<
    { date: string; payee: string; description: string; ref: string; amountCents: number; accountLabel: string; category: string }[]
  >([]);

  useEffect(() => {
    startTransition(async () => {
      const accs = await getAccounts(entityId);
      setAccounts(accs);
      setDefaultSource(accs.find((a) => a.startsWith("Assets")) || accs[0] || "");
      const aux = await getAuxData(entityId);
      setRules(aux.rules || []);
      setSavedAccountMap(aux.accountMap || {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const sourceAccounts = useMemo(
    () => accounts.filter((a) => root(a) === "Assets" || root(a) === "Liabilities"),
    [accounts]
  );
  const categoryAccounts = useMemo(() => {
    const set = new Set(accounts);
    set.add(UNCATEGORIZED);
    // Include any categories currently proposed by loaded rows (new accounts).
    for (const r of rows) for (const s of r.splits) if (s.category) set.add(s.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [accounts, rows]);

  const batchAccounts = useMemo(() => {
    const set = new Set(rows.map((r) => r.sourceAccount).filter(Boolean));
    return [...set].sort();
  }, [rows]);

  // ---- transfer mirror matching -------------------------------------------
  // A transfer appears in BOTH accounts' statements. When row X (account A,
  // categorized to account B) has a counterpart Y (account B, amount -X,
  // within 3 days), Y is the same transfer seen from the other side — posting
  // both would double it. Mark Y and leave it unselected.
  function matchTransfers(list: Row[]): Row[] {
    const out = list.map((r) => ({ ...r, transferMirror: false }));
    const used = new Set<number>();
    for (const x of out) {
      if (used.has(x.key) || x.transferMirror) continue;
      if (x.splits.length !== 1) continue;
      const cat = x.splits[0].category;
      const catRoot = root(cat);
      if (catRoot !== "Assets" && catRoot !== "Liabilities") continue;
      if (cat === x.sourceAccount) continue;
      // find mirror: source = cat, amount = -x.amount, close in time
      const mirror = out.find(
        (y) =>
          !used.has(y.key) &&
          y.key !== x.key &&
          !y.transferMirror &&
          y.sourceAccount === cat &&
          y.amountCents === -x.amountCents &&
          Math.abs(Date.parse(y.date) - Date.parse(x.date)) <= 3 * 86400000 &&
          (y.splits.length === 1) &&
          (y.splits[0].category === x.sourceAccount ||
            y.splits[0].category === UNCATEGORIZED ||
            !y.splits[0].category)
      );
      if (mirror) {
        used.add(x.key);
        used.add(mirror.key);
        mirror.transferMirror = true;
        mirror.selected = false;
        mirror.splits = [{ ...mirror.splits[0], category: x.sourceAccount }];
      }
    }
    return out;
  }

  // ---- load: paste path -----------------------------------------------------
  function loadPasted(text: string) {
    setError(null);
    setOkMsg(null);
    if (!defaultSource) {
      setError("Add a bank account to the chart of accounts first, or import a file with an Account column.");
      return;
    }
    const parsed = parseBankRows(text);
    if (!parsed.length) {
      setError("No transactions found. Expected columns: Date, Description, Amount, Ref (Payee optional).");
      return;
    }
    const s = flip ? -1 : 1;
    finishLoad(
      parsed.map((r) => ({
        date: r.date,
        payee: r.payee,
        description: r.description,
        ref: r.ref,
        amountCents: r.amountCents * s,
        accountLabel: "",
        category: "",
      })),
      { "": defaultSource }
    );
  }

  // ---- load: file path (xlsx / csv via SheetJS) ------------------------------
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setOkMsg(null);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { cellDates: true });
      const sheetNames = wb.SheetNames || [];
      if (!sheetNames.length) {
        setError("No sheets found in this file.");
        return;
      }
      const current = sheetNames[0];
      const { columns, rows: sheetRows } = readSheet(XLSX, wb, current);
      setSheetStage({ sheetNames, current, columns, rows: sheetRows, fileName: file.name, wb });
      setMapping(autoMap(columns));
    } catch (err) {
      setError("Could not read the file: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function readSheet(
    XLSX: typeof import("xlsx"),
    wb: import("xlsx").WorkBook,
    name: string
  ): { columns: string[]; rows: Record<string, unknown>[] } {
    const ws = wb.Sheets[name];
    if (!ws) return { columns: [], rows: [] };
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
    const headerRow = (grid[0] || []).map((c) => String(c ?? "").trim());
    const columns = headerRow.filter(Boolean);
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[];
    return { columns, rows };
  }

  function autoMap(columns: string[]): Record<MapField, string> {
    const m = {} as Record<MapField, string>;
    for (const f of MAP_FIELDS) m[f.key] = guessColumn(columns, f.key);
    // Don't guess Amount AND Debit/Credit at once — prefer Amount.
    if (m.Amount) {
      m.Debit = "";
      m.Credit = "";
    }
    return m;
  }

  async function switchSheet(name: string) {
    if (!sheetStage) return;
    const XLSX = await import("xlsx");
    const { columns, rows: sheetRows } = readSheet(XLSX, sheetStage.wb as import("xlsx").WorkBook, name);
    setSheetStage({ ...sheetStage, current: name, columns, rows: sheetRows });
    setMapping(autoMap(columns));
  }

  /** Confirm the column mapping: parse rows, then go to account mapping (or straight to the table). */
  function confirmMapping() {
    if (!sheetStage) return;
    const m = mapping;
    if (!m.Date || !m.Description) {
      setError("Map the Date and Description columns first.");
      return;
    }
    if (!m.Amount && !m.Debit && !m.Credit) {
      setError("Map an Amount column (or Debit/Credit columns).");
      return;
    }
    setError(null);

    const s = flip ? -1 : 1;
    const parsed: typeof pendingParsed.current = [];
    for (const raw of sheetStage.rows) {
      const date = normalizeDateCell(raw[m.Date]);
      if (!date) continue;
      let amountCents = 0;
      if (m.Amount) {
        amountCents = parseAmountCell(raw[m.Amount]);
      }
      if (!amountCents && (m.Debit || m.Credit)) {
        const debit = m.Debit ? Math.abs(parseAmountCell(raw[m.Debit])) : 0;
        const credit = m.Credit ? Math.abs(parseAmountCell(raw[m.Credit])) : 0;
        amountCents = credit - debit;
      }
      if (!amountCents) continue;
      parsed.push({
        date,
        payee: m.Payee ? String(raw[m.Payee] ?? "").trim() : "",
        description: String(raw[m.Description] ?? "").trim(),
        ref: m.Ref ? String(raw[m.Ref] ?? "").trim() : "",
        amountCents: amountCents * s,
        accountLabel: m.Account ? String(raw[m.Account] ?? "").trim() : "",
        category: m.Category ? String(raw[m.Category] ?? "").trim() : "",
      });
    }
    if (!parsed.length) {
      setError("No usable rows found — check the column mapping.");
      return;
    }
    pendingParsed.current = parsed;
    setSheetStage(null);

    if (m.Account) {
      // Distinct statement account labels -> mapping step.
      const labels = [...new Set(parsed.map((p) => p.accountLabel).filter(Boolean))].sort();
      if (labels.length) {
        const map: Record<string, string> = {};
        const newNames: Record<string, string> = {};
        for (const label of labels) {
          const remembered = savedAccountMap[label];
          const matched = remembered && accounts.includes(remembered)
            ? remembered
            : matchExistingAccount(label, sourceAccounts);
          map[label] = matched || "";
          newNames[label] = "Assets:Bank:" + (toSegment(label) || "Imported");
        }
        setAcctStage({ labels, map, newNames });
        return;
      }
    }
    finishLoad(parsed, { "": defaultSource });
  }

  /** Confirm the account mapping and build the review table. */
  function confirmAccountMap() {
    if (!acctStage) return;
    const resolved: Record<string, string> = {};
    for (const label of acctStage.labels) {
      const target = acctStage.map[label] || acctStage.newNames[label];
      if (!target || (root(target) !== "Assets" && root(target) !== "Liabilities")) {
        setError('Account "' + label + '" needs a ledger account (Assets or Liabilities).');
        return;
      }
      resolved[label] = target;
    }
    setError(null);
    setAcctStage(null);
    // Remember the mapping for next time.
    void saveAccountMap(entityId, resolved);
    setSavedAccountMap((prev) => ({ ...prev, ...resolved }));
    finishLoad(pendingParsed.current, resolved);
  }

  /** Build table rows: resolve categories, apply rules, match transfers. */
  function finishLoad(
    parsed: {
      date: string; payee: string; description: string; ref: string;
      amountCents: number; accountLabel: string; category: string;
    }[],
    accountResolve: Record<string, string>
  ) {
    const knownAccounts = [...accounts];
    const built: Row[] = parsed.map((p, i) => {
      const source = accountResolve[p.accountLabel] ?? accountResolve[""] ?? defaultSource;
      let category = "";
      let fromFile = false;
      if (p.category) {
        const matched = matchExistingAccount(p.category, knownAccounts);
        category = matched || normalizeAccountName(p.category, undefined, p.amountCents);
        fromFile = !!category;
      }
      let ruleApplied = false;
      if (!category && rules.length) {
        const hit = applyRules(rules, {
          description: p.description,
          payee: p.payee,
          amountCents: p.amountCents,
          sourceAccount: source,
        });
        if (hit) {
          category = hit.category;
          ruleApplied = true;
        }
      }
      return {
        key: SEQ++,
        originalIndex: i,
        date: p.date,
        payee: p.payee,
        description: p.description,
        ref: p.ref,
        amountCents: p.amountCents,
        sourceAccount: source,
        splits: [{ key: SEQ++, category: category || UNCATEGORIZED, amount: "" }],
        selected: false,
        ruleApplied,
        fromFile,
      };
    });
    setRows(matchTransfers(built));
    setLastKey(null);
    setAccountFilter("");
    setOkMsg(null);
  }

  function applyRulesNow(overwrite: boolean) {
    if (!rules.length) {
      setError("No rules defined yet — add some in the Rules tab.");
      return;
    }
    setError(null);
    let applied = 0;
    setRows((prev) =>
      matchTransfers(
        prev.map((r) => {
          if (r.splits.length !== 1) return r;
          const cur = r.splits[0].category;
          if (!overwrite && cur && cur !== UNCATEGORIZED) return r;
          const hit = applyRules(rules, {
            description: r.description,
            payee: r.payee,
            amountCents: r.amountCents,
            sourceAccount: r.sourceAccount,
          });
          if (!hit) return r;
          applied++;
          return {
            ...r,
            payee: hit.payee || r.payee,
            ruleApplied: true,
            splits: [{ ...r.splits[0], category: hit.category }],
          };
        })
      )
    );
    setOkMsg(applied ? `Rules matched ${applied} row(s).` : "No rules matched.");
  }

  function toggleFlip(v: boolean) {
    setFlip(v);
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

  // ---- per-row editing (same as before, plus account) ------------------------
  function patchRow(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setOkMsg(null);
  }
  function setSplit(rowKey: number, splitKey: number, patch: Partial<Split>) {
    setRows((prev) =>
      prev.map((r) =>
        r.key === rowKey
          ? { ...r, splits: r.splits.map((s) => (s.key === splitKey ? { ...s, ...patch } : s)), ruleApplied: false, fromFile: false }
          : r
      )
    );
    setOkMsg(null);
  }
  function addSplit(rowKey: number) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== rowKey) return r;
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
        if (splits.length <= 1) splits = [{ ...splits[0], amount: "" }];
        return { ...r, splits };
      })
    );
    setOkMsg(null);
  }

  // ---- filter + sort ----------------------------------------------------------
  const visibleRows = useMemo(() => {
    const match = (r: Row) => {
      if (accountFilter && r.sourceAccount !== accountFilter) return false;
      return filter === "all" ? true : filter === "in" ? r.amountCents > 0 : r.amountCents < 0;
    };
    const out = rows.filter(match);
    const byIndex = (a: Row, b: Row) => a.originalIndex - b.originalIndex;
    if (sortKey === "date") out.sort((a, b) => a.date.localeCompare(b.date) || byIndex(a, b));
    else if (sortKey === "description")
      out.sort((a, b) => a.description.localeCompare(b.description) || byIndex(a, b));
    else if (sortKey === "amount") out.sort((a, b) => a.amountCents - b.amountCents || byIndex(a, b));
    else if (sortKey === "account")
      out.sort((a, b) => a.sourceAccount.localeCompare(b.sourceAccount) || byIndex(a, b));
    else out.sort(byIndex);
    return out;
  }, [rows, filter, accountFilter, sortKey]);

  function splitSum(r: Row): number {
    return r.splits.reduce((s, sp) => s + toCents(sp.amount), 0);
  }
  function remaining(r: Row): number {
    return r.amountCents - splitSum(r);
  }
  function rowValid(r: Row): boolean {
    if (!r.sourceAccount) return false;
    if (r.splits.length === 1) return !!r.splits[0].category && r.amountCents !== 0;
    return (
      r.splits.every((s) => s.category && toCents(s.amount) !== 0) && splitSum(r) === r.amountCents
    );
  }

  // ---- selection ---------------------------------------------------------------
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
    const keys = new Set(visibleRows.filter((r) => !r.transferMirror || !state).map((r) => r.key));
    // Selecting all skips transfer mirrors; deselecting clears everything shown.
    setRows((prev) =>
      prev.map((r) => {
        if (!keys.has(r.key)) {
          // when selecting, leave mirrors untouched; when clearing, clear shown mirrors too
          if (!state && visibleRows.some((v) => v.key === r.key)) return { ...r, selected: false };
          return r;
        }
        return { ...r, selected: state };
      })
    );
  }

  const selectedRows = rows.filter((r) => r.selected);
  const selectedInvalid = selectedRows.filter((r) => !rowValid(r)).length;
  const moneyIn = visibleRows.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0);
  const moneyOut = visibleRows.filter((r) => r.amountCents < 0).reduce((s, r) => s + r.amountCents, 0);
  const mirrorCount = rows.filter((r) => r.transferMirror).length;

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
        r.selected && r.splits.length === 1 ? { ...r, splits: [{ ...r.splits[0], category: bulk }] } : r
      )
    );
    setOkMsg(null);
  }

  function commit() {
    setError(null);
    setOkMsg(null);
    if (!selectedRows.length) {
      setError("Select at least one transaction to post.");
      return;
    }
    if (selectedInvalid) {
      setError("Some selected rows aren't fully categorized or their splits don't add up. Fix them or deselect.");
      return;
    }
    const payload: MultiFeedRow[] = selectedRows.map((r) => ({
      date: r.date,
      payee: r.payee,
      description: r.description,
      ref: r.ref,
      sourceAccount: r.sourceAccount,
      amountCents: r.amountCents,
      splits:
        r.splits.length === 1
          ? [{ category: r.splits[0].category, amountCents: r.amountCents }]
          : r.splits.map((s) => ({ category: s.category, amountCents: toCents(s.amount) })),
    }));
    const postedKeys = new Set(selectedRows.map((r) => r.key));
    startTransition(async () => {
      const res = await commitBankFeedMulti(entityId, payload);
      if (!res.ok) {
        setError(res.error || "Could not add transactions.");
        return;
      }
      setAccounts(await getAccounts(entityId));
      const left = rows.filter((r) => !postedKeys.has(r.key));
      setRows(left);
      setLastKey(null);
      const parts = [`Added ${res.added} transaction(s).`];
      if (res.duplicates) parts.push(`${res.duplicates} duplicate(s) skipped.`);
      if (res.transferMatches) parts.push(`${res.transferMatches} transfer mirror(s) skipped.`);
      parts.push(`${left.length} left in the feed.`);
      setOkMsg(parts.join(" "));
      onChange?.();
    });
  }

  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.filter((r) => !r.transferMirror).every((r) => r.selected);

  return (
    <div className="grid">
      <div className="panel span-12">
        <h2 style={{ marginTop: 0 }}>Bank feed</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Load an Excel or CSV file of bank / credit-card transactions — from one account or many.
          You&apos;ll pick which columns are Date, Description, Amount, Account and Category. Files
          with an Account column feed several bank accounts at once; a Category column posts
          pre-categorized rows as-is. Transfers between your accounts are detected so they are
          never double-posted. Negative amounts are money leaving the account.
        </p>

        {error ? <div className="notice">{error}</div> : null}
        {okMsg ? (
          <div className="notice" style={{ borderColor: "var(--accent)", background: "#e7f1ec", color: "#1c4d3e" }}>
            {okMsg}
          </div>
        ) : null}

        <div className="form-grid" style={{ alignItems: "end" }}>
          <label className="wide">
            Transactions file (.xlsx, .xls, .csv)
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              onChange={onFile}
              className="file-input"
            />
            {fileName ? (
              <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>Loaded {fileName}</span>
            ) : null}
          </label>
          <label className="wide">
            Default source account (used when the file has no Account column)
            <select value={defaultSource} onChange={(e) => setDefaultSource(e.target.value)}>
              {sourceAccounts.length === 0 ? <option value="">No bank accounts yet</option> : null}
              {sourceAccounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
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
          <button style={{ marginTop: 8 }} onClick={() => loadPasted(paste)} disabled={!paste.trim()}>
            Load pasted rows
          </button>
        </details>
      </div>

      <div className="panel span-12">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Review &amp; categorize</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {mirrorCount ? (
              <span className="pill" title="Mirror sides of transfers between your accounts — skipped so transfers aren't posted twice.">
                {mirrorCount} transfer mirror(s)
              </span>
            ) : null}
            {rows.length ? (
              <span className="pill">
                {selectedRows.length} of {rows.length} selected
              </span>
            ) : null}
          </div>
        </div>

        {rows.length ? (
          <div className="bf-controls">
            {batchAccounts.length > 1 ? (
              <div className="bf-control">
                <span className="bf-lbl">Account</span>
                <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
                  <option value="">All accounts ({batchAccounts.length})</option>
                  {batchAccounts.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
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
                <option value="account">Account</option>
                <option value="description">Description</option>
                <option value="amount">Amount</option>
              </select>
            </div>
            <div className="bf-control">
              <button onClick={() => selectVisible(true)}>Select all</button>
              <button onClick={() => selectVisible(false)}>Select none</button>
            </div>
            <div className="bf-control">
              <button onClick={() => applyRulesNow(false)} title="Categorize uncategorized rows using your saved rules">
                Apply rules
              </button>
              <button onClick={() => applyRulesNow(true)} title="Re-run rules over every row, overwriting current categories">
                Apply to all
              </button>
            </div>
            <div className="bf-control">
              <span className="bf-lbl">Set selected to</span>
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

        <div style={{ overflowX: "auto" }}>
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
                {batchAccounts.length > 1 || accountFilter ? <th style={{ width: 140 }}>Account</th> : null}
                <th>Payee</th>
                <th>Description</th>
                <th style={{ width: 70 }}>Ref</th>
                <th className="amount" style={{ width: 104 }}>Amount</th>
                <th style={{ width: 300 }}>Category</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={8}>
                    {rows.length ? "No rows match this filter." : "Load a file or paste rows to see transactions here."}
                  </td>
                </tr>
              ) : (
                visibleRows.map((r) => {
                  const rem = remaining(r);
                  const invalid = r.selected && !rowValid(r);
                  const showAcct = batchAccounts.length > 1 || accountFilter;
                  return (
                    <tr
                      key={r.key}
                      className={r.selected ? "bf-selected" : undefined}
                      style={r.transferMirror ? { opacity: 0.55 } : undefined}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={r.selected}
                          onClick={(e) => (shiftRef.current = (e as React.MouseEvent).shiftKey)}
                          onChange={() => handleCheck(r)}
                        />
                      </td>
                      <td>{r.date}</td>
                      {showAcct ? (
                        <td title={r.sourceAccount}>
                          <span className="pill" style={{ fontSize: 11 }}>{shortName(r.sourceAccount)}</span>
                        </td>
                      ) : null}
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
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                          <button onClick={() => addSplit(r.key)} style={{ padding: "2px 8px", minHeight: 0, fontSize: 12 }}>
                            + Split
                          </button>
                          {r.transferMirror ? (
                            <span className="muted" style={{ fontSize: 11, color: "#8a6d1a" }}>
                              transfer mirror — skipped (select to post anyway)
                            </span>
                          ) : null}
                          {r.ruleApplied ? (
                            <span className="muted" style={{ fontSize: 11, color: "var(--accent)" }}>rule ✓</span>
                          ) : r.fromFile ? (
                            <span className="muted" style={{ fontSize: 11 }}>from file</span>
                          ) : null}
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
                  <td colSpan={batchAccounts.length > 1 || accountFilter ? 6 : 5} style={{ textAlign: "right" }}>
                    Shown: {visibleRows.length} · Money in {money(moneyIn)} · Money out {money(moneyOut)}
                  </td>
                  <td className="amount">{money(moneyIn + moneyOut)}</td>
                  <td></td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

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

      {/* ---- Import wizard: sheet + column mapping ---- */}
      {sheetStage ? (
        <div className="modal-overlay" onClick={() => setSheetStage(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h2 style={{ marginTop: 0 }}>Import {sheetStage.fileName}</h2>
            {sheetStage.sheetNames.length > 1 ? (
              <label style={{ display: "block", marginBottom: 12 }}>
                Sheet
                <select value={sheetStage.current} onChange={(e) => switchSheet(e.target.value)}>
                  {sheetStage.sheetNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Map your file&apos;s columns to the standard fields. Date and Description are required,
              plus Amount (or Debit/Credit). Map <strong>Account</strong> when the file holds several
              bank accounts, and <strong>Category</strong> when rows are already classified.
            </p>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", width: "40%" }}>Field</th>
                  <th style={{ textAlign: "left" }}>Your column</th>
                </tr>
              </thead>
              <tbody>
                {MAP_FIELDS.map((f) => (
                  <tr key={f.key}>
                    <td style={{ padding: "4px 8px 4px 0" }}>
                      {f.key}
                      {f.required ? <span style={{ color: "#b3261e" }}> *</span> : null}
                      {f.key === "Amount" ? (
                        <span className="muted" style={{ fontSize: 11 }}> (or Debit/Credit)</span>
                      ) : null}
                    </td>
                    <td style={{ padding: "4px 0" }}>
                      <select
                        value={mapping[f.key] || ""}
                        onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                        style={{ width: "100%" }}
                      >
                        <option value="">(none)</option>
                        {sheetStage.columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12 }}>
              {sheetStage.rows.length.toLocaleString()} data row(s) in this sheet.
            </p>
            <div className="modal-actions">
              <button onClick={() => setSheetStage(null)}>Cancel</button>
              <button className="primary" onClick={confirmMapping}>
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- Import wizard: bank-account mapping ---- */}
      {acctStage ? (
        <div className="modal-overlay" onClick={() => setAcctStage(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2 style={{ marginTop: 0 }}>Map bank accounts</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              The file contains {acctStage.labels.length} account(s). Match each one to a ledger
              account, or create a new one. Mappings are remembered for next time.
            </p>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>In your file</th>
                  <th style={{ textAlign: "left" }}>Ledger account</th>
                </tr>
              </thead>
              <tbody>
                {acctStage.labels.map((label) => {
                  const chosen = acctStage.map[label];
                  return (
                    <tr key={label}>
                      <td style={{ padding: "4px 8px 4px 0", fontWeight: 600 }}>{label}</td>
                      <td style={{ padding: "4px 0" }}>
                        <select
                          value={chosen || "__new__"}
                          onChange={(e) =>
                            setAcctStage((st) =>
                              st
                                ? { ...st, map: { ...st.map, [label]: e.target.value === "__new__" ? "" : e.target.value } }
                                : st
                            )
                          }
                          style={{ width: "100%" }}
                        >
                          <option value="__new__">＋ Create new account…</option>
                          {sourceAccounts.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                        {!chosen ? (
                          <input
                            style={{ width: "100%", marginTop: 4 }}
                            value={acctStage.newNames[label]}
                            onChange={(e) =>
                              setAcctStage((st) =>
                                st ? { ...st, newNames: { ...st.newNames, [label]: e.target.value } } : st
                              )
                            }
                            placeholder="Assets:Bank:Checking"
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="modal-actions">
              <button onClick={() => setAcctStage(null)}>Cancel</button>
              <button className="primary" onClick={confirmAccountMap}>
                Load transactions
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
