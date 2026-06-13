"use server";

// Server actions for the React app. These are the seam between the React UI
// and the server-side ledger store + Beancount engine. The client never
// parses Beancount or touches the filesystem; it calls these.

import {
  listEntities as storeList,
  loadEntity,
  saveEntity,
  createEntity,
} from "@/lib/store/fs";
import {
  parse,
  serialize,
  incomeStatement,
  balanceSheet,
  aging,
  totals,
  fromCents,
  toCents,
  accountType,
  type ReportLine,
  type AgingRow,
  type Transaction,
  type OpenDirective,
  type Ledger,
} from "@/lib/beancount";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface EntitySummary {
  id: string;
  name: string;
}

export async function listEntities(): Promise<EntitySummary[]> {
  return storeList();
}

export async function getLedgerText(id: string): Promise<string | null> {
  const e = await loadEntity(id);
  return e ? e.beancount : null;
}

export async function saveLedgerText(id: string, beancount: string): Promise<void> {
  await saveEntity(id, beancount);
}

export async function addEntity(name: string): Promise<EntitySummary> {
  const id =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "entity-" + Date.now();
  const e = await createEntity(id, name);
  return { id: e.id, name: e.name };
}

// ---- report DTOs ----------------------------------------------------------

export interface ReportLineDTO {
  account: string;
  display: string;
  cents: number;
}
export interface AgingRowDTO {
  party: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
  total: string;
}
export interface ReportsDTO {
  found: boolean;
  asOf: string;
  errors: { line: number; message: string }[];
  metrics: {
    assets: string;
    liabilities: string;
    revenue: string;
    netIncome: string;
  };
  income: ReportLineDTO[];
  expenses: ReportLineDTO[];
  netIncome: string;
  balanceSheet: {
    assets: ReportLineDTO[];
    liabilities: ReportLineDTO[];
    equity: ReportLineDTO[];
    currentEarnings: string;
    totalAssets: string;
    totalLiabEquity: string;
    balances: boolean;
  };
  arAging: { rows: AgingRowDTO[]; total: AgingRowDTO };
  apAging: { rows: AgingRowDTO[]; total: AgingRowDTO };
}

function lineDTO(l: ReportLine): ReportLineDTO {
  return { account: l.account, display: fromCents(l.cents), cents: l.cents };
}
function agingDTO(r: AgingRow): AgingRowDTO {
  return {
    party: r.party,
    current: fromCents(r.current),
    d1_30: fromCents(r.d1_30),
    d31_60: fromCents(r.d31_60),
    d61_90: fromCents(r.d61_90),
    d90_plus: fromCents(r.d90_plus),
    total: fromCents(r.total),
  };
}

export async function getReports(
  id: string,
  range: { from?: string; to?: string } = {}
): Promise<ReportsDTO | null> {
  const text = await getLedgerText(id);
  if (text == null) return null;

  const { ledger, errors } = parse(text);
  const asOf = range.to || today();
  const is = incomeStatement(ledger, range);
  const bs = balanceSheet(ledger, asOf);
  const t = totals(ledger, range);
  const ar = aging(ledger, "Assets:AccountsReceivable", asOf);
  const ap = aging(ledger, "Liabilities:AccountsPayable", asOf, { flip: true });

  return {
    found: true,
    asOf,
    errors,
    metrics: {
      assets: fromCents(totals(ledger, { to: asOf }).assets),
      liabilities: fromCents(totals(ledger, { to: asOf }).liabilities),
      revenue: fromCents(t.revenue),
      netIncome: fromCents(t.netIncome),
    },
    income: is.income.map(lineDTO),
    expenses: is.expenses.map(lineDTO),
    netIncome: fromCents(is.netIncome),
    balanceSheet: {
      assets: bs.assets.map(lineDTO),
      liabilities: bs.liabilities.map(lineDTO),
      equity: bs.equity.map(lineDTO),
      currentEarnings: fromCents(bs.currentEarnings),
      totalAssets: fromCents(bs.totalAssets),
      totalLiabEquity: fromCents(bs.totalLiabEquity),
      balances: bs.balances,
    },
    arAging: { rows: ar.rows.map(agingDTO), total: agingDTO(ar.total) },
    apAging: { rows: ap.rows.map(agingDTO), total: agingDTO(ap.total) },
  };
}

