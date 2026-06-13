// Beancount text -> typed Ledger model.
//
// This is a pragmatic parser for the subset of Beancount BeanBooks emits and
// consumes: options, `open`, transactions with postings + metadata, and
// `balance` assertions. It is line-oriented and tolerant: unrecognized lines
// are skipped and recorded as errors rather than throwing.

import {
  BalanceDirective,
  Directive,
  Ledger,
  LedgerError,
  OpenDirective,
  ParseResult,
  Posting,
  Transaction,
  toCents,
} from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Strip a trailing `;` comment that is not inside a quoted string. */
function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ";" && !inQuote) return line.slice(0, i);
  }
  return line;
}

/** Pull all "double quoted" strings out of a line, in order. */
function quotedStrings(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1].replace(/\\"/g, '"'));
  return out;
}

function indent(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

export function parse(text: string): ParseResult {
  const options: Record<string, string> = {};
  const directives: Directive[] = [];
  const errors: LedgerError[] = [];

  const rawLines = text.split(/\r?\n/);
  let current: Transaction | null = null;

  const flush = () => {
    if (current) {
      directives.push(current);
      current = null;
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const noComment = stripComment(rawLines[i]);
    if (!noComment.trim()) {
      // blank line ends a transaction block
      flush();
      continue;
    }

    const isIndented = indent(rawLines[i]) > 0;

    // ---- continuation lines of the current transaction -------------------
    if (isIndented && current) {
      const body = noComment.trim();

      // metadata: key: "value"  (or key: value)
      const metaMatch = body.match(/^([a-zA-Z][\w-]*):\s+(.*)$/);
      if (metaMatch && !DATE.test(body)) {
        const key = metaMatch[1];
        const valStrings = quotedStrings(metaMatch[2]);
        current.meta[key] =
          valStrings.length > 0 ? valStrings[0] : metaMatch[2].trim();
        continue;
      }

      // posting:  Account[:Sub...]   AMOUNT CUR
      const posting = parsePosting(body);
      if (posting) {
        current.postings.push(posting);
        continue;
      }

      errors.push({ line: lineNo, message: "Unrecognized transaction line: " + body });
      continue;
    }

    // a new top-level directive starts; close any open transaction
    flush();
    const line = noComment.trim();

    // ---- option "key" "value" -------------------------------------------
    if (line.startsWith("option")) {
      const parts = quotedStrings(line);
      if (parts.length >= 2) options[parts[0]] = parts[1];
      else errors.push({ line: lineNo, message: "Malformed option directive" });
      continue;
    }

    // ---- dated directives -----------------------------------------------
    const tokens = line.split(/\s+/);
    const date = tokens[0];
    if (!DATE.test(date)) {
      errors.push({ line: lineNo, message: "Unrecognized directive: " + line });
      continue;
    }
    const keyword = tokens[1];

    if (keyword === "open") {
      const open: OpenDirective = {
        kind: "open",
        date,
        account: tokens[2],
        currencies: tokens.slice(3).filter(Boolean),
      };
      if (!open.account) errors.push({ line: lineNo, message: "open missing account" });
      else directives.push(open);
      continue;
    }

    if (keyword === "balance") {
      const account = tokens[2];
      const amount = tokens[3];
      const currency = tokens[4] || options.operating_currency || "USD";
      if (!account || amount === undefined) {
        errors.push({ line: lineNo, message: "Malformed balance assertion" });
        continue;
      }
      const bal: BalanceDirective = {
        kind: "balance",
        date,
        account,
        amount: toCents(amount),
        currency,
      };
      directives.push(bal);
      continue;
    }

    // ---- transaction header:  DATE FLAG "payee" "narration" -------------
    if (keyword === "*" || keyword === "!" || keyword === "txn") {
      const strings = quotedStrings(line);
      // one string => narration only; two => payee + narration
      const payee = strings.length >= 2 ? strings[0] : "";
      const narration = strings.length >= 2 ? strings[1] : strings[0] || "";
      current = {
        kind: "transaction",
        date,
        flag: keyword === "txn" ? "*" : keyword,
        payee,
        narration,
        meta: {},
        postings: [],
      };
      continue;
    }

    errors.push({ line: lineNo, message: "Unknown directive keyword: " + keyword });
  }

  flush();

  const ledger: Ledger = { options, directives };
  validate(ledger, errors);
  return { ledger, errors };
}

/** Parse a single posting body: "Account   -1250.00 USD". */
function parsePosting(body: string): Posting | null {
  // account is the first whitespace-delimited token; the rest is amount+cur
  const m = body.match(/^([A-Za-z][\w:-]*)\s+(.*)$/);
  if (!m) return null;
  const account = m[1];
  if (!/^[A-Z]/.test(account)) return null; // account roots are capitalized
  const rest = m[2].trim();
  if (!rest) return null;
  const parts = rest.split(/\s+/);
  // last token may be a currency code (all letters); preceding is the number
  let currency = "USD";
  let amountStr = rest;
  if (parts.length >= 2 && /^[A-Z][A-Z0-9'._-]*$/.test(parts[parts.length - 1])) {
    currency = parts[parts.length - 1];
    amountStr = parts.slice(0, -1).join("");
  }
  if (!/[0-9]/.test(amountStr)) return null;
  return { account, amount: toCents(amountStr), currency };
}

/** Validate structural invariants; append problems to `errors`. */
export function validate(ledger: Ledger, errors: LedgerError[]): void {
  const open = new Set<string>();
  for (const d of ledger.directives) {
    if (d.kind === "open") open.add(d.account);
  }
  for (const d of ledger.directives) {
    if (d.kind !== "transaction") continue;
    // postings must balance to zero (per currency)
    const byCur: Record<string, number> = {};
    for (const p of d.postings) {
      byCur[p.currency] = (byCur[p.currency] || 0) + p.amount;
    }
    for (const [cur, sum] of Object.entries(byCur)) {
      if (sum !== 0) {
        errors.push({
          line: 0,
          message:
            "Transaction on " +
            d.date +
            ' "' +
            d.narration +
            '" does not balance in ' +
            cur +
            " (off by " +
            sum +
            " cents)",
        });
      }
    }
    if (d.postings.length < 2) {
      errors.push({
        line: 0,
        message: "Transaction on " + d.date + " has fewer than 2 postings",
      });
    }
  }
}
