// Pure helpers for normalizing spreadsheet cells (dates, amounts, account and
// category names) when importing bank transactions. Client-safe.

import { toCents } from "@/lib/beancount/types";

/** Normalize a spreadsheet date cell (Date, Excel serial, or string) to ISO. */
export function normalizeDateCell(value: unknown): string {
  if (value == null || value === "") return "";
  if (value instanceof Date && !isNaN(value.getTime())) {
    // SheetJS with cellDates gives Dates already in local time.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date (days since 1899-12-30).
    if (value > 20000 && value < 80000) {
      const ms = Math.round((value - 25569) * 86400 * 1000);
      const dt = new Date(ms);
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const d = String(dt.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return "";
  }
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // M/D/YYYY or M-D-YYYY
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? "20" + m[3] : m[3];
    return year + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
  }
  // "Jan 5, 2026" style — let Date try.
  const t = Date.parse(raw);
  if (Number.isFinite(t)) {
    const dt = new Date(t);
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return "";
}

/** Parse an amount cell (number or formatted string) to signed cents. */
export function parseAmountCell(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Math.round(value * 100);
  return toCents(String(value));
}

/**
 * Turn a friendly name into a valid Beancount segment: words capitalized and
 * joined, hyphens kept, and a letter forced at the front (segments must match
 * /^[A-Z][A-Za-z0-9-]*$/).
 */
export function toSegment(raw: string): string {
  const cleaned = String(raw || "")
    .replace(/&/g, " And ")
    .replace(/[^A-Za-z0-9\- ]+/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  let seg = words
    .map((w) => (/[a-z]/.test(w.charAt(0)) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join("")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!seg) return "";
  if (!/^[A-Za-z]/.test(seg)) seg = "X" + seg; // e.g. "5-200 Advertising" -> "X5-200Advertising"
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

const ROOTS = ["Assets", "Liabilities", "Equity", "Income", "COGS", "Expenses"];

const ROOT_ALIASES: Record<string, string> = {
  asset: "Assets", assets: "Assets", bank: "Assets", "fixed asset": "Assets",
  "other asset": "Assets", "other current asset": "Assets",
  liability: "Liabilities", liabilities: "Liabilities", "credit card": "Liabilities",
  "credit card account": "Liabilities", "other current liability": "Liabilities",
  "long term liability": "Liabilities", loan: "Liabilities",
  equity: "Equity", "capital \\ equity": "Equity", capital: "Equity",
  income: "Income", revenue: "Income", sales: "Income", "other income": "Income",
  cogs: "COGS", "cost of goods sold": "COGS",
  expense: "Expenses", expenses: "Expenses", "other expense": "Expenses",
};

/** Map a friendly account-type label to a Beancount root ("" if unknown). */
export function rootForType(typeLabel: string): string {
  const t = String(typeLabel || "").trim().toLowerCase();
  if (!t) return "";
  if (ROOT_ALIASES[t]) return ROOT_ALIASES[t];
  for (const [k, v] of Object.entries(ROOT_ALIASES)) {
    if (t.includes(k)) return v;
  }
  return "";
}

/** Guess a root from an account/category NAME when no type is given. */
export function guessRootFromName(name: string, amountCents?: number): string {
  const lower = String(name || "").toLowerCase();
  if (/(income|revenue|sales|refund)/.test(lower)) return "Income";
  if (/(cogs|cost of goods)/.test(lower)) return "COGS";
  if (/(loan|payable|credit card|liab)/.test(lower)) return "Liabilities";
  if (/(equity|owner|capital|draw|distribution|contribution)/.test(lower)) return "Equity";
  if (/(checking|savings|bank|cash|receivable|asset)/.test(lower)) return "Assets";
  if (typeof amountCents === "number" && amountCents > 0) return "Income";
  return "Expenses";
}

/**
 * Normalize a friendly category/account label to a full Beancount account.
 * If the label already starts with a root (or alias), that root is used;
 * otherwise `fallbackRoot` (or a guess) is applied. Multi-level labels with
 * ":" are preserved as sub-accounts.
 */
export function normalizeAccountName(
  label: string,
  fallbackRoot?: string,
  amountCents?: number
): string {
  const raw = String(label || "").trim();
  if (!raw) return "";
  const segsRaw = raw.split(":").map((s) => s.trim()).filter(Boolean);
  if (!segsRaw.length) return "";
  const firstLower = segsRaw[0].toLowerCase();
  let root = "";
  let body = segsRaw;
  if (ROOTS.some((r) => r.toLowerCase() === firstLower)) {
    root = ROOTS.find((r) => r.toLowerCase() === firstLower)!;
    body = segsRaw.slice(1);
  } else if (ROOT_ALIASES[firstLower]) {
    root = ROOT_ALIASES[firstLower];
    body = segsRaw.slice(1);
  } else {
    root = fallbackRoot || guessRootFromName(raw, amountCents);
  }
  const segs = body.map(toSegment).filter(Boolean);
  if (!segs.length) return root;
  return [root, ...segs].join(":");
}

/**
 * Best-effort match of a category label from a file against the existing
 * chart of accounts: exact (case-insensitive), without root, or by last
 * segment. Returns "" when nothing matches.
 */
export function matchExistingAccount(label: string, accounts: string[]): string {
  const norm = String(label || "").trim().toLowerCase();
  if (!norm) return "";
  const collapsed = norm.replace(/[^a-z0-9]+/g, "");
  for (const a of accounts) {
    if (a.toLowerCase() === norm) return a;
  }
  for (const a of accounts) {
    const noRoot = a.split(":").slice(1).join(":").toLowerCase();
    if (noRoot && (noRoot === norm || noRoot.replace(/[^a-z0-9]+/g, "") === collapsed)) return a;
  }
  for (const a of accounts) {
    const last = a.split(":").pop()!.toLowerCase();
    if (last === collapsed || last.replace(/[^a-z0-9]+/g, "") === collapsed) return a;
  }
  return "";
}
