# BeanBooks — Change Log

All notable changes to BeanBooks, by version. Entries authored from the build
chat are credited to **Hector Garcia, CPA**.

The format groups changes under each version. Versions follow `0.0.0x` for now.

---

## v0.0.06 — 2026-06-14
**Author:** Hector Garcia, CPA

Comparative periods on the financial statements.

### Added
- **Comparative columns on the Statements tab** (P&L and Balance Sheet):
  - **Compare to:** No comparison, **Prior year** (auto-shifts the selected
    range back one year), or **Custom period** (pick your own comparison range;
    for the Balance Sheet, the comparison "as of" date).
  - **Change column toggle:** **$ change** or **% change**.
    - $ change = current − comparison.
    - % change = (current − comparison) / |comparison|, shown as "n/a" when the
      comparison amount is zero.
  - Columns render as **Current | Comparison | Change**, at every level
    (accounts, "Total for <group>", section totals, Gross Profit, Net Income,
    Total Assets, etc.). Negatives in red; the comparison subheader names both
    periods. Flows into the Print / Save PDF layout.

### Notes
- Comparison amounts are computed by the engine over a second date range and
  merged with the primary statement using the union of accounts across both
  periods, so an account active in only one period still appears.
- Verified against the sample (2025 vs 2024: Income +$1,874,373 / +36.0%;
  Net Income +$1,793,539 / +40.8%). 15/15 engine tests pass.
- Version label → V. 0.0.06.

---

## v0.0.05 — 2026-06-14
**Author:** Hector Garcia, CPA

QuickBooks-style financial statements with printable / PDF output.

### Added
- **Statements tab** with a QuickBooks-style **Profit & Loss** and
  **Balance Sheet**:
  - **Account hierarchy & indentation** — parent accounts (from the colon
    name, e.g. `Assets:Bank:Checking`) render as a group header with children
    indented beneath and a bold **"Total for <group>"** subtotal.
  - **P&L sections:** Income, Cost of Goods Sold, Gross Profit, Expenses,
    Net Operating Income, Other Income, Other Expenses, Net Other Income,
    Net Income — with shaded section bands and bold totals.
  - **Balance Sheet:** Assets / Liabilities / Equity, grouped with subtotals;
    net income closed into equity; Total Assets = Total Liabilities and Equity.
  - Section assignment by name convention: `:COGS:`/`:CostOfGoodsSold:` →
    Cost of Goods Sold; `:Other:` → Other Income/Expense.
  - Right-aligned amounts, **$** on totals, **negatives in red**, a centered
    title block (statement name, company, period), and a date-range with
    presets.
- **Print / Save PDF** button with a print stylesheet: hides app chrome, keeps
  the statement on white paper, shaded bands and red negatives preserved,
  page margins, and subtotal rows kept from breaking across pages — so the
  browser's Print → Save as PDF closely matches a QuickBooks export.

### Notes
- Statements reuse the engine's period balances, so figures agree with the
  Reports and Dashboard tabs.
- New engine module `lib/beancount/statements.ts` with 2 added tests
  (15 total, all passing). Version label → V. 0.0.05.

---

## v0.0.04 — 2026-06-14
**Author:** Hector Garcia, CPA

Dashboard date range.

### Added
- **Date range on the Dashboard** — From/To inputs plus presets (This month,
  This quarter, YTD, This year, Last year) and a Reset-to-YTD button.
- The period now drives the P&L figures (revenue, expenses, net income),
  the income-vs-expenses comparison, and the top-customers list. Balances and
  aging are computed as of the period end (or today when no end is set).
- Headers and the subheading reflect the selected period instead of a fixed
  "year-to-date" label.

### Notes
- Defaults to year-to-date when no range is chosen (unchanged behavior).
- Verified period figures against the sample (FY2024, Q1 2025, all-time each
  produce correct, distinct totals). Build clean; 13/13 engine tests pass.
- Version label bumped to V. 0.0.04.

---

## v0.0.03 — 2026-06-14
**Author:** Developed in a separate Claude Code session (not the build chat).

