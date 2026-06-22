// Hierarchical financial statements: Profit & Loss and Balance Sheet,
// rendered as a flat list of display rows with indentation derived from the
// account colon-hierarchy and "Total for <group>" subtotals.
//
// Sections are inferred from account-name conventions:
//   Expenses:COGS:*  (or :CostOfGoodsSold:)  -> Cost of Goods Sold
//   Income:Other:*                            -> Other Income
//   Expenses:Other:*                          -> Other Expense / Other Expenses
// Everything else falls under ordinary Income / Expenses.

import { Ledger, Transaction, accountType } from "./types";
import { balances, DateRange } from "./report";

export type RowKind =
  | "section" // shaded band header (Income, Expenses, …)
  | "account" // a leaf or parent account line
  | "groupHeader" // a parent account that has children (its own label row)
  | "accountHeader" // a leaf account label, before its detail transactions
  | "txn" // a single transaction line (detail report)
  | "subtotal" // "Total for <group>"
  | "total" // section total (Total for Income, Total Expenses)
  | "grandtotal" // Gross Profit, Net Operating Income, Net Income, Total Assets …
  | "spacer";

export interface DetailTxn {
  date: string;
  num: string; // tx id / document number
  name: string; // payee / customer / vendor
  description: string; // narration
  split: string; // counter account, or "— Split —"
  balance: number; // running balance for this account (display sign)
}

export interface StatementRow {
  kind: RowKind;
  label: string;
  depth: number; // indentation level (0-based)
  cents?: number; // omitted for pure header/spacer rows
  bold?: boolean;
  compareCents?: number; // comparison-period amount (when comparing)
  txn?: DetailTxn; // present only on "txn" rows
  account?: string; // full account path (for drill-down), on account/group/subtotal rows
}

// ---- account tree ---------------------------------------------------------

interface Entry {
  account: string;
  cents: number;
  compare?: number;
}

interface Node {
  name: string; // segment label
  full: string; // full account path
  own: number; // own posting amount (display sign)
  ownCompare: number; // comparison-period own amount
  children: Map<string, Node>;
}

function newNode(name: string, full: string): Node {
  return { name, full, own: 0, ownCompare: 0, children: new Map() };
}

/** Build a tree from accounts under a given set of roots, after a prefix. */
function buildTree(entries: Entry[], stripSegments: number): Node {
  const root = newNode("", "");
  for (const { account, cents, compare } of entries) {
    const segs = account.split(":").slice(stripSegments);
    if (segs.length === 0) continue;
    let node = root;
    let path = account
      .split(":")
      .slice(0, stripSegments)
      .join(":");
    for (const seg of segs) {
      path = path ? path + ":" + seg : seg;
      let child = node.children.get(seg);
      if (!child) {
        child = newNode(seg, path);
        node.children.set(seg, child);
      }
      node = child;
    }
    node.own += cents;
    node.ownCompare += compare || 0;
  }
  return root;
}

/** Total of a node = own + sum of descendants. */
function nodeTotal(node: Node): number {
  let sum = node.own;
  for (const c of node.children.values()) sum += nodeTotal(c);
  return sum;
}

/** Comparison total of a node. */
function nodeCompare(node: Node): number {
  let sum = node.ownCompare;
  for (const c of node.children.values()) sum += nodeCompare(c);
  return sum;
}

