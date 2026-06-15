"use server";

// Server actions for the React app. These are the seam between the React UI
// and the server-side ledger store + Beancount engine. The client never
// parses Beancount or touches the filesystem; it calls these.

import {
  listEntities as storeList,
  loadEntity,
  saveEntity,
  deleteEntityFromStore,
  SAMPLE_ID,
  SAMPLE_LEDGER,
} from "@/lib/store";
import {
  pwHash,
  slugify,
  READONLY_SAMPLE_ID,
  READONLY_MSG,
} from "./entity-helpers";
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
  byPayee,
  profitAndLoss,
  profitAndLossDetail,
  balanceSheetStatement,
  type StatementRow,
  type ReportLine,
  type AgingRow,
  type PayeeRow,
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
  // The read-only sample can never be mutated through the normal write path.
  if (id === READONLY_SAMPLE_ID) {
    throw new Error(READONLY_MSG);
  }
  await saveEntity(id, beancount);
}

/**
 * Create a new entity, optionally protected by an owner name + password.
 * The owner and a password hash are stored as ledger options; no plaintext.
 */
export async function addEntity(
  name: string,
  owner?: string,
  password?: string
): Promise<EntitySummary> {
  const id = slugify(name);
  let text =
    'option "title" "' +
    name.replace(/"/g, "'") +
    '"\noption "operating_currency" "USD"\n';
  if (owner && password) {
    text +=
      'option "bb_owner" "' +
      owner.replace(/"/g, "'") +
      '"\noption "bb_pwhash" "' +
      pwHash(owner, password) +
      '"\n';
  }
  text += "\n";
  await saveEntity(id, text);
  return { id, name };
}

/**
 * Permanently delete a company file. The read-only sample cannot be deleted.
 * NOTE: the admin gate is a client-side deterrent; this action itself performs
 * no auth, so do not treat it as access control.
 */
export async function deleteEntity(id: string): Promise<{ ok: boolean; error?: string }> {
  if (id === READONLY_SAMPLE_ID) {
    return { ok: false, error: "The read-only Sample Company cannot be deleted." };
  }
  await deleteEntityFromStore(id);
  return { ok: true };
}

/**
 * Verify the admin password server-side. The password comes from the
 * ADMIN_PASSWORD environment variable (set in Vercel → Settings → Environment
 * Variables), so it is never in the repo or the browser bundle. Falls back to
 * a dev default only when the env var is unset (local development).
 */
export async function verifyAdmin(password: string): Promise<{ ok: boolean }> {
  const expected = process.env.ADMIN_PASSWORD;
  // No password configured -> admin is disabled (never auto-grant).
  if (!expected) return { ok: false };
  return { ok: password === expected };
}

/** Whether an entity is password-protected, and its owner name if so. */
export async function getEntityProtection(
  id: string
): Promise<{ protected: boolean; owner: string }> {
  const text = await getLedgerText(id);
  if (text == null) return { protected: false, owner: "" };
  const { ledger } = parse(text);
  const hash = ledger.options.bb_pwhash || "";
  return { protected: !!hash, owner: ledger.options.bb_owner || "" };
}

/** Verify a login attempt against the stored hash. */
export async function verifyLogin(
  id: string,
  owner: string,
  password: string
): Promise<{ ok: boolean }> {
  const text = await getLedgerText(id);
  if (text == null) return { ok: false };
  const { ledger } = parse(text);
  const stored = ledger.options.bb_pwhash;
  if (!stored) return { ok: true }; // unprotected
  return { ok: pwHash(owner, password) === stored };
}


/**
 * Create a new entity by duplicating an existing one. If the source is
 * password-protected, the caller must supply the correct source owner+password.
 * The new entity gets its own (optional) protection and a fresh title; the
 * source's protection options are stripped, and read-only flags are removed.
 */
export async function duplicateEntity(
  sourceId: string,
  newName: string,
  opts: {
    owner?: string;
    password?: string;
    sourceOwner?: string;
    sourcePassword?: string;
  } = {}
): Promise<WriteResult & { id?: string; name?: string }> {
  const srcText = await getLedgerText(sourceId);
  if (srcText == null) return { ok: false, error: "Source entity not found" };

  const { ledger } = parse(srcText);

  // If the source is protected, require its password to duplicate. The source's
  // own stored owner name is used for the hash, so the user only types the
  // password (or the owner, if they prefer to confirm it).
  const srcHash = ledger.options.bb_pwhash;
  if (srcHash) {
    const srcOwner = (opts.sourceOwner || ledger.options.bb_owner || "").trim();
    const ok = pwHash(srcOwner, opts.sourcePassword || "") === srcHash;
    if (!ok)
      return { ok: false, error: "Incorrect password for the source entity." };
  }

  const id = slugify(newName);
  if (await getLedgerText(id))
    return { ok: false, error: "An entity with a similar name already exists." };

  // New options: fresh title, copy operating_currency, strip protection + readonly.
  ledger.options = {
    title: newName,
    operating_currency: ledger.options.operating_currency || "USD",
  };
  if (opts.owner && opts.password) {
    ledger.options.bb_owner = opts.owner.trim();
    ledger.options.bb_pwhash = pwHash(opts.owner.trim(), opts.password);
  }

  const next = serialize(ledger);
  const { errors } = parse(next);
  if (errors.length)
    return { ok: false, error: "Validation failed: " + errors[0].message };

  await saveLedgerText(id, next);
  return { ok: true, id, name: newName };
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
  incomeByPayee: { rows: PayeeRowDTO[]; total: string };
  expensesByPayee: { rows: PayeeRowDTO[]; total: string };
}

export interface PayeeRowDTO {
  payee: string;
  display: string;
}

function lineDTO(l: ReportLine): ReportLineDTO {
  return { account: l.account, display: fromCents(l.cents), cents: l.cents };
}
function payeeDTO(r: PayeeRow): PayeeRowDTO {
  return { payee: r.payee, display: fromCents(r.cents) };
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
  const incPayee = byPayee(ledger, "Income", range);
  const expPayee = byPayee(ledger, "Expenses", range);

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
    incomeByPayee: { rows: incPayee.rows.map(payeeDTO), total: fromCents(incPayee.total) },
    expensesByPayee: { rows: expPayee.rows.map(payeeDTO), total: fromCents(expPayee.total) },
  };
}

// ---- dashboard ------------------------------------------------------------

export interface DashboardDTO {
  found: boolean;
  asOf: string;
  ytdFrom: string;
  errors: { line: number; message: string }[];
  // Top KPI cards
  cash: string; // sum of bank/cash asset accounts, as of today
  arTotal: string; // total outstanding A/R
  apTotal: string; // total outstanding A/P
  netIncomeYtd: string; // year-to-date net income
  // Year-to-date P&L
  revenueYtd: string;
  expensesYtd: string;
  // Overdue (everything past "current" in the aging buckets)
  arOverdue: string;
  apOverdue: string;
  // Health + scale
  balances: boolean;
  txnCount: number;
  accountCount: number;
  // Lists
  topCustomers: PayeeRowDTO[]; // income by payee, top 5
  recent: LedgerTxnDTO[]; // most recent transactions
}

/**
 * One-call snapshot for the Dashboard home tab. P&L figures (revenue,
 * expenses, net income, income-vs-expenses, top customers) respect the chosen
 * period. Balances and aging are computed "as of" the period end (or today if
 * no end is given). Reuses the same engine functions as the Reports tab so the
 * numbers always agree.
 */
export async function getDashboard(
  id: string,
  range: { from?: string; to?: string } = {}
): Promise<DashboardDTO | null> {
  const text = await getLedgerText(id);
  if (text == null) return null;

  const { ledger, errors } = parse(text);
  const asOf = range.to || today();
  // Period for P&L: default to year-to-date of `asOf` when no `from` given.
  const periodFrom = range.from || asOf.slice(0, 4) + "-01-01";
  const period = { from: periodFrom, to: asOf };

  const bs = balanceSheet(ledger, asOf);
  const ytd = totals(ledger, period);
  const ar = aging(ledger, "Assets:AccountsReceivable", asOf);
  const ap = aging(ledger, "Liabilities:AccountsPayable", asOf, { flip: true });
  const incPayee = byPayee(ledger, "Income", period);

  // Cash = asset accounts that read as bank/cash, summed from the balance sheet.
  const cashCents = bs.assets
    .filter((l) => /(:|^)(Bank|Cash|Checking|Savings|Petty)/i.test(l.account))
    .reduce((s, l) => s + l.cents, 0);

  const txns = ledger.directives.filter(
    (d): d is Transaction => d.kind === "transaction"
  );
  const accountCount = ledger.directives.filter((d) => d.kind === "open").length;

  return {
    found: true,
    asOf,
    ytdFrom: periodFrom,
    errors,
    cash: fromCents(cashCents),
    arTotal: fromCents(ar.total.total),
    apTotal: fromCents(ap.total.total),
    netIncomeYtd: fromCents(ytd.netIncome),
    revenueYtd: fromCents(ytd.revenue),
    expensesYtd: fromCents(ytd.expenses),
    arOverdue: fromCents(ar.total.total - ar.total.current),
    apOverdue: fromCents(ap.total.total - ap.total.current),
    balances: bs.balances,
    txnCount: txns.length,
    accountCount,
    topCustomers: incPayee.rows.slice(0, 5).map(payeeDTO),
    recent: txns
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8)
      .map((t) => ({
        date: t.date,
        payee: t.payee,
        narration: t.narration,
        postings: t.postings.map((p) => ({
          account: p.account,
          display: fromCents(p.amount),
        })),
      })),
  };
}

