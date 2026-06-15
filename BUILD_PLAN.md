# BeanBooks → Cloud-Accounting-Alternative Build Spec (Plain-Text / Beancount Architecture)

**Goal:** Evolve BeanBooks from a browser-local Beancount ledger into a multi-user, cloud bookkeeping platform with professional workflows — **without a relational database.** The Beancount text file remains the single source of truth.

**Constraints:** Serverless on Vercel. Next.js App Router (already in repo). Plain-text accounting is the architecture, not just the export format.

**Core principle:** *The `.beancount` file IS the database.* Reports, balances, and aging are all computed by parsing the ledger. No Postgres. We lean into the plain-text story — auditability, portability, zero lock-in — and engineer honestly around its two hard problems: **concurrency** and **where document/workflow state lives.**

---

## Stack decision (as of June 2026)

- **Source of truth:** One `.beancount` file (or an included set) per entity, stored in **a Git repository** (recommended) or **Vercel Blob**. Git is preferred — it gives version history, diffs, and a complete audit log *for free*, which is otherwise Phase-5 work.
- **Parser / query engine:** Beancount's own ecosystem is Python. The JS-side parsers (`beancount-parser`, `costflow`) are partial. **Recommendation: a small Python sidecar service** (Beancount + beanquery) deployed as a Vercel Python serverless function (or a separate container on Fly/Railway if cold starts hurt). It parses the file and answers report/balance/query requests. The Next.js app never parses Beancount itself; it calls this service.
- **Auth:** Better Auth — login + org/role model. Sessions in a tiny KV store (see below), not Postgres.
- **App/workflow state** (the part that is *not* accounting): a lightweight key-value/document store — **Vercel KV (Redis) or SQLite-on-Blob / Turso** — holds invoice status, bank-review flags, customer/vendor records, reconciliation state. This is deliberately minimal; see "The honest boundary" below.
- **Write coordination:** a **single-writer queue** per entity (Vercel KV lock or a serialized queue) so two writers never append to the same file at once. This is mandatory — it's the #1 failure mode of plain-text accounting at multi-user scale.
- **File storage for attachments:** Vercel Blob.

---

## The honest boundary: what lives in the ledger vs. a sidecar

Beancount stores **transactions**, not **documents**. An invoice is more than a journal entry — it has a status (draft → sent → paid), a due date, line items, a PDF, an email history, a customer link. Bank-feed transactions have a *review* state. Reconciliations have a *cleared/locked* state. None of that is accounting; it's workflow.

So we split cleanly:

| Concept | Lives in | Why |
|---|---|---|
| Transactions, postings, balances | **Beancount file** | It's the accounting truth; this is the whole point |
| Accounts (chart of accounts) | **Beancount file** (`open` directives) | Native Beancount |
| Customers / vendors | Beancount metadata + **sidecar** | Names can be Beancount metadata; contact info/terms in sidecar |
| Invoice / bill **as a posted transaction** | **Beancount file** | The A/R or A/P entry is real accounting |
| Invoice **status, due date, line items, PDF** | **Sidecar** | Workflow state, links to the txn by id metadata |
| Bank-feed raw txns + review state | **Sidecar** (until categorized) → **ledger** (once posted) | Unreviewed items aren't accounting yet |
| Reconciliation cleared/locked state | **Sidecar** + Beancount `balance` assertions | Beancount has `balance` assertions; review state is workflow |
| Audit log | **Git history** (free) | Plain text is diffable |

The discipline: **every transaction is written to the Beancount file through one balanced-posting service**, and each gets a stable id in metadata (`; id: "inv_123"`) so the sidecar can link workflow state to it. The sidecar never holds money; if you deleted the entire sidecar, the books would still be complete and correct.

This keeps the plain-text soul intact while making cloud accounting-style documents possible. It is a hybrid in practice, but the **accounting is 100% plain text** and the sidecar is pure workflow glue.

---

## Architecture diagram

```
  Browser (Next.js React app)
        │  server actions / API routes
        ▼
  Next.js on Vercel ───────────────► Better Auth (login, orgs, roles)
        │
        ├──► Single-writer QUEUE (Vercel KV lock, per entity)
        │         │  serialize all writes to a given ledger
        │         ▼
        │    Git repo  (entity.beancount + included files)   ◄── audit log = git history
        │         ▲
        │         │ read file
        ├──► Python PARSER SERVICE (Beancount + beanquery)
        │         returns: balances, P&L, BS, aging, GL, trial balance
        │
        └──► SIDECAR store (Vercel KV / Turso)
                  invoice status · bank-review state · customer/vendor info
                  · reconciliation state · recurring templates
                  (links to ledger txns by id metadata — never holds money)

  Attachments → Vercel Blob
```

---

## Data representation (plain-text, not tables)

**Ledger file (source of truth):**

