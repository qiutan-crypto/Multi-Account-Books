"use server";

// Server actions for the React app. These are the seam between the React UI
// and the server-side ledger store + Beancount engine. The client never
// parses Beancount or touches the filesystem; it calls these.

import {
  listEntities as storeList,
  loadEntity,
  saveEntity,
  createEntity,
  SAMPLE_ID,
  SAMPLE_LEDGER,
} from "@/lib/store";
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
  parsePaste,
  ensureIds,
  findById,
  type ReportLine,
  type AgingRow,
  type Transaction,
  type OpenDirective,
  type Ledger,
  type ImportRow,
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

// ---- paste import ---------------------------------------------------------

export interface ImportPreviewRowDTO {
  date: string;
  payee: string;
  narration: string;
  amount: string; // formatted
  account: string;
  offset: string;
}

export interface ImportPreviewDTO {
  rows: ImportPreviewRowDTO[];
  count: number;
}

export async function previewImport(
  text: string,
  defaults: { account: string; offset: string }
): Promise<ImportPreviewDTO> {
  const rows = parsePaste(text, defaults);
  return {
    count: rows.length,
    rows: rows.map((r) => ({
      date: r.date,
      payee: r.payee,
      narration: r.narration,
      amount: fromCents(r.amountCents),
      account: r.account,
      offset: r.offset,
    })),
  };
}

export async function commitImport(
  id: string,
  text: string,
  defaults: { account: string; offset: string }
): Promise<WriteResult & { added?: number }> {
  const ledgerText = await getLedgerText(id);
  if (ledgerText == null) return { ok: false, error: "Entity not found" };

  const rows: ImportRow[] = parsePaste(text, defaults);
  if (!rows.length) return { ok: false, error: "No valid rows to import" };

  const { ledger, errors: pre } = parse(ledgerText);
  if (pre.length)
    return { ok: false, error: "Ledger has issues; refusing to write: " + pre[0].message };

  const currency = ledger.options.operating_currency || "USD";
  for (const r of rows) {
    if (!accountType(r.account) || !accountType(r.offset))
      return {
        ok: false,
        error:
          "Row '" +
          r.narration +
          "' has an account without a valid root: " +
          r.account +
          " / " +
          r.offset,
      };
    ensureOpen(ledger, r.account, currency);
    ensureOpen(ledger, r.offset, currency);
    ledger.directives.push({
      kind: "transaction",
      date: r.date,
      flag: "*",
      payee: r.payee,
      narration: r.narration,
      meta: {},
      postings: [
        { account: r.account, amount: r.amountCents, currency },
        { account: r.offset, amount: -r.amountCents, currency },
      ],
    } as Transaction);
  }

  const next = serialize(ledger);
  const { errors: post } = parse(next);
  if (post.length) return { ok: false, error: "Validation failed: " + post[0].message };

  await saveLedgerText(id, next);
  return { ok: true, added: rows.length };
}

// ---- register (ledger with edit/filter/modes) -----------------------------

export interface RegisterPostingDTO {
  account: string;
  debit: string; // formatted, "" if this leg is a credit
  credit: string; // formatted, "" if this leg is a debit
  debitCents: number;
  creditCents: number;
}

export interface RegisterRowDTO {
  id: string;
  date: string;
  payee: string;
  narration: string;
  postings: RegisterPostingDTO[];
  /** For single-line view when filtered: the counter account or "— Split —". */
  counterLabel: string;
  /** Signed amount affecting the filtered account (cents), if filtered. */
  filterDelta: number;
  filterDebit: string; // formatted leg for the filtered account
  filterCredit: string;
  runningBalance: string; // formatted; "" when unfiltered
}

export interface RegisterDTO {
  rows: RegisterRowDTO[];
  accounts: string[];
  filter: string; // "" = all
}

function postingDTO(account: string, cents: number): RegisterPostingDTO {
  return {
    account,
    debit: cents > 0 ? fromCents(cents) : "",
    credit: cents < 0 ? fromCents(-cents) : "",
    debitCents: cents > 0 ? cents : 0,
    creditCents: cents < 0 ? -cents : 0,
  };
}

/**
 * Build the register. If `filter` is a specific account, only transactions
 * touching it are returned, with a running balance for that account and a
 * counter-account label ("— Split —" when 2+ other postings).
 */