// ---- Statements (P&L + Balance Sheet) ----------------------------

export interface StatementRowDTO {
  kind: string;
  label: string;
  depth: number;
  display: string; // formatted current amount; "" for header/spacer rows
  negative: boolean;
  bold: boolean;
  account: string; // full account path (for drill-down); "" if none
  // comparison (present only when comparing)
  compareDisplay: string;
  compareNegative: boolean;
  changeDisplay: string; // formatted $ or % change
  changeNegative: boolean;
}

export interface StatementsDTO {
  company: string;
  asOf: string;
  periodLabel: string;
  comparePeriodLabel: string; // "" when not comparing
  changeMode: "amount" | "percent" | "";
  generatedAt: string;
  pl: StatementRowDTO[];
  bs: StatementRowDTO[];
  plNetIncome: string;
  bsBalances: boolean;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return MONTHS[m - 1] + " " + d + ", " + y;
}

/** Shift an ISO date back by N years (for prior-year comparison). */
function shiftYears(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y - n}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function makeRowDTO(
  r: StatementRow,
  comparing: boolean,
  mode: "amount" | "percent"
): StatementRowDTO {
  const hasCur = typeof r.cents === "number";
  const hasCmp = typeof r.compareCents === "number";
  const cur = (r.cents as number) || 0;
  const cmp = (r.compareCents as number) || 0;

  let changeDisplay = "";
  let changeNegative = false;
  if (comparing && hasCur) {
    if (mode === "amount") {
      const diff = cur - cmp;
      changeDisplay = fromCents(diff);
      changeNegative = diff < 0;
    } else {
      // percent change vs comparison; n/a if prior is zero
      if (Math.abs(cmp) < 0.5) {
        changeDisplay = cur === 0 ? "0.0%" : "n/a";
        changeNegative = false;
      } else {
        const pct = ((cur - cmp) / Math.abs(cmp)) * 100;
        changeDisplay = (pct >= 0 ? "" : "-") + Math.abs(pct).toFixed(1) + "%";
        changeNegative = pct < 0;
      }
    }
  }

  return {
    kind: r.kind,
    label: r.label,
    depth: r.depth,
    display: hasCur ? fromCents(cur) : "",
    negative: hasCur ? cur < 0 : false,
    bold: !!r.bold,
    account: r.account || "",
    compareDisplay: comparing && hasCmp ? fromCents(cmp) : "",
    compareNegative: comparing && hasCmp ? cmp < 0 : false,
    changeDisplay,
    changeNegative,
  };
}

