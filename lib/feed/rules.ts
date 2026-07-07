// Classification rules engine for the bank feed — QuickBooks Online style.
//
// A rule matches a statement row on text (keyword list or regex), direction
// (money in / money out), amount conditions, and optionally only for specific
// source bank accounts. The first enabled rule that matches (in priority
// order) assigns the category (a ledger account) and optionally a payee.
//
// Pure module: no store or React imports, so it is unit-testable and can run
// on either side of the server boundary.

export type RuleDirection = "any" | "in" | "out";
export type RuleAmountOp = "" | "eq" | "lt" | "gt" | "le" | "ge" | "between";
export type RuleTextMode = "contains" | "not-contains" | "starts" | "regex" | "exact";

export interface Rule {
  id: string;
  /** Keywords (comma-separated alternatives) or a regex, per textMode. */
  match: string;
  textMode: RuleTextMode;
  direction: RuleDirection;
  /** Amount condition applies to the absolute value, in dollars. */
  amountOp: RuleAmountOp;
  amountA?: number;
  amountB?: number; // upper bound for "between"
  /** Restrict to these ledger source accounts; empty = all accounts. */
  accounts: string[];
  /** Ledger account to assign, e.g. "Expenses:Advertising". */
  category: string;
  /** Optional payee to set when the rule matches. */
  payee?: string;
  enabled: boolean;
}

export interface RuleInput {
  description: string;
  payee?: string;
  amountCents: number; // signed; negative = money out
  sourceAccount?: string;
}

export interface RuleResult {
  category: string;
  payee?: string;
  ruleId: string;
}

/** Test one rule's text condition against the row's searchable text. */
function textMatches(rule: Rule, haystack: string): boolean {
  const pattern = (rule.match || "").trim();
  if (!pattern) return false;
  const hay = haystack.toLowerCase();

  if (rule.textMode === "regex") {
    try {
      return new RegExp(pattern, "i").test(haystack);
    } catch {
      return false;
    }
  }

  // Comma-separated alternatives: any one matching counts as a hit.
  const alts = pattern
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!alts.length) return false;

  switch (rule.textMode) {
    case "not-contains":
      return alts.every((a) => !hay.includes(a));
    case "starts":
      return alts.some((a) => hay.startsWith(a));
    case "exact":
      return alts.some((a) => hay === a);
    case "contains":
    default:
      return alts.some((a) => hay.includes(a));
  }
}

function amountMatches(rule: Rule, amountCents: number): boolean {
  if (!rule.amountOp) return true;
  const abs = Math.abs(amountCents) / 100;
  const a = Number(rule.amountA);
  if (!Number.isFinite(a)) return true;
  switch (rule.amountOp) {
    case "eq":
      return Math.abs(abs - a) < 0.005;
    case "lt":
      return abs < a;
    case "gt":
      return abs > a;
    case "le":
      return abs <= a;
    case "ge":
      return abs >= a;
    case "between": {
      const b = Number(rule.amountB);
      if (!Number.isFinite(b)) return abs >= a;
      return abs >= Math.min(a, b) && abs <= Math.max(a, b);
    }
    default:
      return true;
  }
}

/** Apply rules in order; the first full match wins. Returns null when nothing matches. */
export function applyRules(rules: Rule[], input: RuleInput): RuleResult | null {
  const hay = [input.description || "", input.payee || ""].filter(Boolean).join(" ");
  for (const rule of rules) {
    if (!rule.enabled || !rule.category) continue;
    if (rule.accounts && rule.accounts.length && input.sourceAccount) {
      if (!rule.accounts.includes(input.sourceAccount)) continue;
    }
    if (rule.direction === "in" && input.amountCents <= 0) continue;
    if (rule.direction === "out" && input.amountCents >= 0) continue;
    if (!amountMatches(rule, input.amountCents)) continue;
    if (!textMatches(rule, hay)) continue;
    return { category: rule.category, payee: rule.payee || undefined, ruleId: rule.id };
  }
  return null;
}

let seq = 0;
export function newRuleId(): string {
  seq += 1;
  return "r" + Date.now().toString(36) + seq.toString(36);
}

export function blankRule(): Rule {
  return {
    id: newRuleId(),
    match: "",
    textMode: "contains",
    direction: "any",
    amountOp: "",
    accounts: [],
    category: "",
    payee: "",
    enabled: true,
  };
}

/**
 * Parse rules from a loaded file. Accepts:
 *  - JSON: an array of Rule-like objects (this app's export, or the classic
 *    categorizer's {payee|match|pattern, category, direction} shape)
 *  - CSV/TXT: "keyword,category[,direction]" per line
 */
export function parseRulesFile(text: string): Rule[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const out: Rule[] = [];

  const normDirection = (d: unknown): RuleDirection => {
    const s = String(d || "").toLowerCase();
    if (s.includes("in") && !s.includes("out")) return "in";
    if (s.includes("out")) return "out";
    return "any";
  };

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      const arr = Array.isArray(data) ? data : Array.isArray(data.rules) ? data.rules : [];
      for (const r of arr) {
        if (!r || typeof r !== "object") continue;
        const match = String(r.match ?? r.payee ?? r.pattern ?? "").trim();
        const category = String(r.category ?? r.Category ?? r.cat ?? "").trim();
        if (!match || !category) continue;
        out.push({
          id: newRuleId(),
          match,
          textMode: (["contains", "not-contains", "starts", "regex", "exact"] as const).includes(r.textMode)
            ? r.textMode
            : "contains",
          direction: normDirection(r.direction ?? r.type),
          amountOp: (["", "eq", "lt", "gt", "le", "ge", "between"] as const).includes(r.amountOp) ? r.amountOp : "",
          amountA: Number.isFinite(Number(r.amountA)) ? Number(r.amountA) : undefined,
          amountB: Number.isFinite(Number(r.amountB)) ? Number(r.amountB) : undefined,
          accounts: Array.isArray(r.accounts) ? r.accounts.map(String) : [],
          category,
          payee: r.payee && r.match ? String(r.payee) : undefined,
          enabled: r.enabled !== false,
        });
      }
      return out;
    } catch {
      /* fall through to CSV */
    }
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length < 2) continue;
    const [match, category, direction] = cells;
    if (!match || !category) continue;
    if (/^(keyword|pattern|match)$/i.test(match)) continue; // header row
    out.push({
      id: newRuleId(),
      match,
      textMode: "contains",
      direction: normDirection(direction),
      amountOp: "",
      accounts: [],
      category,
      enabled: true,
    });
  }
  return out;
}
