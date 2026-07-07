"use server";

// Server actions for the multi-bank features: multi-account bank feed commits
// with duplicate/transfer detection, classification rules storage, transaction
// reclassification, reconcile data, and QuickBooks Desktop export data.

import { loadAux, saveAux } from "@/lib/store";
import { READONLY_SAMPLE_ID, READONLY_MSG } from "./entity-helpers";
import { parseAux, type AuxData, type ReconcileSettings } from "@/lib/feed/auxdata";
import type { Rule } from "@/lib/feed/rules";
import { getLedgerText, saveLedgerText, type WriteResult } from "./actions";
import {
  parse,
  serialize,
  ensureIds,
  fromCents,
  accountType,
  type Transaction,
  type OpenDirective,
  type Ledger,
} from "@/lib/beancount";

// ---- aux data ---------------------------------------------------------------

export async function getAuxData(id: string): Promise<AuxData> {
  return parseAux(await loadAux(id));
}

async function patchAux(id: string, patch: Partial<AuxData>): Promise<void> {
  const aux = parseAux(await loadAux(id));
  await saveAux(id, JSON.stringify({ ...aux, ...patch }));
}

export async function saveRules(id: string, rules: Rule[]): Promise<WriteResult> {
  await patchAux(id, { rules });
  return { ok: true };
}

export async function saveAccountMap(
  id: string,
  map: Record<string, string>
): Promise<WriteResult> {
  const aux = parseAux(await loadAux(id));
  await patchAux(id, { accountMap: { ...aux.accountMap, ...map } });
  return { ok: true };
}

export async function saveReconcileSettings(
  id: string,
  account: string,
  settings: ReconcileSettings
): Promise<WriteResult> {
  const aux = parseAux(await loadAux(id));
  await patchAux(id, { reconcile: { ...aux.reconcile, [account]: settings } });
  return { ok: true };
}

export async function saveCoaDescriptions(
  id: string,
  desc: Record<string, string>
): Promise<WriteResult> {
  const aux = parseAux(await loadAux(id));
  await patchAux(id, { coaDesc: { ...aux.coaDesc, ...desc } });
  return { ok: true };
}

// ---- multi-account bank feed commit ----------------------------------------

export interface MultiFeedSplit {
  category: string;
  amountCents: number;
}

export interface MultiFeedRow {
  date: string; // ISO
  payee: string;
  description: string;
  ref: string;
  sourceAccount: string; // the bank/credit-card ledger account for this row
  amountCents: number; // signed; negative = money out of the source
  splits: MultiFeedSplit[]; // must sum to amountCents
}

export interface MultiFeedResult extends WriteResult {
  added?: number;
  duplicates?: number; // identical rows already in the ledger
  transferMatches?: number; // mirror side of a transfer already recorded
}

function ensureOpen(ledger: Ledger, account: string, currency: string): void {
  if (!account) return;
  const exists = ledger.directives.some((d) => d.kind === "open" && d.account === account);
  if (exists) return;
  ledger.directives.push({
    kind: "open",
    date: "1970-01-01",
    account,
    currencies: [currency],
  } as OpenDirective);
}

/** Import fingerprint: identifies a statement row regardless of category. */
function rowFingerprint(date: string, source: string, amountCents: number, description: string): string {
  const desc = (description || "").toLowerCase().replace(/\s+/g, " ").trim();
  return date + "|" + source + "|" + amountCents + "|" + desc;
}

/** Canonical key for a transaction's posting multiset (account+amount pairs). */
function postingSetKey(postings: { account: string; amount: number }[]): string {
  return postings
    .map((p) => p.account + "=" + p.amount)
    .sort()
    .join(";");
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 9999;
  return Math.abs(da - db) / 86400000;
}

/**
 * Commit categorized bank-feed rows for MULTIPLE source accounts in one batch.
 * Each row becomes one balanced transaction (source leg + category legs).
 *
 * Duplicate protection:
 *  - a row whose fingerprint (date|source|amount|description) already exists
 *    in the ledger is skipped as a duplicate (re-importing the same file);
 *  - a transfer row (category is another Assets/Liabilities account) whose
 *    posting set already exists within 3 days is skipped as the mirror side
 *    of a transfer that the other account's feed already recorded.
 */