export async function getStatements(
  id: string,
  range: { from?: string; to?: string } = {},
  opts: {
    compare?: { from?: string; to?: string }; // explicit comparison range
    compareMode?: "off" | "prior-year" | "custom";
    changeMode?: "amount" | "percent";
  } = {}
): Promise<StatementsDTO | null> {
  const text = await getLedgerText(id);
  if (text == null) return null;
  const { ledger } = parse(text);

  const asOf = range.to || today();
  const from = range.from || asOf.slice(0, 4) + "-01-01";

  const compareMode = opts.compareMode || "off";
  const changeMode = opts.changeMode || "amount";
  const comparing = compareMode !== "off";

  let cFrom: string | undefined;
  let cTo: string | undefined;
  if (compareMode === "prior-year") {
    cFrom = shiftYears(from, 1);
    cTo = shiftYears(asOf, 1);
  } else if (compareMode === "custom" && opts.compare) {
    cFrom = opts.compare.from;
    cTo = opts.compare.to;
  }

  const pl = profitAndLoss(
    ledger,
    { from, to: asOf },
    comparing ? { from: cFrom, to: cTo } : undefined
  );
  const bs = balanceSheetStatement(ledger, asOf, comparing ? cTo : undefined);

  return {
    company: ledger.options.title || "Company",
    asOf,
    periodLabel: longDate(from) + " - " + longDate(asOf),
    comparePeriodLabel:
      comparing && cFrom && cTo ? longDate(cFrom) + " - " + longDate(cTo) : "",
    changeMode: comparing ? changeMode : "",
    generatedAt: new Date().toLocaleString("en-US"),
    pl: pl.rows.map((r) => makeRowDTO(r, comparing, changeMode)),
    bs: bs.rows.map((r) => makeRowDTO(r, comparing, changeMode)),
    plNetIncome: fromCents(pl.netIncome),
    bsBalances: bs.balances,
  };
}

