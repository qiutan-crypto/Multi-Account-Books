# FiveStar — Multi-Bank Edition

A plain-text general ledger accounting workspace with professional financial
reports (P&L, P&L Detail, Balance Sheet) that you fully own.

**Open source for non-commercial use.**

## What this fork adds (multi-bank + categorizer features)

This copy extends the original plain-text GL app with features merged from the
[Bank Transaction Categorizer](https://qiutan-crypto.github.io/BankTransactionCategorizer/):

- **Multi-account Bank Feed** — load ONE Excel/CSV file containing transactions
  for MANY bank accounts (like QuickBooks Online). A column-mapping step lets
  you pick which columns are Date, Description, Amount (or Debit/Credit),
  **Account**, **Category**, Payee and Ref. Each statement account is mapped to
  a ledger account (mappings are remembered). Pre-categorized files post as-is.
- **Transfer detection** — a transaction categorized to another bank account is
  a transfer; the mirror row in the other account's statement is detected (in
  the batch AND against the ledger) and skipped, so transfers are never posted
  twice. Re-importing the same file skips duplicates via row fingerprints.
- **Rules** — QuickBooks-Online-style classification rules: contains / doesn't
  contain / starts with / exact / regex text matching (comma-separated
  alternatives), money in/out, amount conditions (=, <, >, between), optional
  per-bank-account scope, priority ordering, and optional payee assignment.
  Rules apply automatically when a file loads, or on demand. Import/export as
  JSON or `keyword,category` CSV.
- **Reclassify** — filter posted transactions by category / date / text, select
  many (shift-click ranges), and move them to a different category in bulk.
- **Reconcile** — per-account statement reconciliation: enter the statement's
  beginning/ending balances (remembered), compare against ledger activity with
  payments/deposits totals, a monthly summary, and per-month transaction lists.
- **Chart of Accounts import/export** — load a COA from CSV/Excel (Account
  Name / Type / Description columns; friendly names are normalized to ledger
  accounts), extract accounts referenced by transactions, export the COA as
  CSV, and keep per-account descriptions.
- **QuickBooks Desktop exports** — Chart of Accounts IIF (with inferred
  QuickBooks account types), Journal Entries IIF, per-account **.qbo** Web
  Connect files (Bank/Credit-card + last-4), and a classified-transactions
  Excel.
- **Supabase storage** — set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (see
  `.env.example`) and run `supabase/schema.sql` once in the Supabase SQL
  editor; ledgers and app data are then stored in your Supabase project (works
  locally and on Vercel). Without Supabase, it falls back to Vercel Blob (on
  Vercel) or local files under `data/` (local dev).

Because every bank account is just a ledger account, **all reports (P&L,
Balance Sheet, Trial Balance, …) automatically combine the activity of all
bank accounts** — no extra setup.

## What this is

This is the source for FiveStar, a multi-account bookkeeping app built around a
plain-text general ledger.

The real point is for you to **download this, make it your own, and run it
yourself.** Fork it, rename it, change the accounts, restyle it — it's yours.

## Built to work with

- **[Claude Code](https://claude.com/claude-code)** — edit and extend the app in plain English
- **[GitHub](https://github.com)** — store and version your own copy
- **[Vercel](https://vercel.com)** — deploy and host it for free

## Quick start

```bash
npm install
npm run dev      # local development
npm run build    # production build
```

Then push your copy to GitHub and connect the repo to Vercel to go live.

## Deploying to Vercel with Supabase

1. Create a Supabase project, open the SQL editor, and run
   `supabase/schema.sql` once (creates the `plaingl_ledgers` table).
2. In Vercel → Project → Settings → Environment Variables, add
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (from Supabase → Project
   Settings → API). Optionally add `ADMIN_PASSWORD`.
3. Deploy. The same env vars in a local `.env.local` make local dev use
   Supabase too; without them, local dev stores files under `data/`.

## Where things live

- `app/` — the site code
- `public/` — static assets
- `next.config.ts` — Next.js configuration
- `vercel.json` — Vercel deployment settings

## License

Free to use, modify, and self-host for **non-commercial** purposes.
Commercial use is not permitted.