```beancount
option "title" "Acme Co"
option "operating_currency" "USD"

2026-01-01 open Assets:Bank:Checking         USD
2026-01-01 open Assets:AccountsReceivable    USD
2026-01-01 open Income:Sales                 USD

; an invoice, posted as a real A/R transaction
2026-02-04 * "Bright Dental" "Invoice 1014"
  id: "inv_1014"
  due: "2026-03-06"
  customer: "Bright Dental"
  Assets:AccountsReceivable    1250.00 USD
  Income:Sales                -1250.00 USD

; the payment that clears it
2026-02-20 * "Bright Dental" "Payment for INV 1014"
  id: "pmt_88"
  applies_to: "inv_1014"
  Assets:Bank:Checking         1250.00 USD
  Assets:AccountsReceivable   -1250.00 USD

; reconciliation checkpoint
2026-02-28 balance Assets:Bank:Checking  18432.10 USD
```

**Sidecar record (workflow only, links by id):**

```json
{ "type": "invoice", "id": "inv_1014", "status": "paid",
  "lines": [{ "item": "Cleaning", "qty": 1, "rate": 1250.00 }],
  "pdf_blob": "https://.../inv_1014.pdf", "emailed_at": "2026-02-05T..." }
```

A/R balance, aging, and P&L all come from **parsing the ledger** — the sidecar is never summed for money. Invoice *status* and *line items* come from the sidecar. Two queries, one truth.

---

## Phased roadmap

### Phase 0 — Foundation & correctness (≈1–2 weeks)

1. **Fix the balance-sheet equity close (correctness bug).** Net income currently never rolls into equity → Assets ≠ L + E. With Beancount this is actually *easier*: Beancount handles equity/retained-earnings closing natively via `close`/period conventions. Adopt Beancount's own balance model rather than the hand-rolled one. **Trust-critical — do first.**
2. **Money as integer minor units in app code** (Beancount itself uses decimals correctly; the bug is in the current JS float math). Format only at the edge.
3. **Stand up the storage + parser spine:** Git repo per entity, the Python Beancount parser service, the single-writer queue, and Better Auth. Wire the empty `db/`/`worker/` folders to this (not to Postgres).
4. **Migrate off localStorage:** the app reads/writes the ledger file via the queue + parser instead of `localStorage`. Keep the rich sample as a seed `.beancount` file.
5. **Org / multi-user / roles** with the single-writer queue making concurrent use safe.

**Exit criteria:** Two users in one org edit the same ledger safely (serialized writes), reports come from the parser, balance sheet balances, git history shows every change.

### Phase 1 — Money in: customers & invoices (≈2–3 weeks)

1. Customers (name as ledger metadata; contact/terms in sidecar) + customer detail (open balance from parser).
2. Items/products & services catalog (sidecar).
3. **Invoices:** UI creates a balanced A/R transaction in the ledger (`id` metadata) **and** a sidecar record for status/lines/PDF. Send via email (Vercel Queue + Resend/Postmark). PDF to Blob.
4. **Customer payments:** balanced transaction with `applies_to` metadata; supports partial/split by writing one txn per application. Sidecar updates invoice status.
5. **Estimates** (sidecar-only until accepted; on accept, generate the invoice txn).
6. **A/R aging** computed by the parser service from open A/R postings + `due` metadata.

**Exit criteria:** Invoice → email → record payment → A/R aging, all with the ledger as truth and no journal-entry typing.

### Phase 2 — Money out: vendors, bills & expenses (≈2 weeks)

Symmetric to Phase 1, posting to `Liabilities:AccountsPayable`. Vendors (+1099 flag in sidecar), bills, bill payments (`applies_to`), quick expenses, **A/P aging** from the parser.

### Phase 3 — Banking & reconciliation (≈3 weeks)

1. **Bank import:** keep the existing Excel/CSV paste-import (already strong); add Plaid/Teller for live feeds. Raw imported rows land in the **sidecar** as `unreviewed` — they are *not yet* in the ledger.
2. **Categorization workspace:** accept a suggested category, recategorize, or **match** to an existing ledger txn. Accepting writes a balanced transaction into the ledger (via the queue) and flips the sidecar row to `categorized`.
3. **Bank rules** (sidecar): "Adobe → Software," auto-applied on import.
4. **Reconciliation:** use Beancount **`balance` assertions** as the native reconciliation primitive — tick cleared items, drive difference to zero, then write a `balance` directive + lock the period in the sidecar.

**Exit criteria:** Connect/import a bank, categorize with rules, reconcile to a statement using `balance` assertions.

### Phase 4 — Reporting depth (≈2 weeks)

Lean on **beanquery** in the parser service — this is where plain-text shines, because beanquery is a real query language over the ledger.

