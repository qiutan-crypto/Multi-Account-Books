// Tests for the Beancount engine. Run with: node --test (after tsc) or tsx.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "./parse";
import { serialize } from "./serialize";
import { balanceSheet, incomeStatement, aging, totals, byPayee } from "./report";
import { toCents, fromCents, accountType } from "./types";
import { parsePaste, normalizeDate, parseBankRows } from "./import";
import { profitAndLoss, profitAndLossDetail, balanceSheetStatement, trialBalance, profitAndLossPeriods, balanceSheetPeriods } from "./statements";

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

test("parsePaste handles TSV with headers", () => {
  const text = [
    "Date\tPayee\tDescription\tAmount\tAccount\tOffset",
    "2026-01-05\tClient A\tInvoice\t1500\tAssets:Bank:Checking\tIncome:Sales",
    "01/06/2026\tStaples\tPens\t(25.50)\tExpenses:Office\tAssets:Bank:Checking",
  ].join("\n");
  const rows = parsePaste(text, { account: "Assets:Bank:Checking", offset: "Expenses:Uncategorized" });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "2026-01-05");
  assert.equal(rows[0].amountCents, 150000);
  assert.equal(rows[0].account, "Assets:Bank:Checking");
  assert.equal(rows[1].date, "2026-01-06"); // M/D/Y normalized
  assert.equal(rows[1].amountCents, -2550); // parens = negative
});

