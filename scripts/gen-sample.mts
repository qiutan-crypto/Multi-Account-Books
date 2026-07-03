// Generates a realistic ~3-year services-firm ledger (~10k transactions) and
// writes it to lib/store/sample.beancount, which the store seeds as the
// "Sample Company" entity.
//
// Run: npx tsx scripts/gen-sample.mts
//
// Every transaction is balanced. Invoices/bills carry customer/vendor + due
// metadata so A/R & A/P aging work. The data is deterministic (seeded RNG) so
// regenerating produces the same ledger.

import { promises as fs } from "node:fs";
import path from "node:path";

// ---- deterministic RNG ----------------------------------------------------
let seed = 1234567;
function rnd(): number {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function between(lo: number, hi: number): number {
  return lo + rnd() * (hi - lo);
}
function money(n: number): string {
  return n.toFixed(2);
}

// ---- chart of accounts ----------------------------------------------------
const accounts = [
  "Assets:Bank:Checking",
  "Assets:Bank:Savings",
  "Assets:AccountsReceivable",
  "Assets:PrepaidExpenses",
  "Liabilities:AccountsPayable",
  "Liabilities:CreditCard",
  "Liabilities:PayrollTaxPayable",
  "Liabilities:Loan:SBA",
  "Equity:Owner",
  "Equity:OwnerDraws",
  "Income:Consulting",
  "Income:Sales",
  "Income:Sales:Products",
  "Income:Sales:Services",
  "Income:Interest",
  // Cost of Goods Sold — its own top-level category (above Expenses on the P&L)
  "COGS:OutsourcedLabor",
  "COGS:JobMaterials",
  "COGS:DirectSoftwareEquipmentCost",
  "Expenses:Payroll",
  "Expenses:PayrollTaxes",
  "Expenses:Rent",
  "Expenses:Software",
  "Expenses:Utilities",
  "Expenses:Advertising",
  "Expenses:Travel",
  "Expenses:Meals",
  "Expenses:Office",
  "Expenses:Office:Supplies",
  "Expenses:Office:Software",
  "Expenses:Insurance",
  "Expenses:Contractors",
  "Expenses:BankFees",
  "Expenses:ProfessionalFees",
];

const customers = [
  "Acme Foods", "Bright Dental", "Canyon Law", "Delta Retail", "Evergreen Studio",
  "Futura Labs", "Granite Realty", "Harbor Clinic", "Ironwood Mfg", "Juniper Media",
  "Keystone Bank", "Lumen Energy", "Meridian Health", "Northwind Trading", "Onyx Security",
  "Pinnacle Group", "Quartz Analytics", "Riverside Co-op", "Summit Ventures", "Trellis Farms",
];

const softwareVendors = [
  ["Adobe", 89], ["Figma", 45], ["Slack", 120], ["Notion", 32],
  ["GitHub", 84], ["Zoom", 65], ["Google Workspace", 150], ["AWS", 540],
];
const otherVendors: [string, string, number][] = [
  ["Metro Insurance", "Expenses:Insurance", 525],
  ["City Power", "Expenses:Utilities", 240],
  ["Northside Workspace", "Expenses:Rent", 4200],
  ["Search Ads Co", "Expenses:Advertising", 680],
  ["Contractor Team", "Expenses:Contractors", 1850],
  ["Travel Desk", "Expenses:Travel", 525],
  ["Cafe Bistro", "Expenses:Meals", 96],
  ["Office Depot", "Expenses:Office", 140],
  ["Wilson & Co CPA", "Expenses:ProfessionalFees", 900],
];

// ---- transaction emitter --------------------------------------------------
interface Posting { account: string; amount: number; }
interface Tx { date: string; payee: string; narration: string; meta: Record<string, string>; postings: Posting[]; }
const txns: Tx[] = [];
let idSeq = 0;

function emit(date: string, payee: string, narration: string, postings: Posting[], meta: Record<string, string> = {}) {
  idSeq++;
  meta.id = "tx-" + date.replace(/-/g, "") + "-" + idSeq.toString(36);
  txns.push({ date, payee, narration, meta, postings });
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
}
function addDays(dateStr: string, days: number): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const START_YEAR = 2023;
const YEARS = 3;

// Opening capital + loan
emit(iso(START_YEAR, 1, 1), "Owner", "Opening capital contribution", [
  { account: "Assets:Bank:Checking", amount: 75000 },
  { account: "Equity:Owner", amount: -75000 },
]);
emit(iso(START_YEAR, 1, 2), "SBA Lender", "SBA loan proceeds", [
  { account: "Assets:Bank:Checking", amount: 50000 },
  { account: "Liabilities:Loan:SBA", amount: -50000 },
]);
emit(iso(START_YEAR, 1, 3), "Treasury", "Move reserve to savings", [
  { account: "Assets:Bank:Savings", amount: 30000 },
  { account: "Assets:Bank:Checking", amount: -30000 },
]);

for (let yi = 0; yi < YEARS; yi++) {
  const year = START_YEAR + yi;
  // gentle growth each year
  const growth = 1 + yi * 0.18;

  for (let month = 1; month <= 12; month++) {
    // --- Revenue: ~75-100 invoices/month, each with a later payment ---
    const invoiceCount = Math.round(between(75, 100) * growth);
    for (let i = 0; i < invoiceCount; i++) {
      const day = Math.floor(between(1, 28));
      const date = iso(year, month, day);
      const customer = pick(customers);
      const isConsulting = rnd() < 0.7;
      const amount = Math.round(between(800, 6500) * growth);
      const acct = isConsulting ? "Income:Consulting" : "Income:Sales";
      const due = addDays(date, pick([15, 30, 30, 45]));
      const invNo = `${year}-${String(month).padStart(2, "0")}-${i + 1}`;
      emit(date, customer, "Invoice " + invNo, [
        { account: "Assets:AccountsReceivable", amount },
        { account: acct, amount: -amount },
      ], { customer, due });

      // payment lands a bit after invoice date (most get paid)
      if (rnd() < 0.92) {
        const payDate = addDays(date, Math.floor(between(10, 50)));
        // keep payment within our window
        if (payDate <= iso(START_YEAR + YEARS - 1, 12, 28)) {
          emit(payDate, customer, "Payment for INV " + invNo, [
            { account: "Assets:Bank:Checking", amount },
            { account: "Assets:AccountsReceivable", amount: -amount },
          ], { customer, applies_to: "inv " + invNo });
        }
      }
    }

    // --- Software subscriptions (recurring, on credit card) ---
    for (const [vendor, base] of softwareVendors) {
      const date = iso(year, month, Math.floor(between(2, 10)));
      const amt = Math.round((base as number) * between(0.95, 1.1));
      emit(date, vendor as string, (vendor as string) + " subscription", [
        { account: "Expenses:Software", amount: amt },
        { account: "Liabilities:CreditCard", amount: -amt },
      ], { vendor: vendor as string });
    }

    // --- Vendor bills (A/P) + payments ---
    for (const [vendor, acct, base] of otherVendors) {
      if (vendor === "Northside Workspace") continue; // rent handled below
      if (rnd() < 0.85) {
        const date = iso(year, month, Math.floor(between(3, 24)));
        const amt = Math.round(base * between(0.85, 1.25));
        const due = addDays(date, 30);
        emit(date, vendor, vendor + " — " + acct.split(":").pop(), [
          { account: acct, amount: amt },
          { account: "Liabilities:AccountsPayable", amount: -amt },
        ], { vendor, due });
        // pay the bill
        if (rnd() < 0.9) {
          const payDate = addDays(date, Math.floor(between(12, 35)));
          if (payDate <= iso(START_YEAR + YEARS - 1, 12, 28)) {
            emit(payDate, vendor, "Payment to " + vendor, [
              { account: "Liabilities:AccountsPayable", amount: amt },
              { account: "Assets:Bank:Checking", amount: -amt },
            ], { vendor });
          }
        }
      }
    }

    // --- Rent (1st of month) ---
    const rent = Math.round(4200 * (1 + yi * 0.05));
    emit(iso(year, month, 1), "Northside Workspace", "Monthly rent", [
      { account: "Expenses:Rent", amount: rent },
      { account: "Assets:Bank:Checking", amount: -rent },
    ], { vendor: "Northside Workspace" });

    // --- Utilities ---
    const utilAmt = Math.round(between(180, 320));
    emit(iso(year, month, 12), "City Power", "Electricity & water", [
      { account: "Expenses:Utilities", amount: utilAmt },
      { account: "Assets:Bank:Checking", amount: -utilAmt },
    ], { vendor: "City Power" });

    // --- Payroll: two runs/month, with payroll taxes ---
    for (const payDay of [15, 28]) {
      const gross = Math.round(between(14000, 22000) * growth);
      const taxes = Math.round(gross * 0.18);
      emit(iso(year, month, payDay), "Payroll", "Payroll run", [
        { account: "Expenses:Payroll", amount: gross },
        { account: "Assets:Bank:Checking", amount: -gross },
      ]);
      emit(iso(year, month, payDay), "Payroll Taxes", "Employer payroll taxes", [
        { account: "Expenses:PayrollTaxes", amount: taxes },
        { account: "Liabilities:PayrollTaxPayable", amount: -taxes },
      ]);
    }
    // remit payroll taxes monthly
    const remit = Math.round(between(5000, 8000) * growth);
    emit(iso(year, month, 20), "IRS EFTPS", "Payroll tax deposit", [
      { account: "Liabilities:PayrollTaxPayable", amount: remit },
      { account: "Assets:Bank:Checking", amount: -remit },
    ]);

    // --- Credit card payment (pay down the card monthly) ---
    const ccPay = Math.round(between(1200, 2600));
    emit(iso(year, month, 25), "Credit Card Co", "Credit card payment", [
      { account: "Liabilities:CreditCard", amount: ccPay },
      { account: "Assets:Bank:Checking", amount: -ccPay },
    ]);

    // --- Misc daily-ish expenses (meals/travel/office on card) ---
    const miscCount = Math.floor(between(20, 38));
    for (let i = 0; i < miscCount; i++) {
      const date = iso(year, month, Math.floor(between(1, 28)));
      const [cat, lo, hi] = pick<[string, number, number]>([
        ["Expenses:Meals", 18, 140],
        ["Expenses:Travel", 60, 900],
        ["Expenses:Office", 20, 360],
        ["Expenses:Advertising", 100, 700],
      ]);
      const amt = Math.round(between(lo, hi));
      emit(date, pick(["Cafe Bistro", "Rideshare", "Amazon", "Staples", "Airline", "Hotel"]),
        cat.split(":").pop()! + " expense", [
        { account: cat, amount: amt },
        { account: "Liabilities:CreditCard", amount: -amt },
      ]);
    }

    // --- Owner draw (quarterly) ---
    if (month % 3 === 0) {
      const draw = Math.round(between(6000, 12000));
      emit(iso(year, month, 27), "Owner", "Owner draw", [
        { account: "Equity:OwnerDraws", amount: draw },
        { account: "Assets:Bank:Checking", amount: -draw },
      ]);
    }

    // --- SBA loan payment (monthly) ---
    emit(iso(year, month, 5), "SBA Lender", "SBA loan payment", [
      { account: "Liabilities:Loan:SBA", amount: 1150 },
      { account: "Assets:Bank:Checking", amount: -1150 },
    ]);

    // --- Bank fees ---
    emit(iso(year, month, 28), "Bank", "Monthly service fee", [
      { account: "Expenses:BankFees", amount: 35 },
      { account: "Assets:Bank:Checking", amount: -35 },
    ]);

    // --- Interest earned on savings ---
    const intAmt = Math.round(between(40, 95));
    emit(iso(year, month, 28), "Bank", "Interest earned", [
      { account: "Assets:Bank:Savings", amount: intAmt },
      { account: "Income:Interest", amount: -intAmt },
    ]);
  }

  // annual insurance prepayment in January
  emit(iso(year, 1, 8), "Metro Insurance", "Annual liability insurance", [
    { account: "Expenses:Insurance", amount: 6300 },
    { account: "Assets:Bank:Checking", amount: -6300 },
  ], { vendor: "Metro Insurance" });
}

// ---- Cost of Goods Sold — explicit 2025 entries, paid from the bank ---------
// 2025 COGS totals exactly $6,150,685, distributed across three top-level COGS
// accounts so the P&L shows Income → COGS → Gross Profit → Expenses:
//   COGS:OutsourcedLabor            2,750,000
//   COGS:JobMaterials               2,400,685
//   COGS:DirectSoftwareEquipmentCost 1,000,000
// Posted to the COGS root and paid out of Assets:Bank:Checking. Deterministic.
const cogs2025: { month: number; day: number; vendor: string; account: string; narration: string; amount: number }[] = [
  // Outsourced Labor — $2,750,000
  { month: 1, day: 15, vendor: "Apex Subcontractors", account: "COGS:OutsourcedLabor", narration: "Outsourced project labor", amount: 420000 },
  { month: 3, day: 12, vendor: "Prime Labor Partners", account: "COGS:OutsourcedLabor", narration: "Outsourced project labor", amount: 385000 },
  { month: 5, day: 9, vendor: "Skilled Trades LLC", account: "COGS:OutsourcedLabor", narration: "Outsourced project labor", amount: 510000 },
  { month: 7, day: 18, vendor: "Apex Subcontractors", account: "COGS:OutsourcedLabor", narration: "Outsourced project labor", amount: 460000 },
  { month: 9, day: 6, vendor: "Prime Labor Partners", account: "COGS:OutsourcedLabor", narration: "Outsourced project labor", amount: 475000 },
  { month: 11, day: 20, vendor: "Skilled Trades LLC", account: "COGS:OutsourcedLabor", narration: "Outsourced project labor", amount: 500000 },
  // Job Materials — $2,400,685
  { month: 2, day: 10, vendor: "BuildRight Materials", account: "COGS:JobMaterials", narration: "Job materials", amount: 388000 },
  { month: 4, day: 14, vendor: "Coastal Supply Co", account: "COGS:JobMaterials", narration: "Job materials", amount: 402500 },
  { month: 6, day: 11, vendor: "Ironwood Mfg", account: "COGS:JobMaterials", narration: "Job materials", amount: 415185 },
  { month: 8, day: 17, vendor: "BuildRight Materials", account: "COGS:JobMaterials", narration: "Job materials", amount: 390000 },
  { month: 10, day: 22, vendor: "Coastal Supply Co", account: "COGS:JobMaterials", narration: "Job materials", amount: 405000 },
  { month: 12, day: 15, vendor: "Ironwood Mfg", account: "COGS:JobMaterials", narration: "Job materials", amount: 400000 },
  // Direct Software/Equipment Cost — $1,000,000
  { month: 2, day: 20, vendor: "Autodesk", account: "COGS:DirectSoftwareEquipmentCost", narration: "Direct software & equipment cost", amount: 180000 },
  { month: 5, day: 5, vendor: "Trimble", account: "COGS:DirectSoftwareEquipmentCost", narration: "Direct software & equipment cost", amount: 220000 },
  { month: 8, day: 8, vendor: "Equipment Depot", account: "COGS:DirectSoftwareEquipmentCost", narration: "Direct software & equipment cost", amount: 210000 },
  { month: 10, day: 3, vendor: "Autodesk", account: "COGS:DirectSoftwareEquipmentCost", narration: "Direct software & equipment cost", amount: 190000 },
  { month: 12, day: 12, vendor: "Trimble", account: "COGS:DirectSoftwareEquipmentCost", narration: "Direct software & equipment cost", amount: 200000 },
];
for (const c of cogs2025) {
  emit(iso(2025, c.month, c.day), c.vendor, c.narration, [
    { account: c.account, amount: c.amount },
    { account: "Assets:Bank:Checking", amount: -c.amount },
  ], { vendor: c.vendor });
}

// ---- Sub-account examples — a few explicit 2025 entries --------------------
// Demonstrates a visible parent→child structure in the chart of accounts:
//   Income:Sales -> Products, Services   (revenue, deposited to the bank)
//   Expenses:Office -> Supplies, Software (paid from the bank)
// Deterministic; each entry is balanced.
const subAcctEntries2025: { month: number; day: number; payee: string; narration: string; account: string; amount: number; income: boolean }[] = [
  { month: 2, day: 10, payee: "Delta Retail", narration: "Product sales — hardware kits", account: "Income:Sales:Products", amount: 48200, income: true },
  { month: 6, day: 14, payee: "Northwind Trading", narration: "Product sales — hardware kits", account: "Income:Sales:Products", amount: 53750, income: true },
  { month: 4, day: 9, payee: "Pinnacle Group", narration: "Service revenue — onboarding", account: "Income:Sales:Services", amount: 39400, income: true },
  { month: 10, day: 22, payee: "Summit Ventures", narration: "Service revenue — onboarding", account: "Income:Sales:Services", amount: 41250, income: true },
  { month: 3, day: 5, payee: "Office Depot", narration: "Office supplies — paper & toner", account: "Expenses:Office:Supplies", amount: 2150, income: false },
  { month: 8, day: 17, payee: "Staples", narration: "Office supplies — breakroom & desks", account: "Expenses:Office:Supplies", amount: 3380, income: false },
  { month: 1, day: 12, payee: "Atlassian", narration: "Office software — Jira & Confluence", account: "Expenses:Office:Software", amount: 4200, income: false },
  { month: 9, day: 28, payee: "Microsoft", narration: "Office software — M365 annual", account: "Expenses:Office:Software", amount: 5600, income: false },
];
for (const e of subAcctEntries2025) {
  if (e.income) {
    emit(iso(2025, e.month, e.day), e.payee, e.narration, [
      { account: "Assets:Bank:Checking", amount: e.amount },
      { account: e.account, amount: -e.amount },
    ], { customer: e.payee });
  } else {
    emit(iso(2025, e.month, e.day), e.payee, e.narration, [
      { account: e.account, amount: e.amount },
      { account: "Assets:Bank:Checking", amount: -e.amount },
    ], { vendor: e.payee });
  }
}

// ---- serialize ------------------------------------------------------------
const lines: string[] = [
  'option "title" "Sample Company (Read Only)"',
  'option "bb_readonly" "1"',
  'option "operating_currency" "USD"',
  "",
];
for (const a of accounts) lines.push(`${START_YEAR}-01-01 open ${a} USD`);
lines.push("");

txns.sort((a, b) => a.date.localeCompare(b.date) || a.meta.id.localeCompare(b.meta.id));
for (const t of txns) {
  lines.push(`${t.date} * "${t.payee.replace(/"/g, "'")}" "${t.narration.replace(/"/g, "'")}"`);
  // metadata first
  for (const [k, v] of Object.entries(t.meta)) lines.push(`  ${k}: "${v.replace(/"/g, "'")}"`);
  for (const p of t.postings) {
    lines.push("  " + p.account.padEnd(34, " ") + " " + money(p.amount) + " USD");
  }
  lines.push("");
}

const out = lines.join("\n");

// Emit a .beancount file (for reference / inspection)...
const bcTarget = path.join(process.cwd(), "lib", "store", "sample.beancount");
await fs.writeFile(bcTarget, out, "utf8");

// ...and a TS module that exports the string, so it's reliably bundled on
// Vercel (a raw .beancount file isn't traced into the serverless bundle).
const tsTarget = path.join(process.cwd(), "lib", "store", "sample-data.ts");
const escaped = out.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
const tsOut =
  "// AUTO-GENERATED by scripts/gen-sample.mts — do not edit by hand.\n" +
  "// 3-year sample services-firm ledger (" + txns.length + " transactions).\n" +
  "export const SAMPLE_LEDGER = `" + escaped + "`;\n";
await fs.writeFile(tsTarget, tsOut, "utf8");

console.log("Wrote", bcTarget, "and", tsTarget);
console.log("Transactions:", txns.length, "| size:", (out.length / 1024).toFixed(0) + "KB");
