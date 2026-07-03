# BeanBooks — Change Log

All notable changes to BeanBooks, by version. Entries authored from the build
chat are credited to **Hector Garcia, CPA**.

The format groups changes under each version. Versions follow `0.0.0x` for now.

---

## v1.0.28 — 2026-07-03
**Author:** Hector Garcia, CPA

Admin-gated "Reseed sample data" button to refresh a stale hosted sample.

### Added — Reseed sample (`app/Shell.tsx`, `app/actions.ts`)
- **"↻ Reseed sample data"** button in the sidebar footer, shown only in **Admin
  mode**. Overwrites the read-only **Sample Company** with the current bundled
  ledger (`SAMPLE_LEDGER`) via the existing `reseedSample()` action — which was
  previously defined but not reachable from the UI. User companies are untouched.

### Why
- Production (plainGL.com) uses the **Vercel Blob** store, which seeds the sample
  **only when the store is empty** (`lib/store/blob.ts`) and never updates it
  afterward. The live sample was seeded before COGS accounts existed (v1.0.22),
  so the hosted Chart/reports showed no COGS. Reseeding replaces it with the
  current bundled sample (which includes the three COGS accounts).

### Ops / deploy note
- The Admin gate reads `ADMIN_PASSWORD` (env var; never in the repo). Set it in
  **Vercel → Settings → Environment Variables** and redeploy for the live site.
  Then: enable Admin mode → **Reseed sample data** → COGS appears in the hosted
  sample. Locally, set it in `.env.local` (gitignored).

### Notes
- Version label → **v1.0.28**. Build clean; 23/23 tests pass. Verified locally:
  admin login succeeds, the reseed button runs and reports success.

### Where to pick up next (open items)
1. **Chart parent drill** — group subtotal → Ledger for the account + sub-accounts.
2. **Bank feed rules/memory** and **duplicate detection**.
3. **Paste-import robustness** — `Expense` vs `Expenses`, spaces after `:`.
4. **CSV export ref column** on the Export section.

---

## v1.0.27 — 2026-07-03
**Author:** Hector Garcia, CPA

Navigation rename + a combined Import/Export tab, plus click-to-drill from the
Chart of Accounts into the Ledger.

### Changed — navigation (`app/Shell.tsx`)
- Renamed tabs: **Dashboard → Dash**, **Reports → Summary**,
  **Statements → Reports**, **Data entry → Ledger**, **Journal Entry → Journal**.
  (Chart and Bank Feed unchanged.) The default landing tab is now **Reports**
  (the statements view), and the statement drill-through opens the **Ledger** tab.
- **Paste import** and **Export** merged into a single **Import/Export** tab —
  the import (paste) section on top, the export section below.