export async function commitBankFeedMulti(
  id: string,
  rows: MultiFeedRow[]
): Promise<MultiFeedResult> {
  if (id === READONLY_SAMPLE_ID) return { ok: false, error: READONLY_MSG };
  if (!rows.length) return { ok: false, error: "No transactions to add." };

  const ledgerText = await getLedgerText(id);
  if (ledgerText == null) return { ok: false, error: "Entity not found" };

  const { ledger, errors: pre } = parse(ledgerText);
  if (pre.length)
    return { ok: false, error: "Ledger has issues; refusing to write: " + pre[0].message };

  const currency = ledger.options.operating_currency || "USD";

  // Index existing transactions for duplicate / transfer-mirror detection.
  const existingFps = new Set<string>();
  const existingPostingSets: { key: string; date: string }[] = [];
  for (const d of ledger.directives) {
    if (d.kind !== "transaction") continue;
    if (d.meta.fp) existingFps.add(d.meta.fp);
    existingPostingSets.push({ key: postingSetKey(d.postings), date: d.date });
  }

  let added = 0;
  let duplicates = 0;
  let transferMatches = 0;

  for (const r of rows) {
    const source = (r.sourceAccount || "").trim();
    const label = r.description || r.payee || r.date;
    if (!accountType(source))
      return { ok: false, error: "Row '" + label + "' has an invalid source account: " + source };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date))
      return { ok: false, error: "Row '" + label + "' has an invalid date." };
    if (!r.amountCents) return { ok: false, error: "Row '" + label + "' has a zero amount." };
    if (!r.splits.length) return { ok: false, error: "Row '" + label + "' has no category." };

    let splitSum = 0;
    for (const s of r.splits) {
      const category = (s.category || "").trim();
      if (!accountType(category))
        return {
          ok: false,
          error: "Row '" + label + "' has a split without a valid category root: " + category,
        };
      if (!s.amountCents)
        return { ok: false, error: "Row '" + label + "' has a split with a zero amount." };
      splitSum += s.amountCents;
    }
    if (splitSum !== r.amountCents)
      return {
        ok: false,
        error:
          "Row '" + label + "' splits (" + fromCents(splitSum) +
          ") do not add up to the amount (" + fromCents(r.amountCents) + ").",
      };

    // Duplicate: exact same statement row already imported.
    const fp = rowFingerprint(r.date, source, r.amountCents, r.description);
    if (existingFps.has(fp)) {
      duplicates++;
      continue;
    }

    const postings = [{ account: source, amount: r.amountCents, currency }];
    for (const s of r.splits) {
      postings.push({ account: s.category.trim(), amount: -s.amountCents, currency });
    }

    // Transfer mirror: same posting multiset already in the ledger nearby in
    // time (the other account's feed already recorded this transfer).
    const isTransfer = r.splits.some((s) => {
      const t = accountType(s.category.trim());
      return t === "Assets" || t === "Liabilities";
    });
    if (isTransfer) {
      const key = postingSetKey(postings);
      const mirrored = existingPostingSets.some(
        (e) => e.key === key && daysBetween(e.date, r.date) <= 3
      );
      if (mirrored) {
        transferMatches++;
        continue;
      }
    }

    ensureOpen(ledger, source, currency);
    for (const s of r.splits) ensureOpen(ledger, s.category.trim(), currency);

    const meta: Record<string, string> = { fp };
    if (r.ref && r.ref.trim()) meta.ref = r.ref.trim();

    ledger.directives.push({
      kind: "transaction",
      date: r.date,
      flag: "*",
      payee: r.payee || "",
      narration: r.description || "",
      meta,
      postings,
    } as Transaction);

    existingFps.add(fp);
    existingPostingSets.push({ key: postingSetKey(postings), date: r.date });
    added++;
  }

  if (!added)
    return {
      ok: true,
      added: 0,
      duplicates,
      transferMatches,
    };

  const next = serialize(ledger);
  const { errors: post } = parse(next);
  if (post.length) return { ok: false, error: "Validation failed: " + post[0].message };

  await saveLedgerText(id, next);
  return { ok: true, added, duplicates, transferMatches };
}

// ---- reclassify --------------------------------------------------------------

export interface PostingRowDTO {
  txId: string;
  postingIndex: number;
  date: string;
  payee: string;
  narration: string;
  ref: string;
  account: string; // this posting's account (the category to change)
  amountCents: number; // this posting's signed amount
  display: string;
  counterLabel: string; // the other side (bank account) or "— Split —"
}

/**
 * Flat list of postings for the Reclassify view. Filterable by the posting's
 * account (prefix match, so "Expenses" matches all expense accounts), date
 * range, and free-text search across payee/narration.
 */
