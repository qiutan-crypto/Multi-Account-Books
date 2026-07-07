// QuickBooks Desktop export generators — ported from the Bank Transaction
// Categorizer: Chart of Accounts IIF, Journal Entries IIF, and .qbo (OFX
// Web Connect). Pure string builders; the caller handles the download.

export interface QbAccount {
  account: string; // full Beancount name, e.g. "Expenses:Advertising"
  type: string; // Beancount root
  description?: string;
}

export interface QbTxn {
  date: string; // ISO
  payee: string;
  narration: string;
  ref: string;
  postings: { account: string; amountCents: number }[];
}

function sanitizeIif(value: string): string {
  return String(value || "").replace(/[\t\r\n]+/g, " ").trim();
}

/** "Expenses:Meals:Client" -> "Meals:Client" (QB uses ":" for sub-accounts too). */
export function qbName(account: string, stripRoot: boolean): string {
  if (!stripRoot) return account;
  const segs = (account || "").split(":");
  return segs.length > 1 ? segs.slice(1).join(":") : account;
}

function iifDate(iso: string): string {
  const [y, m, d] = (iso || "").split("-");
  if (!y) return "";
  return `${Number(m)}/${Number(d)}/${y}`;
}

/** Infer the IIF ACCNTTYPE from the Beancount root + name keywords. */
export function iifAccountType(account: string, root: string): string {
  const lower = account.toLowerCase();
  switch (root) {
    case "Assets":
      if (/receivable/.test(lower)) return "AR";
      if (/(fixed|equipment|vehicle|building|furniture)/.test(lower)) return "FIXASSET";
      if (/(bank|checking|savings|cash|petty)/.test(lower)) return "BANK";
      return "OCASSET";
    case "Liabilities":
      if (/(credit ?card|creditcard|visa|amex|mastercard|discover)/.test(lower)) return "CCARD";
      if (/payable/.test(lower)) return "AP";
      if (/(loan|mortgage|longterm|long-term|note)/.test(lower)) return "LTLIAB";
      return "OCLIAB";
    case "Equity":
      return "EQUITY";
    case "Income":
      return "INC";
    case "COGS":
      return "COGS";
    case "Expenses":
      return "EXP";
    default:
      return "";
  }
}

/** Chart of Accounts IIF. */
export function generateCoaIif(
  accounts: QbAccount[],
  opts: { stripRoot: boolean }
): { content: string; count: number } {
  const lines = ["!ACCNT\tNAME\tACCNTTYPE\tDESC"];
  const seen = new Set<string>();
  let count = 0;
  for (const a of accounts) {
    const name = sanitizeIif(qbName(a.account, opts.stripRoot));
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    lines.push(
      `ACCNT\t${name}\t${iifAccountType(a.account, a.type)}\t${sanitizeIif(a.description || "")}`
    );
    count++;
  }
  return { content: count ? lines.join("\r\n") : "", count };
}

/**
 * Journal Entries IIF. Each ledger transaction becomes one GENERAL JOURNAL:
 * the first posting is the TRNS line, the rest are SPL lines. IIF amounts:
 * TRNS + SPL lines must sum to zero — which our balanced postings already do.
 */
export function generateJournalIif(
  txns: QbTxn[],
  opts: { stripRoot: boolean }
): { content: string; count: number } {
  const lines = [
    "!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tCLASS\tAMOUNT\tDOCNUM\tMEMO",
    "!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tCLASS\tAMOUNT\tDOCNUM\tMEMO",
    "!ENDTRNS",
  ];
  let count = 0;
  for (const t of txns) {
    if (t.postings.length < 2) continue;
    const date = iifDate(t.date);
    const memo = sanitizeIif([t.payee, t.narration].filter(Boolean).join(" — "));
    const doc = sanitizeIif(t.ref || "");
    t.postings.forEach((p, i) => {
      const tag = i === 0 ? "TRNS" : "SPL";
      const amount = (p.amountCents / 100).toFixed(2);
      lines.push(
        `${tag}\t\tGENERAL JOURNAL\t${date}\t${sanitizeIif(qbName(p.account, opts.stripRoot))}\t\t${amount}\t${doc}\t${memo}`
      );
    });
    lines.push("ENDTRNS");
    count++;
  }
  return { content: count ? lines.join("\r\n") : "", count };
}

function escapeXml(unsafe: string): string {
  return String(unsafe || "").replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      default: return "&quot;";
    }
  });
}

function ofxDate(iso: string): string {
  return (iso || "").replace(/-/g, "") + "000000";
}

/**
 * .qbo (OFX/SGML Web Connect) for ONE bank/credit-card account. Transactions
 * are the account's ledger legs; NAME carries the category (so QB Desktop
 * shows where each row was classified) or the payee.
 */