// ---- P&L Detail -----------------------------------------------------------

export interface DetailRowDTO {
  kind: string;
  label: string;
  depth: number;
  display: string; // amount (subtotals/totals/txn); "" for headers
  negative: boolean;
  bold: boolean;
  account: string; // the account this row belongs to (header/subtotal/txn)
  // txn-only fields
  date: string;
  num: string;
  name: string;
  description: string;
  split: string;
  balance: string;
  balanceNegative: boolean;
}

export interface PLDetailDTO {
  company: string;
  periodLabel: string;
  generatedAt: string;
  accountFilter: string; // "" for full detail
  rows: DetailRowDTO[];
}

export async function getPLDetail(
  id: string,
  range: { from?: string; to?: string } = {},
  accountFilter?: string
): Promise<PLDetailDTO | null> {
  const text = await getLedgerText(id);
  if (text == null) return null;
  const { ledger } = parse(text);

  const asOf = range.to || today();
  const from = range.from || asOf.slice(0, 4) + "-01-01";
  const det = profitAndLossDetail(ledger, { from, to: asOf }, accountFilter || undefined);

  return {
    company: ledger.options.title || "Company",
    periodLabel: longDate(from) + " - " + longDate(asOf),
    generatedAt: new Date().toLocaleString("en-US"),
    accountFilter: accountFilter || "",
    rows: det.rows.map((r): DetailRowDTO => {
      const has = typeof r.cents === "number";
      const t = r.txn;
      return {
        kind: r.kind,
        label: r.label,
        depth: r.depth,
        display: has ? fromCents(r.cents as number) : "",
        negative: has ? (r.cents as number) < 0 : false,
        bold: !!r.bold,
        account: r.account || "",
        date: t?.date || "",
        num: t?.num || "",
        name: t?.name || "",
        description: t?.description || "",
        split: t?.split || "",
        balance: t ? fromCents(t.balance) : "",
        balanceNegative: t ? t.balance < 0 : false,
      };
    }),
  };
}