export async function getPostingRows(
  id: string,
  filter: { account?: string; from?: string; to?: string; q?: string } = {}
): Promise<PostingRowDTO[]> {
  const text = await getLedgerText(id);
  if (text == null) return [];
  const { ledger } = parse(text);
  if (ensureIds(ledger)) {
    await saveLedgerText(id, serialize(ledger));
  }

  const q = (filter.q || "").toLowerCase();
  const acct = (filter.account || "").trim();

  const out: PostingRowDTO[] = [];
  for (const d of ledger.directives) {
    if (d.kind !== "transaction") continue;
    if (filter.from && d.date < filter.from) continue;
    if (filter.to && d.date > filter.to) continue;
    if (q) {
      const hay = (d.payee + " " + d.narration).toLowerCase();
      if (!hay.includes(q)) continue;
    }
    d.postings.forEach((p, i) => {
      if (acct && p.account !== acct && !p.account.startsWith(acct + ":")) return;
      const others = d.postings.filter((_, j) => j !== i);
      const counterLabel =
        others.length === 1 ? others[0].account : others.length === 0 ? "—" : "— Split —";
      out.push({
        txId: d.meta.id || "",
        postingIndex: i,
        date: d.date,
        payee: d.payee,
        narration: d.narration,
        ref: d.meta.ref || "",
        account: p.account,
        amountCents: p.amount,
        display: fromCents(p.amount),
        counterLabel,
      });
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.txId.localeCompare(b.txId));
  return out;
}

export interface ReclassifyChange {
  txId: string;
  postingIndex: number;
  toAccount: string;
}

/** Move specific postings to a different account (bulk reclassification). */
export async function reclassifyPostings(
  id: string,
  changes: ReclassifyChange[]
): Promise<WriteResult & { changed?: number }> {
  if (id === READONLY_SAMPLE_ID) return { ok: false, error: READONLY_MSG };
  if (!changes.length) return { ok: false, error: "Nothing selected." };

  const text = await getLedgerText(id);
  if (text == null) return { ok: false, error: "Entity not found" };
  const { ledger, errors: pre } = parse(text);
  if (pre.length)
    return { ok: false, error: "Ledger has issues; refusing to write: " + pre[0].message };
  ensureIds(ledger);

  const currency = ledger.options.operating_currency || "USD";
  const byId = new Map<string, Transaction>();
  for (const d of ledger.directives) {
    if (d.kind === "transaction" && d.meta.id) byId.set(d.meta.id, d);
  }

  let changed = 0;
  for (const c of changes) {
    const to = (c.toAccount || "").trim();
    if (!accountType(to))
      return { ok: false, error: "Invalid target account root: " + to };
    const tx = byId.get(c.txId);
    if (!tx) continue;
    const p = tx.postings[c.postingIndex];
    if (!p || p.account === to) continue;
    ensureOpen(ledger, to, currency);
    p.account = to;
    changed++;
  }
  if (!changed) return { ok: false, error: "No matching postings found to change." };

  const next = serialize(ledger);
  const { errors: post } = parse(next);
  if (post.length) return { ok: false, error: "Validation failed: " + post[0].message };

  await saveLedgerText(id, next);
  return { ok: true, changed };
}

// ---- reconcile ----------------------------------------------------------------

export interface ReconcileMonth {
  key: string; // YYYY-MM
  label: string;
  paymentsCents: number; // sum of negative legs
  paymentsCount: number;
  depositsCents: number; // sum of positive legs
  depositsCount: number;
  endingCents: number; // running ledger balance at month end
}

export interface ReconcileTxn {
  txId: string;
  date: string;
  payee: string;
  narration: string;
  ref: string;
  amountCents: number; // this account's leg
  counterLabel: string;
}

export interface ReconcileDTO {
  account: string;
  from: string;
  to: string;
  beginningLedgerCents: number; // ledger balance just before `from`
  paymentsCents: number;
  paymentsCount: number;
  depositsCents: number;
  depositsCount: number;
  endingLedgerCents: number; // beginning + in-range activity
  months: ReconcileMonth[];
  txns: ReconcileTxn[]; // in-range transactions touching the account
  settings: ReconcileSettings; // saved statement balances
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export async function getReconcileData(
  id: string,
  account: string,
  range: { from?: string; to?: string } = {}
): Promise<ReconcileDTO | null> {
  const text = await getLedgerText(id);
  if (text == null) return null;
  const { ledger } = parse(text);
  if (ensureIds(ledger)) {
    await saveLedgerText(id, serialize(ledger));
  }
  const aux = parseAux(await loadAux(id));

  const txns = ledger.directives.filter(
    (d): d is Transaction =>
      d.kind === "transaction" && d.postings.some((p) => p.account === account)
  );
  txns.sort((a, b) => a.date.localeCompare(b.date));

  const from = range.from || (txns.length ? txns[0].date : new Date().toISOString().slice(0, 10));
  const to = range.to || (txns.length ? txns[txns.length - 1].date : from);

  let beginning = 0;
  let payments = 0, paymentsCount = 0, deposits = 0, depositsCount = 0;
  const monthMap = new Map<string, ReconcileMonth>();
  const rows: ReconcileTxn[] = [];
  let running = 0;

  for (const t of txns) {
    const leg = t.postings
      .filter((p) => p.account === account)
      .reduce((s, p) => s + p.amount, 0);
    if (t.date < from) {
      beginning += leg;
      running += leg;
      continue;
    }
    if (t.date > to) continue;
    running += leg;
    const mk = t.date.slice(0, 7);
    let m = monthMap.get(mk);
    if (!m) {
      const [y, mm] = mk.split("-").map(Number);
      m = {
        key: mk,
        label: MONTH_NAMES[mm - 1] + " " + y,
        paymentsCents: 0,
        paymentsCount: 0,
        depositsCents: 0,
        depositsCount: 0,
        endingCents: 0,
      };
      monthMap.set(mk, m);
    }
    if (leg < 0) {
      payments += leg;
      paymentsCount++;
      m.paymentsCents += leg;
      m.paymentsCount++;
    } else if (leg > 0) {
      deposits += leg;
      depositsCount++;
      m.depositsCents += leg;
      m.depositsCount++;
    }
    m.endingCents = running;

    const others = t.postings.filter((p) => p.account !== account);
    rows.push({
      txId: t.meta.id || "",
      date: t.date,
      payee: t.payee,
      narration: t.narration,
      ref: t.meta.ref || "",
      amountCents: leg,
      counterLabel: others.length === 1 ? others[0].account : others.length === 0 ? "—" : "— Split —",
    });
  }

  return {
    account,
    from,
    to,
    beginningLedgerCents: beginning,
    paymentsCents: payments,
    paymentsCount,
    depositsCents: deposits,
    depositsCount,
    endingLedgerCents: beginning + payments + deposits,
    months: [...monthMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    txns: rows.reverse(),
    settings: aux.reconcile[account] || {},
  };
}

// ---- export data (QuickBooks Desktop) ------------------------------------------

export interface ExportTxnDTO {
  date: string;
  payee: string;
  narration: string;
  ref: string;
  postings: { account: string; amountCents: number }[];
}

export interface ExportDataDTO {
  accounts: { account: string; type: string }[]; // full chart with root type
  coaDesc: Record<string, string>;
  txns: ExportTxnDTO[];
}

/** Everything the client needs to build IIF / QBO / Excel exports locally. */
export async function getExportData(
  id: string,
  range: { from?: string; to?: string } = {}
): Promise<ExportDataDTO | null> {
  const text = await getLedgerText(id);
  if (text == null) return null;
  const { ledger } = parse(text);
  const aux = parseAux(await loadAux(id));

  const accounts = ledger.directives
    .filter((d): d is OpenDirective => d.kind === "open")
    .map((d) => ({ account: d.account, type: accountType(d.account) || "" }))
    .sort((a, b) => a.account.localeCompare(b.account));

  const txns: ExportTxnDTO[] = [];
  for (const d of ledger.directives) {
    if (d.kind !== "transaction") continue;
    if (range.from && d.date < range.from) continue;
    if (range.to && d.date > range.to) continue;
    txns.push({
      date: d.date,
      payee: d.payee,
      narration: d.narration,
      ref: d.meta.ref || "",
      postings: d.postings.map((p) => ({ account: p.account, amountCents: p.amount })),
    });
  }
  txns.sort((a, b) => a.date.localeCompare(b.date));

  return { accounts, coaDesc: aux.coaDesc, txns };
}

// ---- chart of accounts: extract from postings -----------------------------------

/**
 * Open any account referenced by a posting but not yet declared with an
 * `open` directive (e.g. after hand-editing the ledger text). Normal app
 * writes auto-open accounts, so this is mostly a repair/import helper.
 */
export async function extractAccountsFromTransactions(
  id: string
): Promise<WriteResult & { added?: number }> {
  if (id === READONLY_SAMPLE_ID) return { ok: false, error: READONLY_MSG };
  const text = await getLedgerText(id);
  if (text == null) return { ok: false, error: "Entity not found" };
  const { ledger, errors: pre } = parse(text);
  if (pre.length)
    return { ok: false, error: "Ledger has issues; refusing to write: " + pre[0].message };

  const currency = ledger.options.operating_currency || "USD";
  const opened = new Set(
    ledger.directives.filter((d) => d.kind === "open").map((d) => (d as OpenDirective).account)
  );
  let added = 0;
  for (const d of ledger.directives) {
    if (d.kind !== "transaction") continue;
    for (const p of d.postings) {
      if (opened.has(p.account)) continue;
      ensureOpen(ledger, p.account, currency);
      opened.add(p.account);
      added++;
    }
  }
  if (!added) return { ok: true, added: 0 };

  const next = serialize(ledger);
  const { errors: post } = parse(next);
  if (post.length) return { ok: false, error: "Validation failed: " + post[0].message };
  await saveLedgerText(id, next);
  return { ok: true, added };
}