### Added — Chart drill-down (`app/ChartView.tsx`, `app/Shell.tsx`)
- In the **Chart** tab, every real (postable) account's **balance is clickable**
  and opens that account in the **Ledger**, filtered to it with no date range
  (all dates). Reuses the same register-focus mechanism as the Reports drill.
  Group subtotal rows stay non-clickable (a subtotal isn't a single account).

### Notes
- Version label → **v1.0.27**. Build clean; 23/23 engine tests pass. Verified in
  the browser: all renamed tabs route correctly, Import/Export stacks both
  sections, and clicking a Chart balance lands on the Ledger filtered to that
  account across all dates.

### Where to pick up next (open items)
1. **Chart parent drill** — optionally let a group subtotal open the Ledger for
   the account *and all its sub-accounts* (needs prefix-match register filtering).
2. **Bank feed rules/memory** and **duplicate detection**.
3. **Paste-import robustness** — `Expense` vs `Expenses`, spaces after `:`.
4. **CSV export ref column** on the Export section.

---

## v1.0.26 — 2026-07-03
**Author:** Hector Garcia, CPA

Bank Feed becomes a full working feed (payee, ref, filter, sort, splits,
select-to-post), plus an in-app refresh button.

### Added — Bank Feed enhancements (`app/BankFeedView.tsx`, `app/actions.ts`, `lib/beancount/import.ts`)
- **Payee** — editable per row, and imported when the CSV has a
  Payee/Vendor/Customer column (posts to the transaction's payee). Most bank
  exports have only a Description, so payee is otherwise blank to fill in.
- **Reference number** — now an editable per-row field (still imported from a
  Ref/Reference/Check column → `meta.ref`).
- **Filter** — show **Money in / Money out / All** (default All) by amount sign.
- **Sort** — Original order (default), Date, Description, or Amount.
- **Split** — split any row into multiple category lines with their own amounts;
  a live "remaining / balanced ✓" indicator enforces that splits sum to the row
  total. A split posts as one balanced transaction (source + N category legs).
- **Select to post** — per-row checkboxes with **shift-click range select**, a
  master checkbox, and **Select all / none** that respect the current filter.
  Only selected rows post; the rest stay in the feed (post a few at a time).
- **Flip signs** now also negates any typed split amounts so splits stay balanced.
- Engine: `parseBankRows` gains a `payee` field; `commitBankFeed` takes
  `payee` + a `splits[]` array (must sum to the row amount) instead of a single
  category.

### Added — App shell
- **Refresh button** next to the company name in the toolbar. Re-pulls the active
  company's data (Dashboard, Reports, Statements, Chart, Export refetch) without a
  browser reload; brief spin for feedback. Editing surfaces (Data entry, Journal
  Entry, Bank Feed) are intentionally left intact so a refresh never discards
  in-progress work. `Shell.tsx` (toolbar button + `dataVersion` bump), `app.css`.

### Notes
- Version label → **v1.0.26**. Build clean; **23/23** engine tests pass (added a
  payee-column parser test). Bank-feed flows verified end-to-end in the browser:
  payee/ref import + edit, In/Out/All filter, all four sorts, a 3-leg split that
  ties out, shift-click range select, Select-all respecting the filter, and
  posting a subset while the rest remain in the feed.

### Where to pick up next (open items)
1. **Bank feed rules/memory** — remember description→category for repeat payees.
2. **Bank feed duplicate detection** — warn when a row looks already-imported.
3. **Paste-import robustness** — `Expense` vs `Expenses`, spaces after `:`.
4. **CSV export ref column** on the main Export tab.

---

## v1.0.25 — 2026-07-03
**Author:** Hector Garcia, CPA

A modern theme, columnar (by-period) financial statements, and a QuickBooks-style
bank-feed CSV importer.

### Added
- **"Modern View" theme** — a fifth theme in the Theme picker (alongside Default,
  Pretty, Dark, America 250). Not just a recolor: near-black ink on a cool
  off-white canvas with an electric-violet accent, plus fully redesigned controls
  — pill buttons with hover-lift / press / focus-ring micro-interactions,
  segmented-pill tabs, elevated cards, accent-topped metric tiles, and rounded
  inputs with a soft focus ring. `body.modern` block in `app/app.css`; wired
  through `app/Shell.tsx` (state, localStorage, body-class, dropdown).
- **Statements by columns — By Month / Quarter / Week.** Profit & Loss and Balance
  Sheet gain a **Columns** control that renders one column per period across the
  selected date range.
  - **P&L** columns show the activity within each period, with a trailing **Total**
    column (columns sum to the total).
  - **Balance Sheet** columns show the balance **as of** each period end
    (cumulative), no total column; each column balances independently.
  - Weeks are Monday-anchored (ISO); first/last periods clip to the range; capped
    at 80 columns with a notice. Wide reports scroll horizontally with a sticky
    account column; the Columns and Compare controls are mutually exclusive.
  - Engine: `profitAndLossPeriods` / `balanceSheetPeriods` in
    `lib/beancount/statements.ts` (array-per-row, single-column path untouched);
    action `getStatementsByPeriod` + period slicing in `app/actions.ts`; UI in
    `app/StatementView.tsx`.
- **Bank Feed (CSV import), QuickBooks-style.** New **"Bank Feed"** tab: upload a
  bank/credit-card CSV (`Date, Description, Amount, Ref`), pick the one constant
  **source account**, choose a **category per row** (any account; default
  `Expenses:Uncategorized`), then push to the ledger.
  - One signed Amount column: negative = money out (credits the source, debits the
    category), positive = money in (a deposit). A **Flip signs** toggle handles
    credit-card exports that invert the convention. Ref → `meta.ref`.
  - Bulk **"set all categories"** helper; live money-in / money-out footer; the
    read-only Sample is rejected; new categories are auto-opened on commit.
  - Pure, tested parser `parseBankRows` in `lib/beancount/import.ts`; action
    `commitBankFeed` in `app/actions.ts`; view `app/BankFeedView.tsx` (file upload
    is net-new — first upload flow in the app). The view is keyed by entity so it
    resets cleanly when switching companies.

### Notes
- Version label → **v1.0.25**. Build clean; **24/24** engine tests pass (added
  `parseBankRows` cases and P&L/BS by-period tie-out tests that prove the columns
  sum/agree with the single-column statements).
- Deferred by design on the bank feed: description→category memory/rules and
  duplicate-transaction detection — good follow-ups.

### Where to pick up next (open items)
1. **Bank feed rules/memory** — remember description→category so repeat payees
   auto-fill (needs per-entity rule storage).
2. **Bank feed duplicate detection** — warn when a row looks already-imported.
3. **Paste-import robustness** (still open from v1.0.24) — friendlier handling of
   `Expense` vs `Expenses` and spaces after `:` in `lib/beancount/import.ts`.
4. **CSV export ref column** on the main Export tab.

---

## v1.0.24 — 2026-07-03
**Author:** Hector Garcia, CPA

New raw **Journal Entry** screen with multi-line debit/credit, CSV export &
paste import, plus an editable **Ref #** on every transaction.

### Added
- **"Journal Entry" tab** (new tab between *Data entry* and *Chart*).
  Component: `app/JournalEntryView.tsx`; server action: `addJournalEntry` in
  `app/actions.ts`.
  - **Multi-line entry** starting with **2 lines**, each with an **Account**
    field (autocomplete from the entity's chart of accounts via a `<datalist>`)
    and separate **Debit** and **Credit** columns. **+ Add line** adds rows;
    **✕** removes them (2-line minimum).
  - **Balance enforcement.** A live Totals/balance footer shows total debits,
    total credits, and the out-of-balance amount. **Post is disabled until
    debits = credits.** The server also re-validates the whole ledger through
    the Beancount engine before saving, and auto-opens any account you typed
    that doesn't exist yet.
  - **Scope: one entry at a time** (per the design decision this session) — the
    screen builds/imports a single journal entry, no multi-entry grouping.
  - **Export CSV** — downloads the current on-screen entry as
    `journal-entry-<date>.csv`.
  - **Paste / import CSV** — a toggle panel that accepts Excel (tab-separated)
    or CSV, auto-detects a header row (or falls back to `Account, Debit, Credit`
    order), and loads the lines into the entry for review before posting.
    CSV columns: `Date, Ref, Payee, Memo, Account, Debit, Credit`.
- **Ref # / transaction number** on every transaction, stored as Beancount
  metadata (`ref: "…"`), which round-trips through parse/serialize like the
  internal `id`.
  - Editable on the **Journal Entry** screen (header field + `Ref` CSV column).
  - Editable on **existing** transactions in the **Ledger/register** edit row
    (`app/RegisterView.tsx`) — add, change, or clear it; internal `id` and other
    metadata are preserved. `updateTransaction` now accepts `ref`.
  - Displayed without editing: a `Ref <n>` pill in the grouped register view and
    a `[<n>]` memo prefix in the single-line (Excel) view. `RegisterRowDTO` now
    carries `ref`.

### Changed
- Tab/heading capitalization: **"Journal Entry"** (capital E) in the tab label,
  screen heading, and success message.
- `.claude/launch.json` — added `"autoPort": true` so a preview server can fall
  back off port 3000 when it's occupied by another session.

### Notes
- Version label → **v1.0.24**. (v1.0.23 was a throwaway test bump only.)
- `tsc --noEmit` clean; **18/18** engine tests pass; verified the `ref` metadata
  survives a serialize→parse round-trip. Live browser click-through was **not**
  done this session because a concurrent dev server held the project's dev port
  (Next refuses a second dev instance in the same dir) — the running server
  hot-reloads the changes, but preview tooling couldn't attach.
- The **Ref #** is free-text (e.g. `JE-1001`); it is **not** auto-incremented or
  enforced-unique.

### Where to pick up next (open items, not yet done)
1. **Importer robustness (Paste import tab).** A user paste failed with
   *"account without a valid root: … / Expense:Advertising"*. Two data-shape
   gaps in `lib/beancount/import.ts` + `commitImport`:
   - Offset root `Expense` (singular) is rejected — valid roots are
     `Assets, Liabilities, Equity, Income, COGS, Expenses`. Consider a clearer
     error that lists valid roots and suggests `Expenses` for `Expense`
     (v1.0.21 already auto-aliases singular roots when *adding* an account — the
     paste path should do the same).
   - `Income: Sales` (space after colon) would fail as an invalid segment —
     consider auto-trimming spaces around `:` on import.
   - Decision still open: auto-correct vs. friendlier-error-only. (Leaning:
     alias safe roots + trim spaces, but don't silently "fix" unknown roots.)
2. **Auto-numbered Ref #** and/or a **uniqueness check** — not built; explicitly
   left as free-text for now.
3. **Ref column on the main Export tab** (`app/ExportView.tsx`) — the Journal
   Entry screen exports Ref, but the whole-ledger Export doesn't surface it.
4. **CHANGELOG discipline** — this entry (v1.0.24) is the version-of-record for
   the Journal Entry + Ref work.

---

## v1.0.22 — 2026-07-03
**Author:** Hector Garcia, CPA

Cost of Goods Sold is now a major account category, plus a new theme.

### Added
- **COGS as a top-level account type.** Cost of Goods Sold is now a first-class
  account category alongside Assets, Liabilities, Equity, Income, and Expenses
  (modeled the way QuickBooks treats it) — not a sub-account buried under
  Expenses.
  - **Profit & Loss** breaks the `COGS` root into its own **Cost of Goods Sold**
    section and computes **Gross Profit = Income − COGS**, above Expenses, then
    Net Operating Income. The P&L Detail report and drill-down filter include
    COGS too.
  - **Add account** now offers **COGS** as a selectable Type, so users can
    create their own COGS accounts.
  - Balance Sheet and Trial Balance recognize the new root and still balance;
    the legacy `Expenses:COGS:*` naming continues to work.
- **"America 250" theme** — a red/white/blue (Old Glory) skin, joining Default,
  Pretty, and Dark in the Theme picker.

### Sample data
- The Sample Company's 2025 COGS now totals **$6,150,685**, distributed across
  three real COGS accounts: **Outsourced Labor** ($2,750,000), **Job Materials**
  ($2,400,685), and **Direct Software/Equipment Cost** ($1,000,000), replacing
  the old single "Direct Costs" demo account.

### Notes
- Version label → v1.0.22. Build clean; 18/18 engine tests pass (added a
  top-level-COGS test).

---

## v1.0.21 — 2026-06-15
**Author:** Hector Garcia, CPA

Friendlier account names in the Chart of Accounts (auto-normalize).

### Changed
- **Adding an account now accepts plain-English names and normalizes them**
  instead of rejecting them. Beancount requires each `:`-segment to be a single
  CamelCase token with no spaces, and the root to be one of
  Assets/Liabilities/Equity/Income/Expenses — so the form now:
  - **Removes spaces and capitalizes each word** per segment, e.g.
    `Chase Checking` → `ChaseChecking`.
  - **Accepts singular/alias roots**, e.g. `Asset:` → `Assets:`,
    `Liability:` → `Liabilities:`, `Revenue:` → `Income:`.
  - So the reported case, **`Asset:Chase Checking`**, now creates
    **`Assets:ChaseChecking`** cleanly.
- The live "Will create:" preview shows the normalized name before you save,
  and the field hint explains the space/colon rules.

### Notes
- Validation still rejects truly invalid input (no recognizable root, empty
  segments). This only auto-fixes the safe, common cases.
- Version label → v1.0.21. Build clean; 17/17 engine tests pass.

---

## v1.0.20 — 2026-06-15
**Author:** Hector Garcia, CPA

Visible sub-account structure in the Chart of Accounts + a Trial Balance report.

### Added
- **Chart of Accounts now shows a parent → sub-account tree.** Instead of one
  flat row per full account path, accounts render hierarchically: parent rows
  in bold with their sub-accounts **indented** beneath them. Parent rows show a
  **rolled-up balance** (the account plus all of its sub-accounts); a parent
  that also has its own postings is labeled "postable". Leaf accounts keep the
  Type pill and Remove button.
- **New sample sub-accounts** to demonstrate the structure, each with a few
  2025 entries so they carry real balances:
  - `Income:Sales:Products` ($101,950) and `Income:Sales:Services` ($80,650)
  - `Expenses:Office:Supplies` ($5,530) and `Expenses:Office:Software` ($9,800)
- **Trial Balance report** as a fourth option in the Statements tab (next to
  P&L, P&L Detail, Balance Sheet). Lists every account with a nonzero balance
  in a **Debit** or **Credit** column, sub-accounts indented under parents, with
  a **TOTAL** row. Honors the date range and prints via the same Print/Save PDF
  layout. Clicking an account opens its activity in the register.

### Notes
- New engine `trialBalance()` + `getTrialBalance` action; covered by a new test
  asserting debits = credits and one-sided placement (17 tests total).
- Verified on the sample: trial balance ties exactly (full period
  $16,780,099 = $16,780,099; FY2025 $7,356,733 = $7,356,733). 0 parse errors,
  0 unbalanced transactions.
- Version label → v1.0.20. Build clean.

---

## v1.0.19 — 2026-06-15
**Author:** Hector Garcia, CPA

Sample data: COGS category with a Direct Costs account (~$4M in 2025).

### Added
- **New `Expenses:COGS:DirectCosts` account** in the sample chart of accounts.
  The `COGS` segment makes it a Cost of Goods Sold category, so the statement
  engine renders it under **Cost of Goods Sold** and feeds **Gross Profit**.
- **Six explicit 2025 direct-cost payments** (subcontractors/materials) posted
  to `Expenses:COGS:DirectCosts` and paid out of `Assets:Bank:Checking`,
  totaling **$4,050,000**. Deterministic and balanced.

### Notes
- Regenerated `lib/store/sample.beancount` + `sample-data.ts`
  (`npx tsx scripts/gen-sample.mts`). Verified: 0 parse errors, 0 unbalanced
  txns; 2025 P&L shows COGS → Direct Costs = $4,050,000 and Gross Profit ties.
- Version label → v1.0.19. Build clean; 16/16 engine tests pass.

---

## v1.0.18 — 2026-06-15
**Author:** Hector Garcia, CPA

First-load defaults: Sample Company · Statements · Last year.

### Changed
- **The app now opens on the Statements tab** by default (was Dashboard).
- **Statements default to the "Last year" date range** (last full calendar
  year) on first load, instead of all-dates. The date pickers are pre-filled to
  match, and the first report renders for that range automatically. Picking
  another preset or clearing the range still works as before.
- Combined with v1.0.17, a fresh visit lands on **Sample Company (Read Only) →
  Statements → Last year**.

### Notes
- Version label → v1.0.18. Build clean; 16/16 engine tests pass.

---

## v1.0.17 — 2026-06-15
**Author:** Hector Garcia, CPA

Everyone starts on the read-only Sample Company by default.

### Changed
- **The app now opens on "Sample Company (Read Only)" by default** for every
  visitor, instead of whichever entity happened to sort first. If the sample
  isn't present (unusual), it falls back to the first entity. The active entity
  is not persisted, so each new page load / new visitor starts on the sample.
- Consolidated the hardcoded `"sample-company"` id into a single `SAMPLE_ID`
  constant in the Shell.

### Notes
- Version label → v1.0.17. Build clean; 16/16 engine tests pass.

---

## v1.0.16 — 2026-06-15
**Author:** Hector Garcia, CPA

Made company-file blob URLs unguessable (obscurity hardening).

### Changed
- **Each ledger blob now stores at a random, unguessable path** —
  `ledgers/<id>__<128-bit-token>.beancount` instead of the old
  `ledgers/<id>.beancount`. Previously anyone could fetch a company's data by
  guessing its id in the URL; now the public URL can't be derived from the id.
- **Saves reuse an entity's existing random path** (the id stays durable), and
  a **legacy guessable file is migrated on first save** — the data is rewritten
  to a random path and the old guessable blob is deleted so its URL stops
  working. Listing/loading derive the id from the filename, so existing files
  keep working with no manual migration.

### Security note
- This is **obscurity, not access control.** Vercel Blob only supports
  `access: "public"`, so the files remain technically world-readable *by URL* —
  they're just no longer enumerable. The entity password hashes still live in
  public Blob. Real privacy still requires a private store + server-side auth
  (a future item).
- Version label → v1.0.16. Build clean; 16/16 engine tests pass.

---

## v1.0.15 — 2026-06-15
**Author:** Hector Garcia, CPA

Reworded report and marketing copy to remove third-party brand references.

### Changed
- Reworded all report descriptions, marketing copy, code comments, and docs to
  describe the financial statements as **professional / hierarchical** reports
  rather than referencing a specific third-party accounting product. Affects the
  page metadata/description, the social-preview image tagline, the README, the
  build spec, and the change-log wording. No functional change — statements,
  layouts, and PDF output are identical.

### Notes
- Version label → v1.0.15. Build clean; 16/16 engine tests pass.

---

## v1.0.14 — 2026-06-14
**Author:** Hector Garcia, CPA

Social link previews (Open Graph / Twitter Card).

### Added
- **Open Graph + Twitter Card metadata** so links to the app show a rich
  preview on Facebook, LinkedIn, iMessage, X, etc. Previously the page only had
  a `<title>` and a plain description, so Facebook had nothing to display.
  Adds `og:title`, `og:description`, `og:url`, `og:site_name`, `og:type`, and
  `twitter:card` (summary_large_image), with `metadataBase` set.
- **A 1200×630 preview image** generated by `app/opengraph-image.tsx`
  (`next/og`) — the GL bracket mark, “PlainGL.com”, the tagline, and
  “by Hector Garcia, CPA”. Next.js wires it to both `og:image` and
  `twitter:image`.

### Notes
- After deploying, use Facebook’s **Sharing Debugger**
  (developers.facebook.com/tools/debug) and click **Scrape Again** to refresh
  Facebook’s cache for the URL — it caches the old “no preview” result.
- The og:url currently points at the `beanbooks-codebase.vercel.app` domain;
  update `SITE_URL` in `app/layout.tsx` if the production domain changes.
- Version label → v1.0.14. Build clean; OG tags + image verified.

---

## v1.0.13 — 2026-06-14
**Author:** Hector Garcia, CPA

FEEDBACK / About link; version label set to v1.0.13.

### Added
- A small **FEEDBACK** link under the PlainGL.com brand. Clicking it opens an
  "About PlainGL.com" popup with the trademark notice, the open-source repo
  link (github.com/hexgarcia/plaingl), and information about the REFRAME
  SOCIETY community and the "AI Coding Academy for Accountants" program
  (hectorgarcia.com/ai). External links open in a new tab.

### Notes
- Version label set to **v1.0.13**, shown in a smaller font next to the
  FEEDBACK link. Build clean; 16/16 tests pass.

---

## v0.0.12 — 2026-06-14
**Author:** Hector Garcia, CPA

Admin password moved out of the code into a server-side environment variable.

### Changed
- **The admin password is no longer hardcoded.** It was a literal in client
  code (visible in the public GitHub repo and the browser bundle). Now a
  `verifyAdmin(password)` **server action** compares against the
  `ADMIN_PASSWORD` environment variable, so the value never appears in the
  repo or the shipped JavaScript.
- If `ADMIN_PASSWORD` is **not set**, admin mode is **disabled** (the action
  never grants access) — there is no fallback secret in the codebase.

### Setup required
- In Vercel → **Settings → Environment Variables**, add **`ADMIN_PASSWORD`**
  with your chosen value (Production, and Preview/Development as desired), then
  redeploy. Until it's set, the "Admin mode" button will reject every password.

### Notes
- This is a real improvement for secret exposure, but the broader caveat still
  holds: the entity (company-file) password hashes live in **public** Vercel
  Blob, and there is still no server-side login/session. Full protection needs
  private storage + authenticated sessions (a future item).
- Verified: no admin password string remains in source or the client bundle.
  Version label → V. 0.0.12. Build clean; 16/16 tests pass.

---

## v0.0.11 — 2026-06-14
**Author:** Hector Garcia, CPA

Export rework, Admin mode (delete company files), and layout tweaks.

### Added
- **Reworked Export tab.** No longer auto-loads the full ledger — shows just a
  **10-line preview**. You choose the **file type** (`.beancount` or `.txt`)
  and the **scope** (full data file or a **date range**). Date-range exports
  keep the full chart of accounts (`open` directives) and only the
  transactions within the range; the file is built server-side on download.
- **Admin mode** (sidebar footer) unlocked by a password. When on, each
  company file (except the read-only sample) gets a **Delete (✕)** button with
  a confirmation. New `deleteEntity` action removes the file from storage and
  refuses to delete the read-only sample.

### Changed
- **Theme selector moved back to the top** of the sidebar (under the brand).
- **Removed** the "Server-backed ledger · Beancount engine" subtitle from the
  toolbar.

### Security note
- The Admin password gate is **client-side and a deterrent only** — the
  password lives in the app bundle and the delete action performs no
  server-side auth. Real admin access control requires server authentication
  (a future item). Treat Admin mode as a convenience guard, not protection.
- Version label → V. 0.0.11. Build clean; 16/16 engine tests pass.

---

## v0.0.10 — 2026-06-14
**Author:** Hector Garcia, CPA

App renamed to **PlainGL.com** + Balance Sheet drill-down.

### Changed
- **Renamed the app from "BeanBooks" to "PlainGL.com"** — header brand, page
  title/metadata, and README. Storage and ledger config keys keep their legacy
  `beanbooks.*` / `bb_*` prefixes for backward compatibility with existing
  saved data, so no migration is needed.

### Added
- **Balance Sheet drill-down** — click any asset, liability, or equity line on
  the Balance Sheet to open the Data entry register filtered to that account
  (its full activity), mirroring the P&L drill-downs. Section totals
  (Total Assets, etc.) and the Net Income line aren't clickable.

### Notes
- Reuses the cross-tab focus path; a focus with no transaction id means
  "filter the register to this account" (no inline edit opened).
- Build clean; 16/16 engine tests pass. Version label → V. 0.0.10.

---

## v0.0.09 — 2026-06-14
**Author:** Hector Garcia, CPA

P&L Detail account filter + transaction click-through to editing.

### Added
- **Permanent "Account" dropdown on the P&L Detail** — choose "All income &
  expenses" or any specific income/expense account (and parent groups) directly,
  without needing to arrive from a summary click. Drilling from the summary
  P&L simply pre-selects this dropdown.
- **Click any transaction line in the P&L Detail to open it for editing** — it
  switches to the Data entry tab, filters the register to that account, opens
  the transaction's inline edit row, and scrolls it into view.

### Notes
- New action `getPLAccounts` powers the dropdown; detail transaction rows now
  carry their account and id for the click target.
- Cross-tab navigation is threaded Shell → Data entry → register via a focus
  prop that is consumed once applied.
- 16/16 engine tests pass; build clean. Version label → V. 0.0.09.

---

## v0.0.08 — 2026-06-14
**Author:** Hector Garcia, CPA

Drill-down from the summary P&L into a filtered P&L Detail.

### Added
- **Click any income or expense line on the summary Profit & Loss** to open the
  **P&L Detail filtered to just that account** (and its sub-accounts), over the
  same date range. Account, sub-account, and "Total for …" lines are clickable.
- A **drill banner** names the account being viewed with a **"← Full P&L
  Detail"** button to clear the filter; the report title becomes
  **"P&L Detail — <account>"**.
- Engine: `profitAndLossDetail` accepts an optional account filter and returns
  a focused detail (header, transactions with running balance, and a total) for
  that account; `getPLDetail` passes the filter through. Summary statement rows
  now carry their full account path for the click target.

### Notes
- The filtered detail total ties exactly to the clicked summary line (verified:
  Income:Consulting $4,923,886 over FY2025 matches; Expenses:Rent shows its 12
  monthly payments).
- Drill-down is offered on the non-comparative summary P&L; the drill banner is
  hidden when printing. 16/16 engine tests pass. Version label → V. 0.0.08.

---

## v0.0.07 — 2026-06-14
**Author:** Hector Garcia, CPA

Profit & Loss **Detail** report (professional transaction-level P&L).

### Added
- **P&L Detail** as a third statement option on the Statements tab (alongside
  Profit & Loss and Balance Sheet). Each income/expense account expands into
  the individual transactions that compose it:
  - Columns: **Date · Num · Name · Description · Split account · Amount ·
    Balance** (running balance down each account).
  - **Split account** shows the counter-account, or **"— Split —"** for
    transactions with 3+ postings (same logic as the register).
  - Account hierarchy preserved: group headers, indented sub-accounts, a bold
    **"Total for <account>"** after each, and **"Total for <group> with
    sub-accounts"** for parents — then section totals, Gross Profit,
    Net Operating Income, and Net Income.
  - Honors the date range + presets; prints via the same Print / Save PDF
    layout (wider page, repeating column header, "Accrual Basis" footer).
  - Empty columns common accounting tools show but BeanBooks doesn't yet have data for
    (Type, Location, Class, Item) are omitted for a clean report; they can be
    added once invoices/bills and dimensions exist.

### Notes
- The detail's account subtotals and Net Income **tie exactly to the summary
  P&L** by construction (verified for a single month and a full year).
- New engine fn `profitAndLossDetail` + action `getPLDetail`; +1 test
  (16 total, all passing). Version label → V. 0.0.07.

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

professional financial statements with printable / PDF output.

### Added
- **Statements tab** with a professional **Profit & Loss** and
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
  browser's Print → Save as PDF closely matches a professional accounting export.

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