export function generateQbo(
  txns: QbTxn[],
  sourceAccount: string,
  opts: { acctType: "BANK" | "CREDITCARD"; last4: string; includeCategory: boolean; stripRoot: boolean }
): { content: string; count: number } {
  const rows: { date: string; amountCents: number; name: string; memo: string }[] = [];
  for (const t of txns) {
    const leg = t.postings
      .filter((p) => p.account === sourceAccount)
      .reduce((s, p) => s + p.amountCents, 0);
    if (!leg) continue;
    const others = t.postings.filter((p) => p.account !== sourceAccount);
    const category =
      others.length === 1 ? qbName(others[0].account, opts.stripRoot) : others.length ? "Split" : "";
    const name = opts.includeCategory && category ? category : t.payee || "Unknown";
    rows.push({
      date: t.date,
      amountCents: leg,
      name: name.substring(0, 32),
      memo: (t.narration || "").substring(0, 255),
    });
  }
  if (!rows.length) return { content: "", count: 0 };

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const nowStr =
    now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());

  let minDate = "", maxDate = "";
  for (const r of rows) {
    const ymd = r.date.replace(/-/g, "");
    if (!minDate || ymd < minDate) minDate = ymd;
    if (!maxDate || ymd > maxDate) maxDate = ymd;
  }

  const acctId =
    opts.acctType === "BANK" ? "391892" + opts.last4 : "424631531823" + opts.last4;

  const isBank = opts.acctType === "BANK";
  const msgOpen = isBank ? "<BANKMSGSRSV1>" : "<CREDITCARDMSGSRSV1>";
  const msgClose = isBank ? "</BANKMSGSRSV1>" : "</CREDITCARDMSGSRSV1>";
  const trnRsOpen = isBank ? "<STMTTRNRS>" : "<CCSTMTTRNRS>";
  const trnRsClose = isBank ? "</STMTTRNRS>" : "</CCSTMTTRNRS>";
  const rsOpen = isBank ? "<STMTRS>" : "<CCSTMTRS>";
  const rsClose = isBank ? "</STMTRS>" : "</CCSTMTRS>";
  const acctBlock = isBank
    ? `
        <BANKACCTFROM>
          <BANKID>021000021</BANKID>
          <ACCTID>${acctId}</ACCTID>
          <ACCTTYPE>CHECKING</ACCTTYPE>
        </BANKACCTFROM>`
    : `
        <CCACCTFROM>
          <ACCTID>${acctId}</ACCTID>
          <ACCTTYPE>CREDITLINE</ACCTTYPE>
        </CCACCTFROM>`;

  const stamp = String(Math.floor(Date.now() / 1000)).slice(-6);
  const body = rows
    .map((r, idx) => {
      const trnType = r.amountCents > 0 ? "CREDIT" : "DEBIT";
      const fitid = String(idx + 1).padStart(6, "0") + stamp;
      return `
          <STMTTRN>
            <TRNTYPE>${trnType}</TRNTYPE>
            <DTPOSTED>${ofxDate(r.date)}</DTPOSTED>
            <TRNAMT>${(r.amountCents / 100).toFixed(2)}</TRNAMT>
            <FITID>${fitid}</FITID>
            <NAME>${escapeXml(r.name)}</NAME>
            <MEMO>${escapeXml(r.memo)}</MEMO>
          </STMTTRN>`;
    })
    .join("");

  const content = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE
<OFX>
  <SIGNONMSGSRSV1>
    <SONRS>
      <STATUS>
        <CODE>0</CODE>
        <SEVERITY>INFO</SEVERITY>
      </STATUS>
      <DTSERVER>${nowStr}</DTSERVER>
      <LANGUAGE>ENG</LANGUAGE>
      <FI>
        <ORG>Chase Web Download</ORG>
        <FID>02430</FID>
      </FI>
      <INTU.BID>02430</INTU.BID>
      <INTU.USERID>user</INTU.USERID>
      <DTACCTUP>0</DTACCTUP>
    </SONRS>
  </SIGNONMSGSRSV1>
  ${msgOpen}
    ${trnRsOpen}
      <TRNUID>0</TRNUID>
      <STATUS>
        <CODE>0</CODE>
        <SEVERITY>INFO</SEVERITY>
      </STATUS>
      ${rsOpen}
        <CURDEF>USD${acctBlock}
        <BANKTRANLIST>
          <DTSTART>${minDate}</DTSTART>
          <DTEND>${maxDate}</DTEND>${body}
        </BANKTRANLIST>
        <LEDGERBAL>
          <BALAMT>0.00</BALAMT>
          <DTASOF>${nowStr}</DTASOF>
        </LEDGERBAL>
      ${rsClose}
    ${trnRsClose}
  ${msgClose}
</OFX>`;

  return { content, count: rows.length };
}

/** Trigger a browser download of plain-text content. */
export function download(filename: string, content: string, mime = "text/plain;charset=utf-8"): void {
  const safe = (filename || "export.txt").replace(/[\\/:*?"<>|]+/g, "_");
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