Dashboard home tab.

### Added
- **Dashboard** tab — now the default landing tab, first in the navigation.
  A one-call snapshot of the active entity:
  - **KPI cards:** Cash on hand, A/R outstanding, A/P outstanding, and
    year-to-date Net income.
  - **Income vs. expenses (YTD)** bar comparison with a net line.
  - **Needs attention:** overdue receivables and payables, plus account and
    transaction counts.
  - **Top customers (YTD)** and **Recent activity** tables.
  - A "books balanced ✓" health pill and ledger-error surfacing.

### Notes
- The dashboard reuses the same engine functions as the Reports tab
  (`balanceSheet`, `totals`, `aging`, `byPayee`) so its figures always agree
  with the reports. Balances/aging are as-of-today; P&L is year-to-date.
- Cash is detected by account-name pattern (Bank/Cash/Checking/Savings/Petty).
- Version label bumped to V. 0.0.03. Build clean; 13/13 engine tests pass.

---

## v0.0.02 — 2026-06-14
**Author:** Hector Garcia, CPA

Entity security, read-only sample, duplication, and UI/navigation polish.

### Added
- **New-entity modal** replacing the inline name box. Collects Entity Name,
  File Owner (name), and a Password.
- **Password protection for new entities.** The owner name + a SHA-256 hash of
  the password are stored in the ledger's options (`bb_owner`, `bb_pwhash`).
  Opening a protected entity requires the owner name and password. *Note: this
  is a convenience lock — the underlying file is not encrypted.*
- **Owner name remembered** in local storage and pre-filled on future logins
  and new-entity creation.
- **"Start from" option in the new-entity modal:** create from scratch (empty
  ledger) or **duplicate** any existing entity — including the sample.
  Duplicating a password-protected entity requires that entity's password.
- **Read-only Sample Company.** The sample is renamed **"Sample Company
  (Read Only)"** and flagged `bb_readonly`; all edit paths (transactions,
  accounts, imports) refuse to modify it. It can be freely duplicated into a
  new editable entity.
- **Collapsible left navigation** — a « / » toggle collapses the sidebar to a
  slim rail; state is remembered.
- **Theme dropdown** at the bottom of the nav: **Default**, **Pretty**, and a
  new **Dark** theme. Replaces the old Pretty Mode button. Visual only.
- **Date range + beginning balance in the Data entry ledger** — From/To with
  presets; when filtered by an account, a "Beginning balance (before [date])"
  row seeds the running balance.
- **Income by Payee** and **Expenses by Payee** reports, with date-range
  presets on the Reports tab.
- This **CHANGELOG**.

### Notes
- All theming and the read-only/duplicate behavior are layered on top of the
  existing Beancount engine; no change to the accounting math.
- Engine test suite: 13/13 passing.

---

## v0.0.01 — 2026-06-13 (initial public build)
**Author:** Hector Garcia, CPA

The foundational rebuild of BeanBooks into a server-backed, plain-text
accounting app.

### Added
- **Beancount engine** (`lib/beancount`): tolerant parser, report engine
  (balances, P&L, balance sheet with equity close, A/R & A/P aging),
  serializer, integer-cents money model, and stable transaction IDs. Unit
  tested.
- **React application** (replacing the original single-file app) served at `/`,
  with five tabs: Reports, Data entry, Chart of accounts, Paste import, Export.
- **Editable register** with account filter, separate debit/credit columns,
  a single-line (Excel-style) view mode, and "— Split —" handling.
- **Validated write path** — every change is re-parsed and must balance before
  it is saved; the read-only sample aside, nothing invalid is written.
- **Server-side storage** via a store abstraction: filesystem locally,
  **Vercel Blob** in production (durable across deploys).
- **3-year sample dataset** (~9,000 balanced transactions) for a services firm,
  with a generator script.
- **Phase 0 correctness fixes:** balance sheet now balances (net income closed
  into equity) and all money math uses integer cents to avoid float drift.
- Deployed on Vercel via GitHub integration.
