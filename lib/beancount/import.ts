// Parse pasted spreadsheet data (tab-separated Excel copy or CSV) into
// structured transaction rows. Pure and testable; ported and hardened from
// the classic single-file app.

import { toCents } from "./types";

export interface ImportRow {
  date: string; // normalized ISO
  payee: string;
  narration: string;
  amountCents: number;
  account: string; // debit (receives +amount)
  offset: string; // credit (receives -amount)
}

export interface ImportDefaults {
  account: string; // default debit account
  offset: string; // default offset/category account
}

/** Split a single CSV line, honoring quoted fields. */
function csvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/** Normalize common date formats to ISO YYYY-MM-DD; "" if unparseable. */
export function normalizeDate(value: string): string {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  const year = m[3].length === 2 ? "20" + m[3] : m[3];
  return year + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
}

const HEADER_KEYS = [
  "date",
  "amount",
  "payee",
  "description",
  "account",
  "offset",
  "memo",
  "vendor",
  "customer",
  "name",
  "debit",
  "credit",
  "category",
  "counteraccount",
];

/**
 * Parse pasted text into rows. Detects a header line; if absent, reads columns
 * positionally as Date, Payee, Description, Amount, Account, Offset. Rows
 * without a usable date or with a zero amount are dropped.
 */
export function parsePaste(text: string, defaults: ImportDefaults): ImportRow[] {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => (line.includes("\t") ? line.split("\t").map((c) => c.trim()) : csvLine(line)));
  if (!rows.length) return [];

  const headers = rows[0].map((c) => c.trim().toLowerCase());
  const hasHeader = headers.some((h) => HEADER_KEYS.includes(h));
  const body = hasHeader ? rows.slice(1) : rows;

  const idx = (names: string[], fallback: number): number => {
    const found = headers.findIndex((h) => names.includes(h));
    return found >= 0 ? found : fallback;
  };

  const out: ImportRow[] = [];
  for (const cells of body) {
    const date = normalizeDate(cells[idx(["date"], 0)] || "");
    const amountCents = toCents(cells[idx(["amount", "debit", "credit"], 3)] || "");
    if (!date || amountCents === 0) continue;
    const payee = cells[idx(["payee", "vendor", "customer", "name"], 1)] || "";
    const narration =
      cells[idx(["description", "memo", "narration"], 2)] || payee || "";
    const account = (cells[idx(["account"], 4)] || defaults.account).trim();
    const offset =
      (cells[idx(["offset", "category", "counteraccount"], 5)] || defaults.offset).trim();
    out.push({ date, payee, narration, amountCents, account, offset });
  }
  return out;
}

// ---- Bank feed parsing ----------------------------------------------------
// A bank/credit-card CSV export: one signed Amount column (negative = money
// out), a Description, and an optional reference/check number. The offset
// category is chosen per row in the UI, not read from the file, so this parser
// only extracts the raw statement fields.

export interface BankParsedRow {
  date: string; // normalized ISO
  payee: string; // payee / vendor / customer; "" if the file has no such column
  description: string;
  amountCents: number; // signed; negative = money out of the source account
  ref: string; // reference / check number; "" if none
}

const BANK_HEADER_KEYS = [
  "date",
  "description",
  "memo",
  "narration",
  "payee",
  "vendor",
  "customer",
  "name",
  "amount",
  "ref",
  "reference",
  "check",
  "checknumber",
  "check#",
  "docnumber",
  "number",
];

/**
 * Parse a pasted/uploaded bank statement into raw rows. Detects a header line;
 * if absent, reads columns positionally as Date, Description, Amount, Ref.
 * Payee is only read when the file has a dedicated payee/vendor column — most
 * bank exports have just a Description, so payee is usually left blank for the
 * user to fill in. Rows without a usable date or a zero amount are dropped.
 */
export function parseBankRows(text: string): BankParsedRow[] {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => (line.includes("\t") ? line.split("\t").map((c) => c.trim()) : csvLine(line)));
  if (!rows.length) return [];

  const headers = rows[0].map((c) => c.trim().toLowerCase().replace(/\s+/g, ""));
  const hasHeader = headers.some((h) => BANK_HEADER_KEYS.includes(h));
  const body = hasHeader ? rows.slice(1) : rows;

  const idx = (names: string[], fallback: number): number => {
    const found = headers.findIndex((h) => names.includes(h));
    return found >= 0 ? found : fallback;
  };

  const out: BankParsedRow[] = [];
  for (const cells of body) {
    const date = normalizeDate(cells[idx(["date"], 0)] || "");
    const amountCents = toCents(cells[idx(["amount"], 2)] || "");
    if (!date || amountCents === 0) continue;
    const payee = (cells[idx(["payee", "vendor", "customer", "name"], -1)] || "").trim();
    const description =
      (cells[idx(["description", "memo", "narration"], 1)] || "").trim();
    const ref =
      (cells[idx(["ref", "reference", "check", "checknumber", "check#", "docnumber", "number"], 3)] || "").trim();
    out.push({ date, payee, description, amountCents, ref });
  }
  return out;
}