export async function getRegister(
  id: string,
  filter = ""
): Promise<RegisterDTO> {
  const text = await getLedgerText(id);
  if (text == null) return { rows: [], accounts: [], filter };

  const parsed = parse(text);
  const ledger = parsed.ledger;
  if (ensureIds(ledger)) {
    // persist newly-assigned ids so they're stable on later reads
    await saveLedgerText(id, serialize(ledger));
  }

  const accounts = ledger.directives
    .filter((d): d is OpenDirective => d.kind === "open")
    .map((d) => d.account)
    .sort((a, b) => a.localeCompare(b));

  const txns = ledger.directives
    .filter((d): d is Transaction => d.kind === "transaction")
    .filter((t) => !filter || t.postings.some((p) => p.account === filter));

  // Running balance requires chronological order; compute then present newest first.
  const chrono = [...txns].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.meta.id || "").localeCompare(b.meta.id || "")
  );
  const runningById = new Map<string, number>();
  let running = 0;
  if (filter) {
    for (const t of chrono) {
      const delta = t.postings
        .filter((p) => p.account === filter)
        .reduce((s, p) => s + p.amount, 0);
      running += delta;
      runningById.set(t.meta.id!, running);
    }
  }

  const rows: RegisterRowDTO[] = chrono
    .slice()
    .reverse()
    .map((t) => {
      const others = filter
        ? t.postings.filter((p) => p.account !== filter)
        : t.postings;
      const counterLabel =
        others.length === 0
          ? "—"
          : others.length === 1
          ? others[0].account
          : "— Split —";
      const filterLeg = filter
        ? t.postings.filter((p) => p.account === filter).reduce((s, p) => s + p.amount, 0)
        : 0;
      return {
        id: t.meta.id!,
        date: t.date,
        payee: t.payee,
        narration: t.narration,
        postings: t.postings.map((p) => postingDTO(p.account, p.amount)),
        counterLabel,
        filterDelta: filterLeg,
        filterDebit: filterLeg > 0 ? fromCents(filterLeg) : "",
        filterCredit: filterLeg < 0 ? fromCents(-filterLeg) : "",
        runningBalance: filter ? fromCents(runningById.get(t.meta.id!) ?? 0) : "",
      };
    });

  return { rows, accounts, filter };
}

export interface EditPosting {
  account: string;
  amount: string; // signed decimal string; + = debit, - = credit
}

/** Update a transaction in full. Postings must balance to zero to save. */
export async function updateTransaction(
  id: string,
  txId: string,
  data: { date: string; payee: string; narration: string; postings: EditPosting[] }
): Promise<WriteResult> {
  const text = await getLedgerText(id);
  if (text == null) return { ok: false, error: "Entity not found" };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    return { ok: false, error: "A valid date is required" };
  const cleaned = data.postings
    .map((p) => ({ account: p.account.trim(), cents: toCents(p.amount) }))
    .filter((p) => p.account);
  if (cleaned.length < 2)
    return { ok: false, error: "At least two postings are required" };
  for (const p of cleaned)
    if (!accountType(p.account))
      return { ok: false, error: "Invalid account root: " + p.account };
  const sum = cleaned.reduce((s, p) => s + p.cents, 0);
  if (sum !== 0)
    return { ok: false, error: "Postings must balance to zero (off by " + fromCents(sum) + ")" };

  const { ledger, errors: pre } = parse(text);
  if (pre.length)
    return { ok: false, error: "Ledger has issues; refusing to write: " + pre[0].message };
  ensureIds(ledger);

  const tx = findById(ledger, txId);
  if (!tx) return { ok: false, error: "Transaction not found" };

  const currency = ledger.options.operating_currency || "USD";
  cleaned.forEach((p) => ensureOpen(ledger, p.account, currency));
  tx.date = data.date;
  tx.payee = data.payee;
  tx.narration = data.narration;
  tx.postings = cleaned.map((p) => ({ account: p.account, amount: p.cents, currency }));

  const next = serialize(ledger);
  const { errors: post } = parse(next);
  if (post.length) return { ok: false, error: "Validation failed: " + post[0].message };

  await saveLedgerText(id, next);
  return { ok: true };
}

export async function deleteTransaction(
  id: string,
  txId: string
): Promise<WriteResult> {
  const text = await getLedgerText(id);
  if (text == null) return { ok: false, error: "Entity not found" };
  const { ledger, errors: pre } = parse(text);
  if (pre.length)
    return { ok: false, error: "Ledger has issues; refusing to write: " + pre[0].message };
  ensureIds(ledger);
  const before = ledger.directives.length;
  ledger.directives = ledger.directives.filter(
    (d) => !(d.kind === "transaction" && d.meta.id === txId)
  );
  if (ledger.directives.length === before)
    return { ok: false, error: "Transaction not found" };
  await saveLedgerText(id, serialize(ledger));
  return { ok: true };
}

// ---- reseed ---------------------------------------------------------------

/**
 * Overwrite the sample entity with the current bundled SAMPLE_LEDGER (the
 * 3-year dataset). Useful to refresh an existing store whose sample predates
 * the new data. Validates before saving and returns the entity id to select.
 */
export async function reseedSample(): Promise<WriteResult & { id?: string }> {
  const { errors } = parse(SAMPLE_LEDGER);
  if (errors.length)
    return { ok: false, error: "Sample data is invalid: " + errors[0].message };
  await saveEntity(SAMPLE_ID, SAMPLE_LEDGER);
  return { ok: true, id: SAMPLE_ID };
}