/** Humanize a segment: "Revenue-Product" -> "Revenue - Product", camelCase -> spaced. */
function humanize(seg: string): string {
  return seg
    .replace(/-/g, " - ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Emit display rows for a node's children (grouped layout):
 *  - leaf:            account line (its total)
 *  - parent w/ kids:  group header, [own amount as a child if non-zero],
 *                     children…, then "Total for <group>"
 */
function emitChildren(node: Node, depth: number, out: StatementRow[]): void {
  const kids = [...node.children.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const child of kids) {
    const total = nodeTotal(child);
    const totalC = nodeCompare(child);
    // skip leaves that are zero in BOTH periods
    if (Math.abs(total) < 0.5 && Math.abs(totalC) < 0.5 && child.children.size === 0) continue;
    if (child.children.size === 0) {
      out.push({ kind: "account", label: humanize(child.name), depth, cents: total, compareCents: totalC, account: child.full });
    } else {
      out.push({ kind: "groupHeader", label: humanize(child.name), depth, account: child.full });
      if (Math.abs(child.own) >= 0.5 || Math.abs(child.ownCompare) >= 0.5) {
        out.push({ kind: "account", label: humanize(child.name), depth: depth + 1, cents: child.own, compareCents: child.ownCompare, account: child.full });
      }
      emitChildren(child, depth + 1, out);
      out.push({
        kind: "subtotal",
        label: "Total for " + humanize(child.name),
        depth,
        cents: total,
        compareCents: totalC,
        bold: true,
        account: child.full,
      });
    }
  }
}

// ---- section selection ----------------------------------------------------

function isCOGS(account: string): boolean {
  return /:(COGS|CostOfGoodsSold|CostOfSales)(:|$)/i.test(account);
}
function isOther(account: string): boolean {
  return /:Other(:|$)/i.test(account);
}

interface Sectioned {
  cents: number;
  compare: number;
  rows: StatementRow[];
}

/** Build one section's rows + totals from a filtered set of accounts. */
function section(entries: Entry[], stripSegments: number): Sectioned {
  if (entries.length === 0) return { cents: 0, compare: 0, rows: [] };
  const tree = buildTree(entries, stripSegments);
  const rows: StatementRow[] = [];
  emitChildren(tree, 1, rows);
  const cents = entries.reduce((s, e) => s + e.cents, 0);
  const compare = entries.reduce((s, e) => s + (e.compare || 0), 0);
  return { cents, compare, rows };
}

// ---- Profit & Loss --------------------------------------------------------

export interface ProfitLoss {
  rows: StatementRow[];
  netIncome: number;
  netIncomeCompare: number;
}

export function profitAndLoss(
  ledger: Ledger,
  range: DateRange = {},
  compareRange?: DateRange
): ProfitLoss {
  const b = balances(ledger, range);
  const c = compareRange ? balances(ledger, compareRange) : undefined;
  const comp = (account: string) => (c ? c.get(account) || 0 : 0);

  const income: Entry[] = [];
  const cogs: Entry[] = [];
  const expenses: Entry[] = [];
  const otherIncome: Entry[] = [];
  const otherExpense: Entry[] = [];

  // union of accounts present in either period
  const accounts = new Set<string>([...b.keys(), ...(c ? c.keys() : [])]);
  for (const account of accounts) {
    const t = accountType(account);
    const raw = b.get(account) || 0;
    if (t === "Income") {
      const e: Entry = { account, cents: -raw, compare: -comp(account) };
      (isOther(account) ? otherIncome : income).push(e);
    } else if (t === "Expenses") {
      const e: Entry = { account, cents: raw, compare: comp(account) };
      if (isCOGS(account)) cogs.push(e);
      else if (isOther(account)) otherExpense.push(e);
      else expenses.push(e);
    }
  }

  const rows: StatementRow[] = [];
  const inc = section(income, 1);
  const cog = section(cogs, 1);
  const exp = section(expenses, 1);
  const oInc = section(otherIncome, 1);
  const oExp = section(otherExpense, 1);

  rows.push({ kind: "section", label: "Income", depth: 0 });
  rows.push(...inc.rows);
  rows.push({ kind: "total", label: "Total for Income", depth: 0, cents: inc.cents, compareCents: inc.compare, bold: true });

  if (cog.rows.length) {
    rows.push({ kind: "section", label: "Cost of Goods Sold", depth: 0 });
    rows.push(...cog.rows);
    rows.push({ kind: "total", label: "Total for Cost of Goods Sold", depth: 0, cents: cog.cents, compareCents: cog.compare, bold: true });
  }
  const grossProfit = inc.cents - cog.cents;
  const grossProfitC = inc.compare - cog.compare;
  rows.push({ kind: "grandtotal", label: "Gross Profit", depth: 0, cents: grossProfit, compareCents: grossProfitC, bold: true });

  rows.push({ kind: "section", label: "Expenses", depth: 0 });
  rows.push(...exp.rows);
  rows.push({ kind: "total", label: "Total for Expenses", depth: 0, cents: exp.cents, compareCents: exp.compare, bold: true });

  const netOperating = grossProfit - exp.cents;
  const netOperatingC = grossProfitC - exp.compare;
  rows.push({ kind: "grandtotal", label: "Net Operating Income", depth: 0, cents: netOperating, compareCents: netOperatingC, bold: true });

  const hasOther = oInc.rows.length || oExp.rows.length;
  if (oInc.rows.length) {
    rows.push({ kind: "section", label: "Other Income", depth: 0 });
    rows.push(...oInc.rows);
    rows.push({ kind: "total", label: "Total for Other Income", depth: 0, cents: oInc.cents, compareCents: oInc.compare, bold: true });
  }
  if (oExp.rows.length) {
    rows.push({ kind: "section", label: "Other Expenses", depth: 0 });
    rows.push(...oExp.rows);
    rows.push({ kind: "total", label: "Total for Other Expenses", depth: 0, cents: oExp.cents, compareCents: oExp.compare, bold: true });
  }
  const netOther = oInc.cents - oExp.cents;
  const netOtherC = oInc.compare - oExp.compare;
  if (hasOther) {
    rows.push({ kind: "grandtotal", label: "Net Other Income", depth: 0, cents: netOther, compareCents: netOtherC, bold: true });
  }

  const netIncome = netOperating + netOther;
  const netIncomeCompare = netOperatingC + netOtherC;
  rows.push({ kind: "grandtotal", label: "Net Income", depth: 0, cents: netIncome, compareCents: netIncomeCompare, bold: true });

  return { rows, netIncome, netIncomeCompare };
}

// ---- Balance Sheet --------------------------------------------------------

export interface BalanceSheetStmt {
  rows: StatementRow[];
  totalAssets: number;
  totalLiabEquity: number;
  balances: boolean;
}

export function balanceSheetStatement(
  ledger: Ledger,
  asOf?: string,
  compareAsOf?: string
): BalanceSheetStmt {
  const b = balances(ledger, { to: asOf });
  const c = compareAsOf ? balances(ledger, { to: compareAsOf }) : undefined;
  const comp = (account: string) => (c ? c.get(account) || 0 : 0);

  const assets: Entry[] = [];
  const liabilities: Entry[] = [];
  const equity: Entry[] = [];
  let income = 0;
  let incomeC = 0;

  const accounts = new Set<string>([...b.keys(), ...(c ? c.keys() : [])]);
  for (const account of accounts) {
    const t = accountType(account);
    const raw = b.get(account) || 0;
    const rawC = comp(account);
    if (t === "Assets") assets.push({ account, cents: raw, compare: rawC });
    else if (t === "Liabilities") liabilities.push({ account, cents: -raw, compare: -rawC });
    else if (t === "Equity") equity.push({ account, cents: -raw, compare: -rawC });
    else if (t === "Income") { income += -raw; incomeC += -rawC; }
    else if (t === "Expenses") { income -= raw; incomeC -= rawC; }
  }
  const currentEarnings = income;
  const currentEarningsC = incomeC;

  const a = section(assets, 1);
  const l = section(liabilities, 1);
  const e = section(equity, 1);

  const rows: StatementRow[] = [];
  rows.push({ kind: "section", label: "ASSETS", depth: 0 });
  rows.push(...a.rows);
  const totalAssets = a.cents;
  rows.push({ kind: "grandtotal", label: "Total Assets", depth: 0, cents: totalAssets, compareCents: a.compare, bold: true });

  rows.push({ kind: "spacer", label: "", depth: 0 });
  rows.push({ kind: "section", label: "LIABILITIES AND EQUITY", depth: 0 });

  rows.push({ kind: "section", label: "Liabilities", depth: 0 });
  rows.push(...l.rows);
  rows.push({ kind: "total", label: "Total Liabilities", depth: 0, cents: l.cents, compareCents: l.compare, bold: true });

  rows.push({ kind: "section", label: "Equity", depth: 0 });
  rows.push(...e.rows);
  rows.push({ kind: "account", label: "Net Income", depth: 1, cents: currentEarnings, compareCents: currentEarningsC });
  const totalEquity = e.cents + currentEarnings;
  const totalEquityC = e.compare + currentEarningsC;
  rows.push({ kind: "total", label: "Total Equity", depth: 0, cents: totalEquity, compareCents: totalEquityC, bold: true });

  const totalLiabEquity = l.cents + totalEquity;
  const totalLiabEquityC = l.compare + totalEquityC;
  rows.push({
    kind: "grandtotal",
    label: "Total Liabilities and Equity",
    depth: 0,
    cents: totalLiabEquity,
    compareCents: totalLiabEquityC,
    bold: true,
  });

  return {
    rows,
    totalAssets,
    totalLiabEquity,
    balances: Math.round(totalAssets) === Math.round(totalLiabEquity),
  };
}

// ---- Profit & Loss DETAIL -------------------------------------------------
// Same hierarchy as the summary, but each leaf account expands into the
// individual transactions that compose it, with a running balance, then a
// "Total for <account>" subtotal. Account subtotals tie exactly to the
// summary P&L by construction.

function txnsForAccount(
  ledger: Ledger,
  account: string,
  range: DateRange,
  sign: number
): { rows: StatementRow[]; total: number } {
  const txns = ledger.directives
    .filter((d): d is Transaction => d.kind === "transaction")
    .filter(
      (t) =>
        (!range.from || t.date >= range.from) &&
        (!range.to || t.date <= range.to) &&
        t.postings.some((p) => p.account === account)
    )
    .sort((a, b) => a.date.localeCompare(b.date) || (a.meta.id || "").localeCompare(b.meta.id || ""));

  const rows: StatementRow[] = [];
  let running = 0;
  for (const t of txns) {
    const legs = t.postings.filter((p) => p.account === account);
    const amount = legs.reduce((s, p) => s + p.amount, 0) * sign;
    if (amount === 0) continue;
    running += amount;
    const others = t.postings.filter((p) => p.account !== account);
    const split =
      others.length === 0 ? "—" : others.length === 1 ? others[0].account : "— Split —";
    rows.push({
      kind: "txn",
      label: "",
      depth: 0,
      cents: amount,
      account,
      txn: {
        date: t.date,
        num: t.meta.id || "",
        name: t.meta.customer || t.meta.vendor || t.payee || "",
        description: t.narration || "",
        split,
        balance: running,
      },
    });
  }
  return { rows, total: running };
}

/** Walk a node tree; for each LEAF account, emit its detail transactions. */
function emitDetailChildren(
  ledger: Ledger,
  node: Node,
  depth: number,
  range: DateRange,
  sign: number,
  out: StatementRow[]
): void {
  const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const child of kids) {
    const total = nodeTotal(child);
    if (child.children.size === 0) {
      if (Math.abs(total) < 0.5) continue;
      out.push({ kind: "accountHeader", label: humanize(child.name), depth, account: child.full });
      const det = txnsForAccount(ledger, child.full, range, sign);
      out.push(...det.rows);
      out.push({
        kind: "subtotal",
        label: "Total for " + humanize(child.name),
        depth,
        cents: total,
        bold: true,
        account: child.full,
      });
    } else {
      out.push({ kind: "groupHeader", label: humanize(child.name), depth });
      // a parent with its own postings: emit them as a pseudo-leaf first
      if (Math.abs(child.own) >= 0.5) {
        out.push({ kind: "accountHeader", label: humanize(child.name), depth: depth + 1 });
        const det = txnsForAccount(ledger, child.full, range, sign);
        out.push(...det.rows);
        out.push({ kind: "subtotal", label: "Total for " + humanize(child.name), depth: depth + 1, cents: child.own, bold: true });
      }
      emitDetailChildren(ledger, child, depth + 1, range, sign, out);
      out.push({
        kind: "subtotal",
        label: "Total for " + humanize(child.name) + " with sub-accounts",
        depth,
        cents: total,
        bold: true,
      });
    }
  }
}

function detailSection(
  ledger: Ledger,
  entries: Entry[],
  range: DateRange,
  sign: number
): { rows: StatementRow[]; cents: number } {
  if (entries.length === 0) return { rows: [], cents: 0 };
  const tree = buildTree(entries, 1);
  const rows: StatementRow[] = [];
  emitDetailChildren(ledger, tree, 1, range, sign, rows);
  return { rows, cents: entries.reduce((s, e) => s + e.cents, 0) };
}

export function profitAndLossDetail(
  ledger: Ledger,
  range: DateRange = {},
  accountFilter?: string
): ProfitLoss {
  // Focused drill-down: just the clicked account (and any sub-accounts).
  if (accountFilter) {
    return detailForAccount(ledger, range, accountFilter);
  }

  const b = balances(ledger, range);
  const income: Entry[] = [];
  const cogs: Entry[] = [];
  const expenses: Entry[] = [];
  const otherIncome: Entry[] = [];
  const otherExpense: Entry[] = [];

  for (const [account, raw] of b) {
    const t = accountType(account);
    if (t === "Income") {
      const cents = -raw;
      if (Math.abs(cents) < 0.5) continue;
      (isOther(account) ? otherIncome : income).push({ account, cents });
    } else if (t === "Expenses") {
      const cents = raw;
      if (Math.abs(cents) < 0.5) continue;
      if (isCOGS(account)) cogs.push({ account, cents });
      else if (isOther(account)) otherExpense.push({ account, cents });
      else expenses.push({ account, cents });
    }
  }

  const rows: StatementRow[] = [];
  // income postings are negative in the ledger -> sign -1 to display positive
  const inc = detailSection(ledger, income, range, -1);
  const cog = detailSection(ledger, cogs, range, 1);
  const exp = detailSection(ledger, expenses, range, 1);
  const oInc = detailSection(ledger, otherIncome, range, -1);
  const oExp = detailSection(ledger, otherExpense, range, 1);

  rows.push({ kind: "section", label: "Income", depth: 0 });
  rows.push(...inc.rows);
  rows.push({ kind: "total", label: "Total for Income", depth: 0, cents: inc.cents, bold: true });

  if (cog.rows.length) {
    rows.push({ kind: "section", label: "Cost of Goods Sold", depth: 0 });
    rows.push(...cog.rows);
    rows.push({ kind: "total", label: "Total for Cost of Goods Sold", depth: 0, cents: cog.cents, bold: true });
  }
  const grossProfit = inc.cents - cog.cents;
  rows.push({ kind: "grandtotal", label: "Gross Profit", depth: 0, cents: grossProfit, bold: true });

  rows.push({ kind: "section", label: "Expenses", depth: 0 });
  rows.push(...exp.rows);
  rows.push({ kind: "total", label: "Total for Expenses", depth: 0, cents: exp.cents, bold: true });
  const netOperating = grossProfit - exp.cents;
  rows.push({ kind: "grandtotal", label: "Net Operating Income", depth: 0, cents: netOperating, bold: true });

  const hasOther = oInc.rows.length || oExp.rows.length;
  if (oInc.rows.length) {
    rows.push({ kind: "section", label: "Other Income", depth: 0 });
    rows.push(...oInc.rows);
    rows.push({ kind: "total", label: "Total for Other Income", depth: 0, cents: oInc.cents, bold: true });
  }
  if (oExp.rows.length) {
    rows.push({ kind: "section", label: "Other Expenses", depth: 0 });
    rows.push(...oExp.rows);
    rows.push({ kind: "total", label: "Total for Other Expenses", depth: 0, cents: oExp.cents, bold: true });
  }
  const netOther = oInc.cents - oExp.cents;
  if (hasOther) {
    rows.push({ kind: "grandtotal", label: "Net Other Income", depth: 0, cents: netOther, bold: true });
  }

  const netIncome = netOperating + netOther;
  rows.push({ kind: "grandtotal", label: "Net Income", depth: 0, cents: netIncome, bold: true });

  return { rows, netIncome, netIncomeCompare: 0 };
}

/** Focused P&L Detail for a single account (and its sub-accounts). */
function detailForAccount(
  ledger: Ledger,
  range: DateRange,
  account: string
): ProfitLoss {
  const t = accountType(account);
  const sign = t === "Income" ? -1 : 1; // income shown positive
  const b = balances(ledger, range);

  const entries: Entry[] = [];
  for (const [acct, raw] of b) {
    if (acct !== account && !acct.startsWith(account + ":")) continue;
    const cents = raw * sign;
    if (Math.abs(cents) < 0.5) continue;
    entries.push({ account: acct, cents });
  }

  // Strip the parent path so the tree is rooted at the filtered account.
  const stripSegments = account.split(":").length - 1;
  const tree = buildTree(entries, stripSegments);
  const rows: StatementRow[] = [];
  emitDetailChildren(ledger, tree, 0, range, sign, rows);

  const total = entries.reduce((s, e) => s + e.cents, 0);
  rows.push({ kind: "grandtotal", label: "Total for " + humanize(account.split(":").pop() || account), depth: 0, cents: total, bold: true, account });

  return { rows, netIncome: total, netIncomeCompare: 0 };
}

// ---- Trial Balance --------------------------------------------------------

export interface TrialBalanceRow {
  account: string; // full path
  label: string; // leaf segment (humanized), for indented display
  depth: number; // indentation from colon-hierarchy
  debit: number; // cents in the debit column (0 if none)
  credit: number; // cents in the credit column (0 if none)
}

export interface TrialBalance {
  asOf?: string; // the "to" date, if bounded
  from?: string;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean; // totalDebit === totalCredit
}

const ROOT_ORDER: Record<string, number> = {
  Assets: 0,
  Liabilities: 1,
  Equity: 2,
  Income: 3,
  Expenses: 4,
};

/**
 * Trial Balance: every account with a nonzero balance, each placed in the
 * Debit or Credit column by the natural sign of its posting total (positive =
 * debit, negative = credit). Total debits must equal total credits because
 * every transaction is balanced.
 */
export function trialBalance(ledger: Ledger, range: DateRange = {}): TrialBalance {
  const b = balances(ledger, range);
  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const [account, cents] of b) {
    if (Math.abs(cents) < 0.5) continue; // skip zero-balance accounts
    const debit = cents > 0 ? cents : 0;
    const credit = cents < 0 ? -cents : 0;
    totalDebit += debit;
    totalCredit += credit;
    const segs = account.split(":");
    rows.push({
      account,
      label: humanize(segs[segs.length - 1]),
      depth: segs.length - 1,
      debit,
      credit,
    });
  }

  // Canonical accounting order: root group, then full path alphabetical so
  // sub-accounts sit directly under their parent.
  rows.sort((a, b2) => {
    const ra = ROOT_ORDER[a.account.split(":")[0]] ?? 9;
    const rb = ROOT_ORDER[b2.account.split(":")[0]] ?? 9;
    return ra - rb || a.account.localeCompare(b2.account);
  });

  return {
    asOf: range.to,
    from: range.from,
    rows,
    totalDebit,
    totalCredit,
    balanced: totalDebit === totalCredit,
  };
}
