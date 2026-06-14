"use client";

import { useEffect, useState, useTransition } from "react";
import { getReports, type ReportsDTO, type AgingRowDTO } from "./actions";

function money(display: string): string {
  // display is a plain 2-decimal string like "-1250.00"; add $ and thousands.
  const neg = display.startsWith("-");
  const [intPart, dec] = display.replace("-", "").split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-$" : "$") + withCommas + "." + dec;
}

function ReportRows({
  rows,
}: {
  rows: { account: string; display: string }[];
}) {
  if (!rows.length)
    return (
      <tr>
        <td className="muted">No activity</td>
        <td></td>
      </tr>
    );
  return (
    <>
      {rows.map((r) => (
        <tr key={r.account}>
          <td>{r.account}</td>
          <td className="amount">{money(r.display)}</td>
        </tr>
      ))}
    </>
  );
}

function AgingTable({
  title,
  rows,
  total,
  partyLabel,
}: {
  title: string;
  rows: AgingRowDTO[];
  total: AgingRowDTO;
  partyLabel: string;
}) {
  return (
    <>
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>{partyLabel}</th>
            <th className="amount">Current</th>
            <th className="amount">1–30</th>
            <th className="amount">31–60</th>
            <th className="amount">61–90</th>
            <th className="amount">90+</th>
            <th className="amount">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="muted" colSpan={7}>
                Nothing outstanding
              </td>
            </tr>
          ) : (
            <>
              {rows.map((r) => (
                <tr key={r.party}>
                  <td>{r.party}</td>
                  <td className="amount">{money(r.current)}</td>
                  <td className="amount">{money(r.d1_30)}</td>
                  <td className="amount">{money(r.d31_60)}</td>
                  <td className="amount">{money(r.d61_90)}</td>
                  <td className="amount">{money(r.d90_plus)}</td>
                  <td className="amount">{money(r.total)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td className="amount">
                  <strong>{money(total.current)}</strong>
                </td>
                <td className="amount">
                  <strong>{money(total.d1_30)}</strong>
                </td>
                <td className="amount">
                  <strong>{money(total.d31_60)}</strong>
                </td>
                <td className="amount">
                  <strong>{money(total.d61_90)}</strong>
                </td>
                <td className="amount">
                  <strong>{money(total.d90_plus)}</strong>
                </td>
                <td className="amount">
                  <strong>{money(total.total)}</strong>
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </>
  );
}

export default function ReportsView({ entityId }: { entityId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<ReportsDTO | null>(null);
  const [pending, startTransition] = useTransition();

  function load(f: string, t: string) {
    startTransition(async () => {
      const r = await getReports(entityId, {
        from: f || undefined,
        to: t || undefined,
      });
      setData(r);
    });
  }

  useEffect(() => {
    load(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  function applyPreset(f: string, t: string) {
    setFrom(f);
    setTo(t);
    load(f, t);
  }

  return (
    <div className="grid">
      <div className="panel span-12">
        <div className="presets">
          {datePresets().map((p) => (
            <button key={p.label} onClick={() => applyPreset(p.from, p.to)} disabled={pending}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="wide">
            <button className="primary" onClick={() => load(from, to)} disabled={pending}>
              {pending ? "Computing…" : "Apply date range"}
            </button>
          </label>
          <label className="wide">
            <button
              onClick={() => {
                setFrom("");
                setTo("");
                load("", "");
              }}
              disabled={pending}
            >
              Clear
            </button>
          </label>
        </div>

        {data?.errors?.length ? (
          <div className="notice">
            {data.errors.length} ledger issue(s): {data.errors[0].message}
            {data.errors.length > 1 ? " (+ more)" : ""}
          </div>
        ) : null}

        <div className="metric-row">
          <div className="metric">
            <span>Assets</span>
            <strong>{data ? money(data.metrics.assets) : "—"}</strong>
          </div>
          <div className="metric">
            <span>Liabilities</span>
            <strong>{data ? money(data.metrics.liabilities) : "—"}</strong>
          </div>
          <div className="metric">
            <span>Revenue</span>
            <strong>{data ? money(data.metrics.revenue) : "—"}</strong>
          </div>
          <div className="metric">
            <span>Net income</span>
            <strong>{data ? money(data.metrics.netIncome) : "—"}</strong>
          </div>
        </div>
      </div>

      <div className="panel span-6">
        <h2>Income statement</h2>
        <table>
          <tbody>
            <ReportRows rows={data?.income ?? []} />
            <ReportRows rows={data?.expenses ?? []} />
            {data ? (
              <tr>
                <td>
                  <strong>Net income</strong>
                </td>
                <td className="amount">
                  <strong>{money(data.netIncome)}</strong>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="panel span-6">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Balance sheet</h2>
          {data ? (
            <span className={"pill " + (data.balanceSheet.balances ? "good" : "bad")}>
              {data.balanceSheet.balances ? "balanced ✓" : "out of balance"}
            </span>
          ) : null}
        </div>
        <table style={{ marginTop: 12 }}>
          <tbody>
            <ReportRows rows={data?.balanceSheet.assets ?? []} />
            {data ? (
              <tr>
                <td>
                  <strong>Total assets</strong>
                </td>
                <td className="amount">
                  <strong>{money(data.balanceSheet.totalAssets)}</strong>
                </td>
              </tr>
            ) : null}
            <tr>
              <td style={{ borderBottom: 0, paddingTop: 10 }}></td>
              <td style={{ borderBottom: 0 }}></td>
            </tr>
            <ReportRows rows={data?.balanceSheet.liabilities ?? []} />
            <ReportRows rows={data?.balanceSheet.equity ?? []} />
            {data ? (
              <>
                <tr>
                  <td>Current earnings</td>
                  <td className="amount">{money(data.balanceSheet.currentEarnings)}</td>
                </tr>
                <tr>
                  <td>
                    <strong>Total liabilities + equity</strong>
                  </td>
                  <td className="amount">
                    <strong>{money(data.balanceSheet.totalLiabEquity)}</strong>
                  </td>
                </tr>
              </>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="panel span-12">
        <h2>A/R &amp; A/P aging</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Computed by the Beancount engine, aged by invoice/bill due date.
        </p>
        <AgingTable
          title="Accounts receivable"
          partyLabel="Customer"
          rows={data?.arAging.rows ?? []}
          total={data?.arAging.total ?? emptyAging()}
        />
        <div style={{ height: 16 }} />
        <AgingTable
          title="Accounts payable"
          partyLabel="Vendor"
          rows={data?.apAging.rows ?? []}
          total={data?.apAging.total ?? emptyAging()}
        />
      </div>

      <div className="panel span-6">
        <h2>Income by payee</h2>
        <PayeeTable
          partyLabel="Customer / payee"
          rows={data?.incomeByPayee.rows ?? []}
          total={data?.incomeByPayee.total ?? "0.00"}
        />
      </div>

      <div className="panel span-6">
        <h2>Expenses by payee</h2>
        <PayeeTable
          partyLabel="Vendor / payee"
          rows={data?.expensesByPayee.rows ?? []}
          total={data?.expensesByPayee.total ?? "0.00"}
        />
      </div>
    </div>
  );
}

function PayeeTable({
  partyLabel,
  rows,
  total,
}: {
  partyLabel: string;
  rows: { payee: string; display: string }[];
  total: string;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>{partyLabel}</th>
          <th className="amount">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="muted" colSpan={2}>
              No activity in range
            </td>
          </tr>
        ) : (
          <>
            {rows.map((r) => (
              <tr key={r.payee}>
                <td>{r.payee}</td>
                <td className="amount">{money(r.display)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              <td className="amount">
                <strong>{money(total)}</strong>
              </td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  );
}

function emptyAging(): AgingRowDTO {
  return {
    party: "Total",
    current: "0.00",
    d1_30: "0.00",
    d31_60: "0.00",
    d61_90: "0.00",
    d90_plus: "0.00",
    total: "0.00",
  };
}

interface Preset {
  label: string;
  from: string;
  to: string;
}

/** Quick date-range presets, computed from today. "" means open-ended. */
function datePresets(): Preset[] {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  const q = Math.floor(m / 3); // 0-based quarter

  const ym = (yy: number, mm: number, dd: number) =>
    iso(new Date(Date.UTC(yy, mm, dd)));
  const monthEnd = (yy: number, mm: number) => ym(yy, mm + 1, 0); // day 0 = last day of prev month

  const qStartMonth = q * 3;
  const prevQ = q === 0 ? 3 : q - 1;
  const prevQYear = q === 0 ? y - 1 : y;
  const prevQStartMonth = prevQ * 3;

  return [
    { label: "This month", from: ym(y, m, 1), to: monthEnd(y, m) },
    { label: "This quarter", from: ym(y, qStartMonth, 1), to: monthEnd(y, qStartMonth + 2) },
    {
      label: "Last quarter",
      from: ym(prevQYear, prevQStartMonth, 1),
      to: monthEnd(prevQYear, prevQStartMonth + 2),
    },
    { label: "YTD", from: ym(y, 0, 1), to: iso(now) },
    { label: "This year", from: ym(y, 0, 1), to: ym(y, 11, 31) },
    { label: "Last year", from: ym(y - 1, 0, 1), to: ym(y - 1, 11, 31) },
    { label: "All time", from: "", to: "" },
  ];
}
