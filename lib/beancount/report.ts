// Report engine: compute financial statements from a parsed Ledger.
//
// All arithmetic is in integer cents. Sign conventions follow Beancount:
// postings store natural signs (Assets/Expenses positive on increase,
// Income/Liabilities/Equity negative on increase). Display helpers flip
// signs so statements read conventionally.

import {
  AccountType,
  Directive,
  Ledger,
  Transaction,
  accountType,
} from "./types";

export interface DateRange {
  from?: string; // inclusive ISO date
  to?: string; // inclusive ISO date
}

export interface AccountBalance {
  account: string;
  type: AccountType | null;
  cents: number; // natural sign
}

function inRange(date: string, range: DateRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

function transactions(ledger: Ledger): Transaction[] {
  return ledger.directives.filter(
    (d): d is Transaction => d.kind === "transaction"
  );
}

/** Per-account balance (natural sign, integer cents) within a date range. */
export function balances(ledger: Ledger, range: DateRange = {}): Map<string, number> {
  const result = new Map<string, number>();
  // seed declared accounts at 0 so they appear even with no activity
  for (const d of ledger.directives) {
    if (d.kind === "open") result.set(d.account, 0);
  }
  for (const tx of transactions(ledger)) {
    if (!inRange(tx.date, range)) continue;
    for (const p of tx.postings) {
      result.set(p.account, (result.get(p.account) || 0) + p.amount);
    }
  }
  return result;
}

/** Sum of balances for one account root, natural sign. */
export function totalForRoot(
  bals: Map<string, number>,
  root: AccountType
): number {
  let sum = 0;
  for (const [account, cents] of bals) {
    if (accountType(account) === root) sum += cents;
  }
  return sum;
}

export interface Totals {
  assets: number; // display sign (positive = asset)
  liabilities: number; // display sign (positive = liability)
  equity: number; // display sign (positive = equity)
  revenue: number; // display sign (positive = income)
  expenses: number; // display sign (positive = expense)
  netIncome: number; // revenue - expenses
}

export function totals(ledger: Ledger, range: DateRange = {}): Totals {
  const b = balances(ledger, range);
  const assets = totalForRoot(b, "Assets");
  const liabilities = -totalForRoot(b, "Liabilities");
  const equity = -totalForRoot(b, "Equity");
  const revenue = -totalForRoot(b, "Income");
  const expenses = totalForRoot(b, "Expenses");
  return {
    assets,
    liabilities,
    equity,
    revenue,
    expenses,
    netIncome: revenue - expenses,
  };
}

export interface ReportLine {
  account: string;
  cents: number; // display sign
}

/** Income statement lines + net income, for a period. */
export function incomeStatement(ledger: Ledger, range: DateRange = {}) {
  const b = balances(ledger, range);
  const income: ReportLine[] = [];
  const expenses: ReportLine[] = [];
  for (const [account, cents] of b) {
    const t = accountType(account);
    if (t === "Income" && cents !== 0) income.push({ account, cents: -cents });
    else if (t === "Expenses" && cents !== 0) expenses.push({ account, cents });
  }
  income.sort((a, z) => a.account.localeCompare(z.account));
  expenses.sort((a, z) => a.account.localeCompare(z.account));
  const t = totals(ledger, range);
  return { income, expenses, netIncome: t.netIncome };
}

/**
 * Balance sheet as of `asOf`. Critically, net income (cumulative through
 * asOf) is closed into equity as "Current earnings" so the statement
 * balances: Assets = Liabilities + Equity + Current earnings.
 */
export function balanceSheet(ledger: Ledger, asOf?: string) {
  const range: DateRange = { to: asOf };
  const b = balances(ledger, range);
  const assets: ReportLine[] = [];
  const liabilities: ReportLine[] = [];
  const equity: ReportLine[] = [];
  for (const [account, cents] of b) {
    const t = accountType(account);
    if (cents === 0) continue;
    if (t === "Assets") assets.push({ account, cents });
    else if (t === "Liabilities") liabilities.push({ account, cents: -cents });
    else if (t === "Equity") equity.push({ account, cents: -cents });
  }
  for (const arr of [assets, liabilities, equity]) {
    arr.sort((a, z) => a.account.localeCompare(z.account));
  }
  const tot = totals(ledger, range);
  const currentEarnings = tot.netIncome;
  const totalAssets = tot.assets;
  const totalLiabEquity = tot.liabilities + tot.equity + currentEarnings;
  return {
    assets,
    liabilities,
    equity,
    currentEarnings,
    totalAssets,
    totalLiabEquity,
    balances: totalAssets === totalLiabEquity,
  };
}

// ---- aging ---------------------------------------------------------------

export interface AgingBucket {
  label: string;
  cents: number;
}

export interface AgingRow {
  party: string; // customer or vendor (from payee/meta)
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

/**
 * A/R or A/P aging. We approximate per-document open balances by netting all
 * postings to the control account (e.g. Assets:AccountsReceivable), grouped by
 * the counterparty (payee). A positive net for A/R = owed to us; for A/P the
 * control account is a liability so we flip the sign.
 *
 * Buckets are computed against `asOf` using each contributing transaction's
 * date (or its `due` metadata when present).
 */
export function aging(
  ledger: Ledger,
  controlAccount: string,
  asOf: string,
  opts: { flip?: boolean } = {}
): { rows: AgingRow[]; total: AgingRow } {
  const flip = opts.flip ? -1 : 1;
  const byParty = new Map<string, AgingRow>();

  const asOfTime = Date.parse(asOf);
  const dayMs = 86400000;

  for (const d of ledger.directives) {
    if (d.kind !== "transaction") continue;
    if (d.date > asOf) continue;
    const leg = d.postings.find((p) => p.account === controlAccount);
    if (!leg || leg.amount === 0) continue;
    const party = d.meta.customer || d.meta.vendor || d.payee || "(unknown)";
    const refDate = d.meta.due || d.date;
    const ageDays = Math.floor((asOfTime - Date.parse(refDate)) / dayMs);
    const cents = leg.amount * flip;

    let row = byParty.get(party);
    if (!row) {
      row = {
        party,
        current: 0,
        d1_30: 0,
        d31_60: 0,
        d61_90: 0,
        d90_plus: 0,
        total: 0,
      };
      byParty.set(party, row);
    }
    if (ageDays <= 0) row.current += cents;
    else if (ageDays <= 30) row.d1_30 += cents;
    else if (ageDays <= 60) row.d31_60 += cents;
    else if (ageDays <= 90) row.d61_90 += cents;
    else row.d90_plus += cents;
    row.total += cents;
  }

  const rows = [...byParty.values()]
    .filter((r) => r.total !== 0)
    .sort((a, z) => a.party.localeCompare(z.party));

  const total: AgingRow = {
    party: "Total",
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    total: 0,
  };
  for (const r of rows) {
    total.current += r.current;
    total.d1_30 += r.d1_30;
    total.d31_60 += r.d31_60;
    total.d61_90 += r.d61_90;
    total.d90_plus += r.d90_plus;
    total.total += r.total;
  }
  return { rows, total };
}