/** Income & expense accounts (for the P&L Detail filter dropdown), sorted. */
export async function getPLAccounts(id: string): Promise<string[]> {
  const text = await getLedgerText(id);
  if (text == null) return [];
  const { ledger } = parse(text);
  const out = new Set<string>();
  for (const d of ledger.directives) {
    if (d.kind !== "open") continue;
    const t = accountType(d.account);
    if (t === "Income" || t === "Expenses") {
      out.add(d.account);
      // also offer parent groups (e.g. Income:Revenue-Product)
      const segs = d.account.split(":");
      for (let i = 2; i < segs.length; i++) out.add(segs.slice(0, i).join(":"));
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

// ---- export ---------------------------------------------------------------

export interface ExportInfo {
  sample: string; // first ~10 lines for preview
  truncated: boolean; // whether more lines exist beyond the sample
  totalLines: number;
  txnCount: number;
  minDate: string;
  maxDate: string;
}

/** Lightweight preview for the Export tab — no full file shipped to the client. */
export async function getExportSample(id: string, sampleLines = 10): Promise<ExportInfo | null> {
  const text = await getLedgerText(id);
  if (text == null) return null;
  const lines = text.split("\n");
  const { ledger } = parse(text);
  const txns = ledger.directives.filter((d): d is Transaction => d.kind === "transaction");
  let minD = "", maxD = "";
  for (const t of txns) {
    if (!minD || t.date < minD) minD = t.date;
    if (!maxD || t.date > maxD) maxD = t.date;
  }
  return {
    sample: lines.slice(0, sampleLines).join("\n"),
    truncated: lines.length > sampleLines,
    totalLines: lines.length,
    txnCount: txns.length,
    minDate: minD,
    maxDate: maxD,
  };
}

/**
 * Build the export text. With no range, returns the full ledger as-is. With a
 * range, re-serializes: keep options + all `open` directives, but only the
 * transactions (and balance assertions) within [from, to].
 */
export async function buildExport(
  id: string,
  range: { from?: string; to?: string } = {}
): Promise<string | null> {
  const text = await getLedgerText(id);
  if (text == null) return null;
  if (!range.from && !range.to) return text; // full file, untouched

  const { ledger } = parse(text);
  const inR = (date: string) =>
    (!range.from || date >= range.from) && (!range.to || date <= range.to);
  const filtered: typeof ledger = {
    options: ledger.options,
    directives: ledger.directives.filter((d) => {
      if (d.kind === "open") return true; // always keep the chart of accounts
      return inR(d.date);
    }),
  };
  return serialize(filtered);
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
  if (id === READONLY_SAMPLE_ID) return { ok: false, error: READONLY_MSG };
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
  if (id === READONLY_SAMPLE_ID) return { ok: false, error: READONLY_MSG };
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
  if (id === READONLY_SAMPLE_ID) return { ok: false, error: READONLY_MSG };
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
  if (id === READONLY_SAMPLE_ID) return { ok: false, error: READONLY_MSG };
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
  /** Balance of the filtered account before `from` (formatted). "" if no filter/from. */
  openingBalance: string;
  hasOpening: boolean;
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
  filter = "",
  range: { from?: string; to?: string } = {}
): Promise<RegisterDTO> {
  const empty: RegisterDTO = {
    rows: [],
    accounts: [],
    filter,
    openingBalance: "",
    hasOpening: false,
  };
  const text = await getLedgerText(id);
  if (text == null) return empty;

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

  const { from, to } = range;
  const allTxns = ledger.directives.filter(
    (d): d is Transaction => d.kind === "transaction"
  );

  // Beginning balance: sum of the filtered account's postings dated before
  // `from` (only meaningful with both a filter and a from-date).
  let openingCents = 0;
  const hasOpening = !!(filter && from);
  if (hasOpening) {
    for (const t of allTxns) {
      if (t.date >= from!) continue;
      for (const p of t.postings) if (p.account === filter) openingCents += p.amount;
    }
  }

  // In-range transactions touching the filtered account.
  const txns = allTxns
    .filter((t) => !filter || t.postings.some((p) => p.account === filter))
    .filter((t) => (!from || t.date >= from) && (!to || t.date <= to));

  // Running balance requires chronological order; seed from the opening balance.
  const chrono = [...txns].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.meta.id || "").localeCompare(b.meta.id || "")
  );
  const runningById = new Map<string, number>();
  let running = openingCents;
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

  return {
    rows,
    accounts,
    filter,
    openingBalance: hasOpening ? fromCents(openingCents) : "",
    hasOpening,
  };
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
  if (id === READONLY_SAMPLE_ID) return { ok: false, error: READONLY_MSG };
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
  if (id === READONLY_SAMPLE_ID) return { ok: false, error: READONLY_MSG };
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
