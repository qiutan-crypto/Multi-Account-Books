const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>BeanBooks</title>
    <meta name="description" content="A browser-local Beancount accounting workspace.">
    <style>
      :root {
        --ink: #171a14;
        --muted: #5c6656;
        --line: #d9ddcf;
        --paper: #fffef9;
        --wash: #f6f6ef;
        --accent: #276c57;
        --accent-2: #8e5f22;
        --bad: #a23c2e;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        background: var(--wash);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      button, input, select, textarea {
        font: inherit;
      }

      button {
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--paper);
        color: var(--ink);
        cursor: pointer;
        min-height: 36px;
        padding: 8px 12px;
      }

      button.primary {
        border-color: var(--accent);
        background: var(--accent);
        color: white;
      }

      button.danger {
        border-color: #e0b6ad;
        color: var(--bad);
      }

      input, select, textarea {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: white;
        color: var(--ink);
        padding: 9px 10px;
      }

      textarea {
        min-height: 148px;
        resize: vertical;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 13px;
        line-height: 1.5;
      }

      .app {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
      }

      aside {
        border-right: 1px solid var(--line);
        background: #eceee3;
        padding: 22px;
      }

      main {
        padding: 22px;
      }

      .brand {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 22px;
      }

      .brand h1 {
        margin: 0;
        font-size: 24px;
        letter-spacing: 0;
      }

      .entity-list {
        display: grid;
        gap: 8px;
        margin: 14px 0 18px;
      }

      .entity {
        width: 100%;
        text-align: left;
      }

      .entity.active {
        border-color: var(--accent);
        background: #dfe9e2;
      }

      .stack { display: grid; gap: 10px; }

      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 18px;
      }

      .tabs {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .tab.active {
        border-color: var(--accent);
        background: #dfe9e2;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 14px;
      }

      .panel {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--paper);
        padding: 16px;
      }

      .span-4 { grid-column: span 4; }
      .span-5 { grid-column: span 5; }
      .span-6 { grid-column: span 6; }
      .span-7 { grid-column: span 7; }
      .span-8 { grid-column: span 8; }
      .span-12 { grid-column: 1 / -1; }

      .panel h2, .panel h3 {
        margin: 0 0 12px;
        letter-spacing: 0;
      }

      .panel h2 { font-size: 20px; }
      .panel h3 { font-size: 16px; }

      .muted {
        color: var(--muted);
      }

      .metric-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }

      .metric {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: white;
        padding: 12px;
      }

      .metric span {
        display: block;
        color: var(--muted);
        font-size: 12px;
      }

      .metric strong {
        display: block;
        margin-top: 6px;
        font-size: 20px;
      }

      .form-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 10px;
      }

      label {
        display: grid;
        gap: 5px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 650;
      }

      label.wide { grid-column: span 2; }
      label.full { grid-column: 1 / -1; }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }

      th, td {
        border-bottom: 1px solid var(--line);
        padding: 9px 7px;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
      }

      .amount {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 3px 8px;
        background: #f8f8f2;
        color: var(--muted);
        font-size: 12px;
      }

      .notice {
        border-left: 3px solid var(--accent-2);
        background: #fff6e6;
        padding: 10px 12px;
        color: #684112;
      }

      .hidden { display: none; }

      pre {
        max-height: 420px;
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #10130f;
        color: #f4f1df;
        padding: 14px;
        font-size: 12px;
        line-height: 1.55;
      }

      @media (max-width: 900px) {
        .app {
          grid-template-columns: 1fr;
        }

        aside {
          border-right: 0;
          border-bottom: 1px solid var(--line);
        }

        .span-4, .span-5, .span-6, .span-7, .span-8 {
          grid-column: 1 / -1;
        }

        .metric-row {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        label.wide {
          grid-column: 1 / -1;
        }
      }

      @media (max-width: 560px) {
        main, aside { padding: 14px; }
        .toolbar { align-items: flex-start; flex-direction: column; }
        .metric-row { grid-template-columns: 1fr; }
        .form-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <aside>
        <div class="brand">
          <h1>BeanBooks</h1>
          <span class="pill">V. 0.0.01</span>
        </div>
        <label>
          Active entity
          <select id="entitySelect"></select>
        </label>
        <div id="entityList" class="entity-list"></div>
        <div class="stack">
          <input id="entityName" placeholder="New business entity name">
          <button id="addEntity" class="primary">Add entity</button>
          <button id="duplicateEntity">Duplicate active entity</button>
          <button id="loadSample">Load rich sample file</button>
          <button id="deleteEntity" class="danger">Delete active entity</button>
        </div>
      </aside>

      <main>
        <div class="toolbar">
          <div>
            <strong id="activeEntityName"></strong>
            <div class="muted" id="entityMeta"></div>
          </div>
          <div class="tabs">
            <button class="tab active" data-tab="dashboard">Reports</button>
            <button class="tab" data-tab="entry">Data entry</button>
            <button class="tab" data-tab="accounts">Chart</button>
            <button class="tab" data-tab="import">Paste import</button>
            <button class="tab" data-tab="export">Export</button>
          </div>
        </div>

        <section id="dashboard" class="view">
          <div class="grid">
            <div class="panel span-12">
              <div class="form-grid" style="margin-bottom:14px">
                <label>From<input id="reportFrom" type="date"></label>
                <label>To<input id="reportTo" type="date"></label>
                <label class="wide"><button id="applyDateRange" class="primary">Apply date range</button></label>
                <label class="wide"><button id="clearDateRange">Clear date range</button></label>
              </div>
              <div class="metric-row">
                <div class="metric"><span>Assets</span><strong id="mAssets"></strong></div>
                <div class="metric"><span>Liabilities</span><strong id="mLiabilities"></strong></div>
                <div class="metric"><span>Revenue</span><strong id="mRevenue"></strong></div>
                <div class="metric"><span>Net income</span><strong id="mNetIncome"></strong></div>
              </div>
            </div>
            <div class="panel span-6">
              <h2>Income statement</h2>
              <table><tbody id="incomeRows"></tbody></table>
            </div>
            <div class="panel span-6">
              <h2>Balance sheet</h2>
              <table><tbody id="balanceRows"></tbody></table>
            </div>
            <div class="panel span-12">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">
                <h2 style="margin:0">A/R &amp; A/P aging</h2>
                <span id="engineStatus" class="pill">engine: idle</span>
              </div>
              <p class="muted" style="margin-top:0">Computed server-side by the Beancount engine from your ledger. Aged by invoice/bill due date.</p>
              <h3>Accounts receivable</h3>
              <table>
                <thead><tr><th>Customer</th><th class="amount">Current</th><th class="amount">1–30</th><th class="amount">31–60</th><th class="amount">61–90</th><th class="amount">90+</th><th class="amount">Total</th></tr></thead>
                <tbody id="arAgingRows"></tbody>
              </table>
              <h3 style="margin-top:16px">Accounts payable</h3>
              <table>
                <thead><tr><th>Vendor</th><th class="amount">Current</th><th class="amount">1–30</th><th class="amount">31–60</th><th class="amount">61–90</th><th class="amount">90+</th><th class="amount">Total</th></tr></thead>
                <tbody id="apAgingRows"></tbody>
              </table>
            </div>
            <div class="panel span-12">
              <h2>Recent transactions</h2>
              <table>
                <thead><tr><th>Date</th><th>Payee</th><th>Narration</th><th>Postings</th></tr></thead>
                <tbody id="recentRows"></tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="entry" class="view hidden">
          <div class="grid">
            <div class="panel span-12">
              <h2>Basic data entry</h2>
              <div class="form-grid">
                <label>Date<input id="txDate" type="date"></label>
                <label class="wide">Payee<input id="txPayee" placeholder="Customer, vendor, bank"></label>
                <label class="wide">Narration<input id="txNarration" placeholder="What happened"></label>
                <label>Currency<input id="txCurrency" value="USD"></label>
                <label class="wide">Debit / first posting<select id="txAccountA"></select></label>
                <label>Amount<input id="txAmount" type="number" step="0.01" placeholder="125.00"></label>
                <label class="wide">Credit / offset posting<select id="txAccountB"></select></label>
                <label class="full"><button id="addTransaction" class="primary">Add balanced transaction</button></label>
              </div>
            </div>
            <div class="panel span-12">
              <h2>Ledger</h2>
              <table>
                <thead><tr><th>Date</th><th>Payee</th><th>Narration</th><th>Postings</th><th></th></tr></thead>
                <tbody id="ledgerRows"></tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="accounts" class="view hidden">
          <div class="grid">
            <div class="panel span-5">
              <h2>Add account</h2>
              <div class="form-grid">
                <label>Type<select id="accountType">
                  <option>Assets</option><option>Liabilities</option><option>Equity</option><option>Income</option><option>Expenses</option>
                </select></label>
                <label class="wide">Name<input id="accountName" placeholder="Assets:Bank:Checking"></label>
                <label class="wide">Opening balance<input id="openingBalance" type="number" step="0.01" value="0"></label>
                <label>Currency<input id="accountCurrency" value="USD"></label>
                <label class="full"><button id="addAccount" class="primary">Add account</button></label>
              </div>
            </div>
            <div class="panel span-7">
              <h2>Chart of accounts</h2>
              <table>
                <thead><tr><th>Account</th><th>Type</th><th>Balance</th><th></th></tr></thead>
                <tbody id="accountRows"></tbody>
              </table>
            </div>
            <div class="panel span-12">
              <h2>Import chart of accounts by paste</h2>
              <p class="muted">Paste Excel or CSV rows. Headers can be Account, Type, Currency, Opening Balance. If no headers are pasted, columns are read in that order.</p>
              <textarea id="accountPasteBox" placeholder="Account&#9;Type&#9;Currency&#9;Opening Balance&#10;Assets:Bank:Savings&#9;Assets&#9;USD&#9;5000&#10;Income:Consulting&#9;Income&#9;USD&#9;0"></textarea>
              <div class="form-grid" style="margin-top:10px">
                <label class="wide"><button id="previewAccounts" class="primary">Preview accounts</button></label>
                <label class="wide"><button id="commitAccounts">Add previewed accounts</button></label>
              </div>
              <div id="accountImportNotice" class="notice hidden"></div>
              <table style="margin-top:12px">
                <thead><tr><th>Account</th><th>Type</th><th>Currency</th><th class="amount">Opening</th></tr></thead>
                <tbody id="accountPreviewRows"></tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="import" class="view hidden">
          <div class="grid">
            <div class="panel span-5">
              <h2>Paste transactions from Excel</h2>
              <p class="muted">Paste tabular rows with headers like Date, Payee, Description, Amount, Account, Offset. Tab-separated Excel copy and CSV both work.</p>
              <textarea id="pasteBox" placeholder="Date&#9;Payee&#9;Description&#9;Amount&#9;Account&#9;Offset&#10;2026-01-05&#9;Client A&#9;Invoice payment&#9;1500&#9;Assets:Bank:Checking&#9;Income:Sales"></textarea>
              <div class="form-grid" style="margin-top:10px">
                <label class="wide">Default account<select id="importAccount"></select></label>
                <label class="wide">Default offset<select id="importOffset"></select></label>
                <label class="full"><button id="previewImport" class="primary">Preview import</button></label>
              </div>
              <div id="importNotice" class="notice hidden"></div>
            </div>
            <div class="panel span-7">
              <h2>Import preview</h2>
              <table>
                <thead><tr><th>Date</th><th>Payee</th><th>Description</th><th>Account</th><th class="amount">Amount</th></tr></thead>
                <tbody id="previewRows"></tbody>
              </table>
              <button id="commitImport" class="primary" style="margin-top:12px">Add previewed rows</button>
            </div>
          </div>
        </section>

        <section id="export" class="view hidden">
          <div class="grid">
            <div class="panel span-12">
              <h2>Beancount export</h2>
              <button id="copyExport" class="primary">Copy Beancount text</button>
              <pre id="beancountExport"></pre>
            </div>
          </div>
        </section>
      </main>
    </div>

    <script>
      const key = "beanbooks.v2";
      const roots = ["Assets", "Liabilities", "Equity", "Income", "Expenses"];
      const starterAccounts = [
        "Assets:Bank:Checking",
        "Assets:Bank:Savings",
        "Assets:AccountsReceivable",
        "Assets:Inventory",
        "Assets:PrepaidExpenses",
        "Liabilities:CreditCard",
        "Liabilities:AccountsPayable",
        "Liabilities:SalesTaxPayable",
        "Liabilities:Loan:Vehicle",
        "Equity:Owner",
        "Equity:RetainedEarnings",
        "Income:Sales",
        "Income:Consulting",
        "Income:Interest",
        "Expenses:Advertising",
        "Expenses:BankFees",
        "Expenses:Contractors",
        "Expenses:Insurance",
        "Expenses:Meals",
        "Expenses:Office",
        "Expenses:Payroll",
        "Expenses:Rent",
        "Expenses:Software",
        "Expenses:Supplies",
        "Expenses:Travel",
        "Expenses:Utilities",
        "Expenses:Uncategorized"
      ];

      let state = load();
      let activeImport = [];
      let activeAccountImport = [];

      function load() {
        const saved = localStorage.getItem(key);
        if (saved) return JSON.parse(saved);
        const entity = makeSampleEntity("Sample Company");
        return { activeEntityId: entity.id, entities: [entity] };
      }

      function save() {
        localStorage.setItem(key, JSON.stringify(state));
      }

      function id() {
        return Math.random().toString(36).slice(2) + Date.now().toString(36);
      }

      function today() {
        return new Date().toISOString().slice(0, 10);
      }

      function makeEntity(name) {
        return {
          id: id(),
          name,
          currency: "USD",
          accounts: starterAccounts.map((name) => ({ name, type: name.split(":")[0], currency: "USD" })),
          transactions: []
        };
      }

      function makeSampleEntity(name) {
        const e = makeEntity(name);
        addSampleTx(e, "2026-01-01", "Owner", "Opening owner contribution", "Assets:Bank:Checking", 35000, "Equity:Owner");
        addSampleTx(e, "2026-01-03", "City Credit Union", "Vehicle loan proceeds", "Assets:Bank:Checking", 18000, "Liabilities:Loan:Vehicle");
        addSampleTx(e, "2026-01-04", "Office Depot", "Initial office supplies", "Expenses:Supplies", 640.25, "Assets:Bank:Checking");
        const clients = ["Acme Foods", "Bright Dental", "Canyon Law", "Delta Retail", "Evergreen Studio", "Futura Labs"];
        const vendors = [
          ["Adobe", "Expenses:Software", 89],
          ["QuickShip", "Expenses:Office", 44],
          ["Metro Insurance", "Expenses:Insurance", 525],
          ["City Power", "Expenses:Utilities", 210],
          ["Northside Workspace", "Expenses:Rent", 2400],
          ["Search Ads", "Expenses:Advertising", 380],
          ["Contractor Team", "Expenses:Contractors", 950],
          ["Bank Service Fee", "Expenses:BankFees", 18],
          ["Travel Desk", "Expenses:Travel", 325],
          ["Cafe Client Meeting", "Expenses:Meals", 72]
        ];
        for (let month = 1; month <= 12; month++) {
          clients.forEach((client, index) => {
            const day = String(5 + index * 3).padStart(2, "0");
            const amount = 1400 + month * 65 + index * 180;
            addSampleTx(e, "2026-" + String(month).padStart(2, "0") + "-" + day, client, "Invoice payment " + month + "-" + (index + 1), "Assets:Bank:Checking", amount, index % 2 ? "Income:Consulting" : "Income:Sales");
          });
          vendors.forEach((vendor, index) => {
            const day = String(2 + index * 2).padStart(2, "0");
            const amount = vendor[2] + ((month + index) % 4) * 17.5;
            addSampleTx(e, "2026-" + String(month).padStart(2, "0") + "-" + day, vendor[0], vendor[1].split(":").slice(1).join(" ") || "Expense", vendor[1], amount, index === 1 ? "Liabilities:CreditCard" : "Assets:Bank:Checking");
          });
          addSampleTx(e, "2026-" + String(month).padStart(2, "0") + "-28", "Payroll", "Monthly payroll", "Expenses:Payroll", 6200 + month * 45, "Assets:Bank:Checking");
          if (month % 3 === 0) addSampleTx(e, "2026-" + String(month).padStart(2, "0") + "-15", "State Revenue Dept", "Sales tax payment", "Liabilities:SalesTaxPayable", 740 + month * 12, "Assets:Bank:Checking");
          if (month % 4 === 0) addSampleTx(e, "2026-" + String(month).padStart(2, "0") + "-20", "Inventory Vendor", "Inventory purchase", "Assets:Inventory", 1800 + month * 90, "Assets:Bank:Checking");
        }
        addSampleTx(e, "2026-12-31", "Bank", "Interest earned", "Assets:Bank:Savings", 182.44, "Income:Interest");
        return e;
      }

      function addSampleTx(e, date, payee, narration, account, amount, offset) {
        ensureAccount(e, account);
        ensureAccount(e, offset);
        e.transactions.push({
          id: id(),
          date,
          payee,
          narration,
          currency: e.currency,
          postings: [
            { account, amount: Number(amount) },
            { account: offset, amount: -Number(amount) }
          ]
        });
      }

      function entity() {
        return state.entities.find((item) => item.id === state.activeEntityId) || state.entities[0];
      }

      function money(value, currency = "USD") {
        return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value || 0);
      }

      function accountType(account) {
        return (account || "").split(":")[0];
      }

      function inRange(tx, from, to) {
        return (!from || tx.date >= from) && (!to || tx.date <= to);
      }

      function reportRange() {
        return {
          from: byId("reportFrom")?.value || "",
          to: byId("reportTo")?.value || ""
        };
      }

      // Sum in integer minor units (cents) to avoid floating-point drift,
      // then convert back to dollars at the end. Keeps stored postings as
      // decimals while making aggregation exact.
      function cents(value) {
        return Math.round(Number(value || 0) * 100);
      }

      function balances(e = entity(), range = {}) {
        const result = Object.fromEntries(e.accounts.map((account) => [account.name, 0]));
        e.transactions.filter((tx) => inRange(tx, range.from, range.to)).forEach((tx) => {
          tx.postings.forEach((posting) => {
            result[posting.account] = (result[posting.account] || 0) + cents(posting.amount);
          });
        });
        // Convert accumulated cents back to dollars.
        Object.keys(result).forEach((account) => {
          result[account] = result[account] / 100;
        });
        return result;
      }

      function totals(e = entity(), range = {}) {
        const b = balances(e, range);
        const totalFor = (root) => Object.entries(b)
          .filter(([account]) => accountType(account) === root)
          .reduce((sum, [, value]) => sum + cents(value), 0) / 100;
        const revenue = -totalFor("Income");
        const expenses = totalFor("Expenses");
        return {
          assets: totalFor("Assets"),
          liabilities: -totalFor("Liabilities"),
          equity: -totalFor("Equity"),
          revenue,
          expenses,
          netIncome: revenue - expenses
        };
      }

      function byId(name) {
        return document.getElementById(name);
      }

      function render() {
        const e = entity();
        save();
        renderEntities(e);
        renderSelectors(e);
        renderReports(e);
        renderAccounts(e);
        renderLedger(e);
        renderExport(e);
      }

      function renderEntities(e) {
        byId("activeEntityName").textContent = e.name;
        byId("entityMeta").textContent = e.accounts.length + " accounts · " + e.transactions.length + " transactions";
        byId("entitySelect").innerHTML = state.entities.map((item) => option(item.id, item.name, item.id === e.id)).join("");
        byId("entityList").innerHTML = state.entities.map((item) => (
          '<button class="entity ' + (item.id === e.id ? "active" : "") + '" data-entity="' + item.id + '">' + esc(item.name) + '</button>'
        )).join("");
      }

      function renderSelectors(e) {
        const opts = e.accounts.map((account) => option(account.name, account.name)).join("");
        ["txAccountA", "txAccountB", "importAccount", "importOffset"].forEach((field) => {
          byId(field).innerHTML = opts;
        });
        byId("txAccountA").value = "Expenses:Office";
        byId("txAccountB").value = "Assets:Bank:Checking";
        byId("importAccount").value = "Assets:Bank:Checking";
        byId("importOffset").value = "Expenses:Uncategorized";
        if (!byId("txDate").value) byId("txDate").value = today();
      }

      function renderReports(e) {
        const range = reportRange();
        const periodTotals = totals(e, range);
        const balanceRange = { to: range.to };
        const balanceTotals = totals(e, balanceRange);
        const filteredTransactions = e.transactions.filter((tx) => inRange(tx, range.from, range.to));
        byId("entityMeta").textContent = e.accounts.length + " accounts · " + filteredTransactions.length + " shown of " + e.transactions.length + " transactions";
        byId("mAssets").textContent = money(balanceTotals.assets, e.currency);
        byId("mLiabilities").textContent = money(balanceTotals.liabilities, e.currency);
        byId("mRevenue").textContent = money(periodTotals.revenue, e.currency);
        byId("mNetIncome").textContent = money(periodTotals.netIncome, e.currency);
        byId("incomeRows").innerHTML = reportRows(e, ["Income", "Expenses"], range)
          + row("Net income", periodTotals.netIncome, e.currency, true);
        // Close net income into equity so the sheet balances: A = L + Eq + NetIncome.
        // Current earnings carries the cumulative (through the report's "to" date)
        // profit that has not yet been posted to a permanent equity account.
        const currentEarnings = balanceTotals.netIncome;
        const totalLiabEquity = balanceTotals.liabilities + balanceTotals.equity + currentEarnings;
        byId("balanceRows").innerHTML = reportRows(e, ["Assets"], balanceRange)
          + row("Total assets", balanceTotals.assets, e.currency, true)
          + spacerRow()
          + reportRows(e, ["Liabilities", "Equity"], balanceRange)
          + row("Current earnings", currentEarnings, e.currency)
          + row("Total liabilities + equity", totalLiabEquity, e.currency, true);
        byId("recentRows").innerHTML = filteredTransactions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map(txRow).join("");
        // Engine-backed aging + balance verification (server-side, async).
        refreshEngineReports(e);
      }

      function reportRows(e, types, range = {}) {
        const b = balances(e, range);
        return Object.entries(b).filter(([account, value]) => types.includes(accountType(account)) && Math.abs(value) > 0.004)
          .map(([account, value]) => {
            const type = accountType(account);
            const display = type === "Income" || type === "Liabilities" || type === "Equity" ? -value : value;
            return row(account, display, e.currency);
          }).join("") || '<tr><td class="muted">No activity yet</td><td></td></tr>';
      }

      function renderAccounts(e) {
        const b = balances(e);
        byId("accountRows").innerHTML = e.accounts.map((account) => {
          const value = b[account.name] || 0;
          return '<tr><td>' + esc(account.name) + '</td><td><span class="pill">' + esc(account.type) + '</span></td><td class="amount">' + money(value, account.currency) + '</td><td class="amount"><button data-remove-account="' + esc(account.name) + '">Remove</button></td></tr>';
        }).join("");
      }

      function renderLedger(e) {
        byId("ledgerRows").innerHTML = e.transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).map((tx) => txRow(tx, true)).join("");
      }

      // Build the ledger as Beancount text. Shared by the Export tab and the
      // server-side report engine so both see identical input. Emits optional
      // customer/vendor/due metadata when present so aging can bucket by party.
      function buildBeancount(e) {
        const lines = ['option "title" "' + e.name.replaceAll('"', "'") + '"', 'option "operating_currency" "' + e.currency + '"', ""];
        e.accounts.forEach((account) => lines.push("1970-01-01 open " + account.name + " " + account.currency));
        lines.push("");
        e.transactions.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((tx) => {
          lines.push(tx.date + ' * "' + clean(tx.payee) + '" "' + clean(tx.narration) + '"');
          if (tx.customer) lines.push('  customer: "' + clean(tx.customer) + '"');
          if (tx.vendor) lines.push('  vendor: "' + clean(tx.vendor) + '"');
          if (tx.due) lines.push('  due: "' + clean(tx.due) + '"');
          tx.postings.forEach((posting) => {
            lines.push("  " + posting.account.padEnd(34, " ") + " " + Number(posting.amount).toFixed(2) + " " + tx.currency);
          });
          lines.push("");
        });
        return lines.join("\\n");
      }

      function renderExport(e) {
        byId("beancountExport").textContent = buildBeancount(e);
      }

      // Call the server-side Beancount engine and render engine-backed aging +
      // a balance-check badge. Non-blocking: failures degrade gracefully.
      let engineSeq = 0;
      async function refreshEngineReports(e) {
        const seq = ++engineSeq;
        const status = byId("engineStatus");
        if (status) { status.textContent = "engine: computing…"; status.style.color = ""; }
        try {
          const range = reportRange();
          const res = await fetch("/api/reports", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              beancount: buildBeancount(e),
              from: range.from || undefined,
              to: range.to || undefined
            })
          });
          if (seq !== engineSeq) return; // a newer request superseded this one
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json();
          renderAging("arAgingRows", data.aging.ar.rows, data.aging.ar.total);
          renderAging("apAgingRows", data.aging.ap.rows, data.aging.ap.total);
          const balanced = data.balanceSheet.balances;
          if (status) {
            status.textContent = balanced ? "engine: balanced ✓" : "engine: OUT OF BALANCE";
            status.style.color = balanced ? "var(--accent)" : "var(--bad)";
          }
        } catch (err) {
          if (seq !== engineSeq) return;
          if (status) { status.textContent = "engine: unavailable"; status.style.color = "var(--muted)"; }
        }
      }

      function renderAging(tbodyId, rows, total) {
        const body = byId(tbodyId);
        if (!body) return;
        const cell = (s) => '<td class="amount">' + esc(s) + '</td>';
        const line = (r, strong) => {
          const open = strong ? "<strong>" : "";
          const close = strong ? "</strong>" : "";
          return '<tr><td>' + open + esc(r.party) + close + '</td>'
            + cell(r.current) + cell(r.d1_30) + cell(r.d31_60) + cell(r.d61_90) + cell(r.d90_plus)
            + '<td class="amount">' + open + esc(r.total) + close + '</td></tr>';
        };
        if (!rows.length) {
          body.innerHTML = '<tr><td class="muted" colspan="7">Nothing outstanding</td></tr>';
          return;
        }
        body.innerHTML = rows.map((r) => line(r, false)).join("") + line(total, true);
      }

      function txRow(tx, removable = false) {
        const postings = tx.postings.map((p) => esc(p.account) + " " + money(p.amount, tx.currency)).join("<br>");
        return '<tr><td>' + esc(tx.date) + '</td><td>' + esc(tx.payee || "") + '</td><td>' + esc(tx.narration || "") + '</td><td>' + postings + '</td>' + (removable ? '<td class="amount"><button data-remove-tx="' + tx.id + '">Remove</button></td>' : "") + '</tr>';
      }

      function row(label, amount, currency, strong = false) {
        return '<tr><td>' + (strong ? "<strong>" : "") + esc(label) + (strong ? "</strong>" : "") + '</td><td class="amount">' + (strong ? "<strong>" : "") + money(amount, currency) + (strong ? "</strong>" : "") + '</td></tr>';
      }

      function spacerRow() {
        return '<tr><td style="border:0;padding-top:10px"></td><td style="border:0"></td></tr>';
      }

      function option(value, label, selected = false) {
        return '<option value="' + esc(value) + '"' + (selected ? " selected" : "") + ">" + esc(label) + "</option>";
      }

      function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
      }

      function clean(value) {
        return String(value ?? "").replaceAll('"', "'");
      }

      function parseAmount(value) {
        if (typeof value === "number") return value;
        const raw = String(value || "").trim();
        const negative = /^\\(.*\\)$/.test(raw);
        const cleaned = raw.replace(/[$,()]/g, "");
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed * (negative ? -1 : 1) : 0;
      }

      function parsePaste(text) {
        const rows = text.trim().split(/\\r?\\n/).filter(Boolean).map((line) => line.includes("\\t") ? line.split("\\t") : csvLine(line));
        if (!rows.length) return [];
        const headers = rows[0].map((cell) => cell.trim().toLowerCase());
        const hasHeader = headers.some((h) => ["date", "amount", "payee", "description", "account", "offset"].includes(h));
        const body = hasHeader ? rows.slice(1) : rows;
        const index = (names, fallback) => {
          const found = headers.findIndex((h) => names.includes(h));
          return found >= 0 ? found : fallback;
        };
        return body.map((cells) => ({
          date: normalizeDate(cells[index(["date"], 0)]),
          payee: cells[index(["payee", "vendor", "customer", "name"], 1)] || "",
          narration: cells[index(["description", "memo", "narration"], 2)] || cells[index(["payee"], 1)] || "",
          amount: parseAmount(cells[index(["amount", "debit", "credit"], 3)]),
          account: cells[index(["account"], 4)] || byId("importAccount").value,
          offset: cells[index(["offset", "category", "counteraccount"], 5)] || byId("importOffset").value
        })).filter((row) => row.date && row.amount);
      }

      function parseAccountPaste(text) {
        const rows = text.trim().split(/\\r?\\n/).filter(Boolean).map((line) => line.includes("\\t") ? line.split("\\t") : csvLine(line));
        if (!rows.length) return [];
        const headers = rows[0].map((cell) => cell.trim().toLowerCase());
        const hasHeader = headers.some((h) => ["account", "name", "type", "currency", "opening balance", "opening"].includes(h));
        const body = hasHeader ? rows.slice(1) : rows;
        const index = (names, fallback) => {
          const found = headers.findIndex((h) => names.includes(h));
          return found >= 0 ? found : fallback;
        };
        return body.map((cells) => {
          const name = (cells[index(["account", "name"], 0)] || "").trim();
          const inferredType = roots.includes(accountType(name)) ? accountType(name) : "Expenses";
          const type = (cells[index(["type"], 1)] || inferredType).trim();
          const currency = (cells[index(["currency", "commodity"], 2)] || entity().currency).trim() || entity().currency;
          const opening = parseAmount(cells[index(["opening balance", "opening", "balance"], 3)]);
          return { name, type: roots.includes(type) ? type : inferredType, currency, opening };
        }).filter((row) => row.name && roots.includes(accountType(row.name)));
      }

      function duplicateEntity(source) {
        const copy = JSON.parse(JSON.stringify(source));
        const suffix = " Copy";
        copy.id = id();
        copy.name = source.name.endsWith(suffix) ? source.name + " 2" : source.name + suffix;
        copy.accounts = copy.accounts.map((account) => ({ ...account }));
        copy.transactions = copy.transactions.map((tx) => ({
          ...tx,
          id: id(),
          postings: tx.postings.map((posting) => ({ ...posting }))
        }));
        return copy;
      }

      function csvLine(line) {
        const cells = [];
        let current = "";
        let quoted = false;
        for (const ch of line) {
          if (ch === '"') quoted = !quoted;
          else if (ch === "," && !quoted) {
            cells.push(current);
            current = "";
          } else current += ch;
        }
        cells.push(current);
        return cells.map((cell) => cell.trim());
      }

      function normalizeDate(value) {
        const raw = String(value || "").trim();
        if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) return raw;
        const match = raw.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})$/);
        if (!match) return "";
        const year = match[3].length === 2 ? "20" + match[3] : match[3];
        return year + "-" + match[1].padStart(2, "0") + "-" + match[2].padStart(2, "0");
      }

      function ensureAccount(e, name) {
        if (!name || e.accounts.some((account) => account.name === name)) return;
        const type = roots.includes(accountType(name)) ? accountType(name) : "Expenses";
        e.accounts.push({ name, type, currency: e.currency });
      }

      function addBalancedTx(data) {
        const e = entity();
        ensureAccount(e, data.account);
        ensureAccount(e, data.offset);
        e.transactions.push({
          id: id(),
          date: data.date,
          payee: data.payee,
          narration: data.narration,
          currency: data.currency || e.currency,
          postings: [
            { account: data.account, amount: Number(data.amount) },
            { account: data.offset, amount: -Number(data.amount) }
          ]
        });
      }

      document.addEventListener("click", (event) => {
        const target = event.target;
        if (target.matches(".tab")) {
          document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === target));
          document.querySelectorAll(".view").forEach((view) => view.classList.toggle("hidden", view.id !== target.dataset.tab));
        }
        if (target.dataset.entity) {
          state.activeEntityId = target.dataset.entity;
          render();
        }
        if (target.id === "addEntity") {
          const name = byId("entityName").value.trim();
          if (!name) return;
          const next = makeEntity(name);
          state.entities.push(next);
          state.activeEntityId = next.id;
          byId("entityName").value = "";
          render();
        }
        if (target.id === "duplicateEntity") {
          const next = duplicateEntity(entity());
          state.entities.push(next);
          state.activeEntityId = next.id;
          render();
        }
        if (target.id === "loadSample" && confirm("Replace the active entity with a rich sample ledger?")) {
          const current = entity();
          const sample = makeSampleEntity(current.name || "Sample Company");
          sample.id = current.id;
          state.entities = state.entities.map((item) => item.id === current.id ? sample : item);
          render();
        }
        if (target.id === "deleteEntity" && state.entities.length > 1 && confirm("Delete this entity and its ledger?")) {
          state.entities = state.entities.filter((item) => item.id !== state.activeEntityId);
          state.activeEntityId = state.entities[0].id;
          render();
        }
        if (target.id === "addTransaction") {
          addBalancedTx({
            date: byId("txDate").value || today(),
            payee: byId("txPayee").value,
            narration: byId("txNarration").value,
            amount: parseAmount(byId("txAmount").value),
            account: byId("txAccountA").value,
            offset: byId("txAccountB").value,
            currency: byId("txCurrency").value || entity().currency
          });
          byId("txPayee").value = "";
          byId("txNarration").value = "";
          byId("txAmount").value = "";
          render();
        }
        if (target.id === "addAccount") {
          const e = entity();
          const name = byId("accountName").value.trim();
          if (!name) return;
          ensureAccount(e, name);
          const account = e.accounts.find((item) => item.name === name);
          account.type = byId("accountType").value;
          account.currency = byId("accountCurrency").value || e.currency;
          const opening = parseAmount(byId("openingBalance").value);
          if (opening) {
            e.transactions.push({
              id: id(), date: today(), payee: "Opening balance", narration: name,
              currency: account.currency,
              postings: [{ account: name, amount: opening }, { account: "Equity:Owner", amount: -opening }]
            });
          }
          byId("accountName").value = "";
          byId("openingBalance").value = "0";
          render();
        }
        if (target.id === "previewAccounts") {
          activeAccountImport = parseAccountPaste(byId("accountPasteBox").value);
          byId("accountPreviewRows").innerHTML = activeAccountImport.map((row) => '<tr><td>' + esc(row.name) + '</td><td><span class="pill">' + esc(row.type) + '</span></td><td>' + esc(row.currency) + '</td><td class="amount">' + money(row.opening, row.currency) + '</td></tr>').join("");
          byId("accountImportNotice").classList.toggle("hidden", !activeAccountImport.length);
          byId("accountImportNotice").textContent = activeAccountImport.length ? activeAccountImport.length + " accounts ready to import. Existing accounts will be skipped, opening balances will post to Equity:Owner." : "";
        }
        if (target.id === "commitAccounts") {
          const e = entity();
          activeAccountImport.forEach((row) => {
            const exists = e.accounts.some((account) => account.name === row.name);
            if (!exists) e.accounts.push({ name: row.name, type: row.type, currency: row.currency });
            if (row.opening) {
              ensureAccount(e, "Equity:Owner");
              e.transactions.push({
                id: id(),
                date: today(),
                payee: "Opening balance",
                narration: row.name,
                currency: row.currency,
                postings: [{ account: row.name, amount: row.opening }, { account: "Equity:Owner", amount: -row.opening }]
              });
            }
          });
          activeAccountImport = [];
          byId("accountPasteBox").value = "";
          byId("accountPreviewRows").innerHTML = "";
          byId("accountImportNotice").classList.add("hidden");
          render();
        }
        if (target.id === "previewImport") {
          activeImport = parsePaste(byId("pasteBox").value);
          byId("previewRows").innerHTML = activeImport.map((row) => '<tr><td>' + esc(row.date) + '</td><td>' + esc(row.payee) + '</td><td>' + esc(row.narration) + '</td><td>' + esc(row.account) + '<br><span class="muted">' + esc(row.offset) + '</span></td><td class="amount">' + money(row.amount, entity().currency) + '</td></tr>').join("");
          byId("importNotice").classList.toggle("hidden", !activeImport.length);
          byId("importNotice").textContent = activeImport.length ? activeImport.length + " rows ready. Each row will create a balanced two-posting Beancount transaction." : "";
        }
        if (target.id === "commitImport") {
          activeImport.forEach((row) => addBalancedTx({ ...row, currency: entity().currency }));
          activeImport = [];
          byId("pasteBox").value = "";
          byId("previewRows").innerHTML = "";
          byId("importNotice").classList.add("hidden");
          render();
        }
        if (target.id === "applyDateRange") {
          render();
        }
        if (target.id === "clearDateRange") {
          byId("reportFrom").value = "";
          byId("reportTo").value = "";
          render();
        }
        if (target.id === "copyExport") {
          navigator.clipboard.writeText(byId("beancountExport").textContent);
          target.textContent = "Copied";
          setTimeout(() => target.textContent = "Copy Beancount text", 900);
        }
        if (target.dataset.removeTx) {
          const e = entity();
          e.transactions = e.transactions.filter((tx) => tx.id !== target.dataset.removeTx);
          render();
        }
        if (target.dataset.removeAccount) {
          const e = entity();
          const account = target.dataset.removeAccount;
          if (e.transactions.some((tx) => tx.postings.some((posting) => posting.account === account))) return alert("This account has activity.");
          e.accounts = e.accounts.filter((item) => item.name !== account);
          render();
        }
      });

      byId("entitySelect").addEventListener("change", (event) => {
        state.activeEntityId = event.target.value;
        render();
      });

      render();
    </script>
  </body>
</html>`;


export const dynamic = "force-static";

export function GET() {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
