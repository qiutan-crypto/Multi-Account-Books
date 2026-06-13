// Ledger model -> Beancount text. Round-trips with parse().

import { Ledger, Directive, Transaction, fromCents } from "./types";

const ACCOUNT_COL = 34; // pad account names to align amounts

function serializeMeta(meta: Record<string, string>): string[] {
  return Object.entries(meta).map(
    ([k, v]) => "  " + k + ': "' + v.replace(/"/g, '\\"') + '"'
  );
}

function serializeTransaction(tx: Transaction): string[] {
  const lines: string[] = [];
  const header =
    tx.date +
    " " +
    (tx.flag || "*") +
    ' "' +
    tx.payee.replace(/"/g, "'") +
    '" "' +
    tx.narration.replace(/"/g, "'") +
    '"';
  lines.push(header);
  lines.push(...serializeMeta(tx.meta));
  for (const p of tx.postings) {
    lines.push(
      "  " +
        p.account.padEnd(ACCOUNT_COL, " ") +
        " " +
        fromCents(p.amount) +
        " " +
        p.currency
    );
  }
  return lines;
}

export function serializeDirective(d: Directive): string[] {
  switch (d.kind) {
    case "open":
      return [
        d.date +
          " open " +
          d.account +
          (d.currencies.length ? " " + d.currencies.join(",") : ""),
      ];
    case "balance":
      return [
        d.date +
          " balance " +
          d.account.padEnd(ACCOUNT_COL, " ") +
          " " +
          fromCents(d.amount) +
          " " +
          d.currency,
      ];
    case "transaction":
      return serializeTransaction(d);
  }
}

export function serialize(ledger: Ledger): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(ledger.options)) {
    out.push('option "' + k + '" "' + v.replace(/"/g, "'") + '"');
  }
  if (Object.keys(ledger.options).length) out.push("");

  // opens first (sorted by date), then balances/transactions by date
  const opens = ledger.directives.filter((d) => d.kind === "open");
  const rest = ledger.directives.filter((d) => d.kind !== "open");
  opens.sort((a, z) => a.date.localeCompare(z.date));
  rest.sort((a, z) => a.date.localeCompare(z.date));

  for (const d of opens) out.push(...serializeDirective(d));
  if (opens.length) out.push("");

  for (const d of rest) {
    out.push(...serializeDirective(d));
    out.push("");
  }
  return out.join("\n").replace(/\n+$/, "\n");
}
