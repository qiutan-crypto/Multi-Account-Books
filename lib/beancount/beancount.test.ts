// Tests for the Beancount engine. Run with: node --test (after tsc) or tsx.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "./parse";
import { serialize } from "./serialize";
import { balanceSheet, incomeStatement, aging, totals } from "./report";
import { toCents, fromCents } from "./types";

const SAMPLE = `option "title" "Acme Co"
option "operating_currency" "USD"

2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Assets:AccountsReceivable USD
2026-01-01 open Liabilities:AccountsPayable USD
2026-01-01 open Equity:Owner USD
2026-01-01 open Income:Sales USD
2026-01-01 open Expenses:Rent USD

2026-01-01 * "Owner" "Opening contribution"
  Assets:Bank:Checking            10000.00 USD
  Equity:Owner                   -10000.00 USD

2026-02-04 * "Bright Dental" "Invoice 1014"
  id: "inv_1014"
  due: "2026-03-06"
  customer: "Bright Dental"
  Assets:AccountsReceivable        1250.00 USD
  Income:Sales                    -1250.00 USD

2026-02-10 * "Northside" "February rent"
  Expenses:Rent                    2400.00 USD
  Assets:Bank:Checking            -2400.00 USD

2026-02-20 * "Bright Dental" "Payment for INV 1014"
  applies_to: "inv_1014"
  Assets:Bank:Checking             1250.00 USD
  Assets:AccountsReceivable       -1250.00 USD

2026-02-15 * "Office Supply Co" "Bill for supplies"
  vendor: "Office Supply Co"
  Expenses:Rent                     300.00 USD
  Liabilities:AccountsPayable      -300.00 USD
`;

test("money helpers round-trip and handle parens/commas", () => {
  assert.equal(toCents("1,250.00"), 125000);
  assert.equal(toCents("(72.50)"), -7250);
  assert.equal(toCents("-10000.00"), -1000000);
  assert.equal(fromCents(125000), "1250.00");
  assert.equal(fromCents(-7250), "-72.50");
  assert.equal(fromCents(5), "0.05");
});

test("parser reads options, opens, txns, metadata", () => {
  const { ledger, errors } = parse(SAMPLE);
  assert.equal(errors.length, 0, "no parse/validate errors: " + JSON.stringify(errors));
  assert.equal(ledger.options.title, "Acme Co");
  assert.equal(ledger.options.operating_currency, "USD");
  const txns = ledger.directives.filter((d) => d.kind === "transaction");
  assert.equal(txns.length, 5);
  const inv = txns.find((t: any) => t.meta.id === "inv_1014") as any;
  assert.ok(inv, "found invoice txn by metadata");
  assert.equal(inv.meta.due, "2026-03-06");
  assert.equal(inv.meta.customer, "Bright Dental");
  assert.equal(inv.postings.length, 2);
  assert.equal(inv.postings[0].amount, 125000);
});

test("validator flags an unbalanced transaction", () => {
  const bad = `2026-01-01 open Assets:Bank USD
2026-01-01 open Income:Sales USD

2026-03-01 * "X" "unbalanced"
  Assets:Bank      100.00 USD
  Income:Sales     -90.00 USD
`;
  const { errors } = parse(bad);
  assert.ok(
    errors.some((e) => /does not balance/.test(e.message)),
    "expected a balance error"
  );
});

test("balance sheet balances: A = L + E + current earnings", () => {
  const { ledger } = parse(SAMPLE);
  const bs = balanceSheet(ledger, "2026-12-31");
  assert.equal(bs.balances, true, "balance sheet must balance");
  assert.equal(bs.totalAssets, bs.totalLiabEquity);
  // Sanity on the numbers:
  // Cash: 10000 - 2400 + 1250 = 8850 ; A/R: 1250 - 1250 = 0 ; assets = 8850
  assert.equal(bs.totalAssets, 885000);
  // Liab (A/P) = 300 ; Equity (owner) = 10000 ; net income = 1250 - 2700 = -1450
  // 300 + 10000 + (-1450) = 8850
  assert.equal(bs.currentEarnings, -145000);
});

test("income statement nets revenue minus expenses", () => {
  const { ledger } = parse(SAMPLE);
  const is = incomeStatement(ledger, { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(is.netIncome, -145000); // 1250 income - 2700 rent
  const sales = is.income.find((l) => l.account === "Income:Sales");
  assert.equal(sales?.cents, 125000); // display sign positive
});

test("A/R aging groups by customer and buckets by due date", () => {
  // Build a ledger with an unpaid invoice well past due.
  const led = parse(`2026-01-01 open Assets:AccountsReceivable USD
2026-01-01 open Income:Sales USD

2026-01-01 * "Acme" "old invoice"
  customer: "Acme"
  due: "2026-01-15"
  Assets:AccountsReceivable   500.00 USD
  Income:Sales               -500.00 USD
`).ledger;
  const ar = aging(led, "Assets:AccountsReceivable", "2026-06-12");
  assert.equal(ar.rows.length, 1);
  assert.equal(ar.rows[0].party, "Acme");
  assert.equal(ar.total.total, 50000);
  // ~148 days past due -> 90+ bucket
  assert.equal(ar.rows[0].d90_plus, 50000);
  assert.equal(ar.rows[0].current, 0);
});

test("A/P aging flips sign on the liability control account", () => {
  const { ledger } = parse(SAMPLE);
  const ap = aging(ledger, "Liabilities:AccountsPayable", "2026-12-31", {
    flip: true,
  });
  assert.equal(ap.total.total, 30000); // owe 300.00, positive after flip
  assert.equal(ap.rows[0].party, "Office Supply Co");
});

test("serialize -> parse round-trips and still balances", () => {
  const { ledger } = parse(SAMPLE);
  const text = serialize(ledger);
  const reparsed = parse(text);
  assert.equal(reparsed.errors.length, 0, JSON.stringify(reparsed.errors));
  const bs1 = balanceSheet(ledger, "2026-12-31");
  const bs2 = balanceSheet(reparsed.ledger, "2026-12-31");
  assert.equal(bs1.totalAssets, bs2.totalAssets);
  assert.equal(bs2.balances, true);
  const t1 = totals(ledger);
  const t2 = totals(reparsed.ledger);
  assert.deepEqual(t1, t2);
});