test("parsePaste reads positional columns when no header", () => {
  const text = "2026-02-01,Acme,Payment,800,Assets:Bank:Checking,Income:Sales";
  const rows = parsePaste(text, { account: "X:Y", offset: "X:Z" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payee, "Acme");
  assert.equal(rows[0].amountCents, 80000);
});

test("parsePaste drops rows with no date or zero amount, applies defaults", () => {
  const text = [
    "Date\tAmount",
    "\t100",          // no date -> dropped
    "2026-03-01\t0",  // zero amount -> dropped
    "2026-03-02\t50", // kept, uses defaults for accounts
  ].join("\n");
  const rows = parsePaste(text, { account: "Assets:Bank", offset: "Expenses:Uncategorized" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account, "Assets:Bank");
  assert.equal(rows[0].offset, "Expenses:Uncategorized");
});

test("normalizeDate handles ISO and M/D/Y, rejects junk", () => {
  assert.equal(normalizeDate("2026-05-09"), "2026-05-09");
  assert.equal(normalizeDate("5/9/26"), "2026-05-09");
  assert.equal(normalizeDate("nonsense"), "");
});

test("byPayee groups income and expenses by payee with correct signs", () => {
  const { ledger } = parse(SAMPLE);
  const inc = byPayee(ledger, "Income", { from: "2026-01-01", to: "2026-12-31" });
  // Income: Bright Dental 1250 + (split note: payment doesn't touch Income)
  const bd = inc.rows.find((r) => r.payee === "Bright Dental");
  assert.equal(bd?.cents, 125000); // positive revenue
  assert.equal(inc.total, 125000);

  const exp = byPayee(ledger, "Expenses", { from: "2026-01-01", to: "2026-12-31" });
  // Expenses: Northside rent 2400 + Office Supply Co 300 = 2700
  const north = exp.rows.find((r) => r.payee === "Northside");
  assert.equal(north?.cents, 240000);
  assert.equal(exp.total, 270000);
  // sorted descending
  assert.ok(exp.rows[0].cents >= exp.rows[exp.rows.length - 1].cents);
});

test("profitAndLoss groups sub-accounts and nets to income statement", () => {
  const led = parse(`2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Income:Revenue-Product:BookSales USD
2026-01-01 open Income:Revenue-Product:SoftwareSales USD
2026-01-01 open Income:Consulting USD
2026-01-01 open Expenses:COGS:Purchases USD
2026-01-01 open Expenses:Rent USD
2026-01-01 open Income:Other:Interest USD

2026-03-01 * "A" "book sale"
  Assets:Bank:Checking          100.00 USD
  Income:Revenue-Product:BookSales -100.00 USD
2026-03-02 * "B" "software sale"
  Assets:Bank:Checking          400.00 USD
  Income:Revenue-Product:SoftwareSales -400.00 USD
2026-03-03 * "C" "consulting"
  Assets:Bank:Checking          1000.00 USD
  Income:Consulting            -1000.00 USD
2026-03-04 * "D" "purchase"
  Expenses:COGS:Purchases        200.00 USD
  Assets:Bank:Checking          -200.00 USD
2026-03-05 * "E" "rent"
  Expenses:Rent                  300.00 USD
  Assets:Bank:Checking          -300.00 USD
2026-03-06 * "F" "interest"
  Assets:Bank:Checking           50.00 USD
  Income:Other:Interest         -50.00 USD
`).ledger;
  const pl = profitAndLoss(led, { from: "2026-01-01", to: "2026-12-31" });
  const find = (label: string) => pl.rows.find((r) => r.label === label);
  // sub-account group "Revenue - Product" subtotal = 500
  assert.equal(find("Total for Revenue - Product")?.cents, 50000);
  // Total income = 100 + 400 + 1000 = 1500 (Other:Interest is Other Income)
  assert.equal(find("Total for Income")?.cents, 150000);
  // Gross profit = 1500 - 200 COGS = 1300
  assert.equal(find("Gross Profit")?.cents, 130000);
  // Net operating = 1300 - 300 rent = 1000
  assert.equal(find("Net Operating Income")?.cents, 100000);
  // Other income 50 -> Net income 1050
  assert.equal(find("Net Income")?.cents, 105000);
  assert.equal(pl.netIncome, 105000);
});

test("COGS is a top-level account type with its own P&L section", () => {
  assert.equal(accountType("COGS:JobMaterials"), "COGS");
  const led = parse(`2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Equity:Owner USD
2026-01-01 open Income:Sales USD
2026-01-01 open COGS:OutsourcedLabor USD
2026-01-01 open COGS:JobMaterials USD
2026-01-01 open Expenses:Rent USD

2026-01-01 * "Owner" "Opening"
  Assets:Bank:Checking            10000.00 USD
  Equity:Owner                   -10000.00 USD
2026-03-01 * "Client" "sale"
  Assets:Bank:Checking            5000.00 USD
  Income:Sales                   -5000.00 USD
2026-03-02 * "Sub" "labor"
  COGS:OutsourcedLabor            1200.00 USD
  Assets:Bank:Checking           -1200.00 USD
2026-03-03 * "Yard" "materials"
  COGS:JobMaterials                800.00 USD
  Assets:Bank:Checking            -800.00 USD
2026-03-04 * "Landlord" "rent"
  Expenses:Rent                    300.00 USD
  Assets:Bank:Checking            -300.00 USD
`).ledger;
  const pl = profitAndLoss(led, { from: "2026-01-01", to: "2026-12-31" });
  const find = (label: string) => pl.rows.find((r) => r.label === label);
  // COGS section total = 1200 + 800 = 2000, above Expenses
  assert.equal(find("Total for Cost of Goods Sold")?.cents, 200000);
  // Gross Profit = 5000 income - 2000 COGS = 3000
  assert.equal(find("Gross Profit")?.cents, 300000);
  // Net Operating = 3000 - 300 rent = 2700
  assert.equal(find("Net Operating Income")?.cents, 270000);
  assert.equal(pl.netIncome, 270000);
  // Cost of Goods Sold section appears before Expenses
  const cogsIdx = pl.rows.findIndex((r) => r.kind === "section" && r.label === "Cost of Goods Sold");
  const expIdx = pl.rows.findIndex((r) => r.kind === "section" && r.label === "Expenses");
  assert.ok(cogsIdx >= 0 && cogsIdx < expIdx, "COGS section precedes Expenses");
  // Balance sheet still balances with a top-level COGS account
  const bs = balanceSheetStatement(led, "2026-12-31");
  assert.equal(bs.balances, true);
  // net income (2700) closes into equity: assets 12700 = equity 10000 + 2700
  assert.equal(bs.totalAssets, bs.totalLiabEquity);
  assert.equal(bs.totalAssets, 1270000);
});

test("profitAndLossDetail ties to the summary and lists transactions", () => {
  const { ledger } = parse(SAMPLE);
  const range = { from: "2026-01-01", to: "2026-12-31" };
  const sum = profitAndLoss(ledger, range);
  const det = profitAndLossDetail(ledger, range);
  // Net income matches the summary exactly
  const sNet = sum.rows.find((r) => r.label === "Net Income")?.cents;
  const dNet = det.rows.find((r) => r.label === "Net Income")?.cents;
  assert.equal(dNet, sNet);
  // Total for Income matches
  const sInc = sum.rows.find((r) => r.label === "Total for Income")?.cents;
  const dInc = det.rows.find((r) => r.label === "Total for Income")?.cents;
  assert.equal(dInc, sInc);
  // There are transaction rows, and each leaf's running balance ends at its subtotal
  const txnRows = det.rows.filter((r) => r.kind === "txn");
  assert.ok(txnRows.length > 0, "detail has transaction rows");
  // For Income:Sales — find its subtotal and the last txn balance before it
  const idx = det.rows.findIndex((r) => r.label === "Total for Sales");
  assert.ok(idx > 0);
  const subtotal = det.rows[idx].cents!;
  // walk back to the last txn row
  let lastBal = 0;
  for (let i = idx - 1; i >= 0; i--) {
    if (det.rows[i].kind === "txn") { lastBal = det.rows[i].txn!.balance; break; }
    if (det.rows[i].kind === "accountHeader") break;
  }
  assert.equal(Math.round(lastBal), Math.round(subtotal));
});

test("balanceSheetStatement balances with grouped accounts", () => {
  const { ledger } = parse(SAMPLE);
  const bs = balanceSheetStatement(ledger, "2026-12-31");
  assert.equal(bs.balances, true);
  assert.equal(bs.totalAssets, bs.totalLiabEquity);
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

test("trialBalance ties: total debits equal total credits", () => {
  const { ledger } = parse(SAMPLE);
  const tb = trialBalance(ledger);
  assert.equal(tb.balanced, true);
  assert.equal(tb.totalDebit, tb.totalCredit);
  // every account sits in exactly one column
  for (const r of tb.rows) {
    assert.ok((r.debit === 0) !== (r.credit === 0), r.account + " must be one-sided");
  }
  // a debit-natured account (Assets:Bank:Checking = 10000 - 2400 + 1250 = 8850)
  const bank = tb.rows.find((r) => r.account === "Assets:Bank:Checking");
  assert.equal(bank?.debit, 885000);
  assert.equal(bank?.credit, 0);
});

test("parseBankRows reads signed amounts, M/D/YY dates, parens, and ref", () => {
  const csv = [
    "Date,Description,Amount,Ref",
    "6/4/26,SHELL OIL 574201,-64.32,",
    "06/05/2026,CLIENT DEPOSIT,375.00,1042",
    "6/6/26,STAPLES,(25.50),CHK-1043",
    "6/7/26,\"AMAZON, MKTPLACE\",-89.46,",
  ].join("\n");
  const rows = parseBankRows(csv);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { date: "2026-06-04", description: "SHELL OIL 574201", amountCents: -6432, ref: "" });
  assert.deepEqual(rows[1], { date: "2026-06-05", description: "CLIENT DEPOSIT", amountCents: 37500, ref: "1042" });
  // accounting-style parens = negative
  assert.equal(rows[2].amountCents, -2550);
  assert.equal(rows[2].ref, "CHK-1043");
  // quoted field with an embedded comma stays intact
  assert.equal(rows[3].description, "AMAZON, MKTPLACE");
});

test("parseBankRows: positional fallback (no header) and drops junk rows", () => {
  const csv = [
    "6/4/26,SHELL OIL,-64.32,",   // no header row
    "not-a-date,GARBAGE,-10,",     // dropped: no valid date
    "6/8/26,ZERO AMT,0,",          // dropped: zero amount
    "6/9/26,PUBLIX,-156.21,7788",
  ].join("\n");
  const rows = parseBankRows(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].description, "SHELL OIL");
  assert.equal(rows[1].ref, "7788");
});

test("profitAndLossPeriods columns sum to the single-column total", () => {
  const { ledger } = parse(SAMPLE);
  const range = { from: "2026-01-01", to: "2026-12-31" };
  const single = profitAndLoss(ledger, range);
  const cols = profitAndLossPeriods(ledger, [
    { from: "2026-01-01", to: "2026-01-31" },
    { from: "2026-02-01", to: "2026-02-28" },
    { from: "2026-03-01", to: "2026-12-31" },
  ]);
  // Net income: sum of the per-period net incomes equals the full-range figure.
  const summed = cols.netIncomes.reduce((s, x) => s + x, 0);
  assert.equal(Math.round(summed), Math.round(single.netIncome));
  // Every columnar row's period values sum to the full-range amount for that row.
  const byLabel = new Map(single.rows.filter((r) => typeof r.cents === "number").map((r) => [r.kind + "|" + r.label, r.cents!]));
  for (const r of cols.rows) {
    if (!r.values) continue;
    const key = r.kind + "|" + r.label;
    if (!byLabel.has(key)) continue;
    const rowSum = r.values.reduce((s, x) => s + x, 0);
    assert.equal(Math.round(rowSum), Math.round(byLabel.get(key)!), key + " must tie out");
  }
});

test("balanceSheetPeriods last column equals the single-column balance sheet", () => {
  const { ledger } = parse(SAMPLE);
  const ends = ["2026-01-31", "2026-06-30", "2026-12-31"];
  const cols = balanceSheetPeriods(ledger, ends);
  // Balances at each period end.
  assert.deepEqual(cols.balances, [true, true, true]);
  const last = cols.totalAssets.length - 1;
  const single = balanceSheetStatement(ledger, "2026-12-31");
  assert.equal(Math.round(cols.totalAssets[last]), Math.round(single.totalAssets));
  assert.equal(Math.round(cols.totalLiabEquity[last]), Math.round(single.totalLiabEquity));
});