// ---- write path -----------------------------------------------------------

/** Account names declared in the ledger (from `open` directives), sorted. */
export async function getAccounts(id: string): Promise<string[]> {
  const text = await getLedgerText(id);
  if (text == null) return [];
  const { ledger } = parse(text);
  return ledger.directives
    .filter((d): d is OpenDirective => d.kind === "open")
    .map((d) => d.account)
    .sort((a, b) => a.localeCompare(b));
}

export interface NewTransaction {
  date: string;
  payee: string;
  narration: string;
  debitAccount: string; // receives +amount
  creditAccount: string; // receives -amount
  amount: string; // decimal string, e.g. "125.00"
  currency?: string;
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

/** Ensure an account has an `open` directive; add one if missing. */
function ensureOpen(ledger: Ledger, account: string, currency: string): void {
  if (!account) return;
  const exists = ledger.directives.some(
    (d) => d.kind === "open" && d.account === account
  );
  if (exists) return;
  const open: OpenDirective = {
    kind: "open",
    date: "1970-01-01",
    account,
    currencies: [currency],
  };
  ledger.directives.push(open);
}

/**
 * Append a balanced two-posting transaction to the ledger, validating the
 * whole ledger through the engine BEFORE saving. Never writes an invalid or
 * unbalanced ledger to disk. This is the template every document write
 * (invoices, bills, payments) will follow.
 */
export async function addTransaction(
  id: string,
  tx: NewTransaction
): Promise<WriteResult> {
  const text = await getLedgerText(id);
  if (text == null) return { ok: false, error: "Entity not found" };

  // basic input validation
  if (!tx.date || !/^\d{4}-\d{2}-\d{2}$/.test(tx.date))
    return { ok: false, error: "A valid date is required" };
  if (!tx.debitAccount || !tx.creditAccount)
    return { ok: false, error: "Both accounts are required" };
  if (tx.debitAccount === tx.creditAccount)
    return { ok: false, error: "Debit and credit accounts must differ" };
  if (!accountType(tx.debitAccount) || !accountType(tx.creditAccount))
    return { ok: false, error: "Accounts must start with a valid root (Assets, Liabilities, …)" };
  const cents = toCents(tx.amount);
  if (cents === 0) return { ok: false, error: "Amount must be non-zero" };

  const currency = tx.currency || "USD";
  const { ledger, errors: preErrors } = parse(text);
  if (preErrors.length)
    return {
      ok: false,
      error: "Existing ledger has issues; refusing to write: " + preErrors[0].message,
    };

  ensureOpen(ledger, tx.debitAccount, currency);
  ensureOpen(ledger, tx.creditAccount, currency);

  const directive: Transaction = {
    kind: "transaction",
    date: tx.date,
    flag: "*",
    payee: tx.payee || "",
    narration: tx.narration || "",
    meta: {},
    postings: [
      { account: tx.debitAccount, amount: cents, currency },
      { account: tx.creditAccount, amount: -cents, currency },
    ],
  };
  ledger.directives.push(directive);

  // Re-serialize and re-parse to validate the FULL ledger before saving.
  const nextText = serialize(ledger);
  const { errors: postErrors } = parse(nextText);
  if (postErrors.length)
    return { ok: false, error: "Validation failed: " + postErrors[0].message };

  await saveLedgerText(id, nextText);
  return { ok: true };
}

export interface LedgerTxnDTO {
  date: string;
  payee: string;
  narration: string;
  postings: { account: string; display: string }[];
}

/** Recent transactions (newest first) for the ledger view. */
export async function getRecentTransactions(
  id: string,
  limit = 25
): Promise<LedgerTxnDTO[]> {
  const text = await getLedgerText(id);
  if (text == null) return [];
  const { ledger } = parse(text);
  const txns = ledger.directives.filter(
    (d): d is Transaction => d.kind === "transaction"
  );
  return txns
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .map((t) => ({
      date: t.date,
      payee: t.payee,
      narration: t.narration,
      postings: t.postings.map((p) => ({
        account: p.account,
        display: fromCents(p.amount),
      })),
    }));
}

// ---- chart of accounts ----------------------------------------------------

export interface AccountRowDTO {
  account: string;
  type: string;
  balance: string; // formatted, natural sign
  removable: boolean; // false if the account has any posting
}

/** Validate a Beancount account name: Root:Sub:Sub, each segment capitalized. */
function validAccountName(name: string): boolean {
  if (!accountType(name)) return false;
  return name.split(":").every((seg) => /^[A-Z][A-Za-z0-9-]*$/.test(seg));
}

/** Per-account balances + whether each can be safely removed. */
export async function getAccountRows(id: string): Promise<AccountRowDTO[]> {
  const text = await getLedgerText(id);
  if (text == null) return [];
  const { ledger } = parse(text);

  const opens = ledger.directives.filter(
    (d): d is OpenDirective => d.kind === "open"
  );
  const used = new Set<string>();
  const bal = new Map<string, number>();
  for (const d of ledger.directives) {
    if (d.kind !== "transaction") continue;
    for (const p of d.postings) {
      used.add(p.account);
      bal.set(p.account, (bal.get(p.account) || 0) + p.amount);
    }
  }
  return opens
    .map((o) => ({
      account: o.account,
      type: accountType(o.account) || "—",
      balance: fromCents(bal.get(o.account) || 0),
      removable: !used.has(o.account),
    }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

export async function addAccount(
  id: string,
  account: string,
  openingBalance?: string,
  currency = "USD"
): Promise<WriteResult> {
  const text = await getLedgerText(id);
  if (text == null) return { ok: false, error: "Entity not found" };

  account = account.trim();
  if (!validAccountName(account))
    return {
      ok: false,
      error:
        "Name must be like Assets:Bank:Checking (root + capitalized segments)",
    };

  const { ledger, errors: pre } = parse(text);
  if (pre.length)
    return { ok: false, error: "Ledger has issues; refusing to write: " + pre[0].message };

  if (ledger.directives.some((d) => d.kind === "open" && d.account === account))
    return { ok: false, error: "Account already exists" };

  ensureOpen(ledger, account, currency);

  // Optional opening balance, offset to Equity:Owner (matches prior behavior).
  const opening = openingBalance ? toCents(openingBalance) : 0;
  if (opening !== 0) {
    ensureOpen(ledger, "Equity:Owner", currency);
    ledger.directives.push({
      kind: "transaction",
      date: today(),
      flag: "*",
      payee: "Opening balance",
      narration: account,
      meta: {},
      postings: [
        { account, amount: opening, currency },
        { account: "Equity:Owner", amount: -opening, currency },
      ],
    } as Transaction);
  }

  const next = serialize(ledger);
  const { errors: post } = parse(next);
  if (post.length) return { ok: false, error: "Validation failed: " + post[0].message };

  await saveLedgerText(id, next);
  return { ok: true };
}

export async function removeAccount(
  id: string,
  account: string
): Promise<WriteResult> {
  const text = await getLedgerText(id);
  if (text == null) return { ok: false, error: "Entity not found" };

  const { ledger, errors: pre } = parse(text);
  if (pre.length)
    return { ok: false, error: "Ledger has issues; refusing to write: " + pre[0].message };

  const hasActivity = ledger.directives.some(
    (d) => d.kind === "transaction" && d.postings.some((p) => p.account === account)
  );
  if (hasActivity)
    return { ok: false, error: "This account has activity and cannot be removed" };

  const before = ledger.directives.length;
  ledger.directives = ledger.directives.filter(
    (d) => !(d.kind === "open" && d.account === account)
  );
  if (ledger.directives.length === before)
    return { ok: false, error: "Account not found" };

  const next = serialize(ledger);
  await saveLedgerText(id, next);
  return { ok: true };
}