1. **P&L / Balance Sheet** with comparative periods, % of income, **cash vs. accrual** (Beancount supports both), drill-down to the underlying postings.
2. **Cash Flow, General Ledger, Trial Balance, Journal** — largely beanquery queries.
3. **Sales tax** tracking via tax accounts + a liability report.
4. Export: keep first-class **Beancount export** (trivial — it's the source), plus Excel/PDF/CSV.

**Exit criteria:** Comparative + accrual/cash reports with click-through to ledger postings.

### Phase 5 — Platform polish & retention (≈2–3 weeks)

1. **Dashboard** (cash, unpaid invoices, overdue bills, to-review count).
2. **Recurring transactions** via Vercel Cron → writes to ledger through the queue.
3. **Attachments** (Vercel Blob), linked by `id` metadata.
4. **Audit log UI** — render git history of the ledger (mostly free).
5. **1099 tracking & year-end** (vendor flags + parser query).
6. **Books-lock / closing date** via Beancount's period mechanisms.

### Phase 6 — Stretch / differentiation

- **cloud-accounting interop via the available connector:** import an existing chart of accounts + history → generate a `.beancount` file. "Switch from your cloud accounting tool and own your books as text" is the wedge.
- Multi-currency (Beancount is natively strong here — an advantage over the Postgres path).
- Inventory/COGS (Beancount has lot/cost-basis support built in — another native advantage).
- Class/location/project via Beancount metadata + beanquery.
- Payroll via partner API.

---

## Plain-text vs. Postgres: the tradeoffs you're accepting

**You gain:**

- The accounting layer is 100% plain text — coherent with what BeanBooks already is.
- **Free audit log + time travel** via Git history (a whole Postgres-plan phase, eliminated).
- Strong **multi-currency and cost-basis/inventory** support comes built into Beancount.
- **beanquery** gives a real report query language without building one.
- A genuine brand wedge: *"your books are a text file you own."*
- No schema migrations, no ORM.

**You pay:**

- **Concurrency is a hard wall.** Must build the single-writer queue per entity. Plain-text tools are historically single-user for this reason; the queue is non-negotiable.
- **No indexed queries.** Every report parses the ledger. Fine to ~tens of thousands of txns; beyond that you'll need a **parsed-ledger cache** (memoize the parse, invalidate on write) — effectively a read-model, i.e. half a database for *reads only*.
- **Parser is Python.** JS Beancount parsers are partial, so you run a Python sidecar service (extra moving part, cold-start latency on serverless).
- **A sidecar store is unavoidable** for document/workflow state — so it's a hybrid, just one where money never leaves the text file.
- **Edits/voids mean rewriting the file**, since Beancount is append-oriented. Manageable, but more care than UPDATE-a-row.

**Net:** for a *technical / accountant-facing* product that prizes auditability and ownership, plain-text is a strong, differentiated choice. If the target later shifts to *mass-market, high-volume, heavy-concurrency* cloud accounting replacement, the parsed-ledger cache + write queue will grow until a database starts to look appealing again — at which point Beancount cleanly becomes the export/interchange format. Designing the parser service and sidecar boundary well now keeps that door open without forcing it.

---

## Recommended first sprint (concrete)

1. **Fix the balance-sheet close** by adopting Beancount's native equity/closing model + **kill the JS float math**. Do this in the current app first.
2. **Stand up the spine:** Git-repo-per-entity storage, the Python Beancount parser service, the single-writer write queue, Better Auth.
3. **Move the app off localStorage** to read/write the ledger file through the queue + parser, keeping the sample as a seed file.
4. **Define the id-metadata + sidecar contract** (every txn gets a stable `id`; sidecar links by it) before any document features — this boundary is the foundation everything else depends on.

---

## Notes & risks

- **Refactor the single-file app early.** ~1,000 lines of vanilla JS in one route handler won't scale to this; restructure into React components + server actions before Phase 1.
- **The write queue is the make-or-break.** Get serialization and failure/rollback right (write to a temp file, parse-validate, then commit to git) so a crashed write can't corrupt the ledger.
- **Validate on every write:** parse the proposed ledger *before* committing; reject anything that doesn't balance or doesn't pass Beancount's own checks. The parser service is also your validator.
- **Parser cold starts:** if the Python function is slow to wake, move it to an always-warm container (Fly/Railway) or cache parsed results in KV.
- **The sidecar must never hold money.** If it ever becomes a place balances are computed from, the plain-text guarantee is broken. Enforce this as an architectural rule.

---

### Sources

- [Awesome Beancount](https://awesome-beancount.com/)
- [costflow — npm](https://www.npmjs.com/package/costflow)
- [Fava / beanquery — Fava docs](https://beancount.github.io/fava/api/fava.core.html)
- [Beancount.io — Plain-Text Accounting](https://beancount.io/docs/Solutions/scriptable-workflows)
- [I tested every major auth library for Next.js in 2026 — LogRocket](https://blog.logrocket.com/best-auth-library-nextjs-2026/)
