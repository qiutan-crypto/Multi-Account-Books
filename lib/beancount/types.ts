// Core domain types for the PlainGL Beancount engine.
//
// MONEY: all amounts are stored as integer minor units ("cents") to avoid
// floating-point drift. A value of 125000 means 1,250.00 in a 2-decimal
// currency. Formatting back to a decimal string happens only at the edge.

export type AccountType =
  | "Assets"
  | "Liabilities"
  | "Equity"
  | "Income"
  | "COGS"
  | "Expenses";

export const ACCOUNT_ROOTS: AccountType[] = [
  "Assets",
  "Liabilities",
  "Equity",
  "Income",
  "COGS", // Cost of Goods Sold — its own P&L grouping, above Expenses
  "Expenses",
];

/** A single leg of a transaction. Amount is in integer minor units. */
export interface Posting {
  account: string;
  amount: number; // integer cents; sum across a transaction must be 0
  currency: string;
}

/** A Beancount transaction directive. */
export interface Transaction {
  kind: "transaction";
  date: string; // ISO YYYY-MM-DD
  flag: string; // usually "*" (cleared) or "!" (pending)
  payee: string;
  narration: string;
  /** Arbitrary key/value metadata, e.g. id, due, customer, applies_to. */
  meta: Record<string, string>;
  postings: Posting[];
}

/** An `open` directive declaring an account. */
export interface OpenDirective {
  kind: "open";
  date: string;
  account: string;
  currencies: string[]; // may be empty
}

/** A `balance` assertion — the native reconciliation primitive. */
export interface BalanceDirective {
  kind: "balance";
  date: string;
  account: string;
  amount: number; // integer cents
  currency: string;
}

export type Directive = OpenDirective | Transaction | BalanceDirective;

/** A fully parsed ledger. */
export interface Ledger {
  options: Record<string, string>; // e.g. { title, operating_currency }
  directives: Directive[];
}

/** A non-fatal problem found while parsing or validating. */
export interface LedgerError {
  line: number;
  message: string;
}

export interface ParseResult {
  ledger: Ledger;
  errors: LedgerError[];
}

/** Default currency assumed when a ledger sets no operating_currency. */
export const DEFAULT_CURRENCY = "USD";

// ---- money helpers -------------------------------------------------------

/** Parse a decimal-string amount (e.g. "-1,250.00", "(72.50)") into cents. */
export function toCents(raw: string | number): number {
  if (typeof raw === "number") return Math.round(raw * 100);
  const s = String(raw).trim();
  const negative = /^\(.*\)$/.test(s); // accounting-style parens = negative
  const cleaned = s.replace(/[$,()\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

/** Format integer cents into a fixed 2-decimal string (no currency symbol). */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return sign + dollars.toString() + "." + rem.toString().padStart(2, "0");
}

/** The root type of an account name ("Assets:Bank:Checking" -> "Assets"). */
export function accountType(account: string): AccountType | null {
  const root = (account || "").split(":")[0];
  return (ACCOUNT_ROOTS as string[]).includes(root)
    ? (root as AccountType)
    : null;
}
