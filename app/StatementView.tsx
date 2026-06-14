"use client";

import { useEffect, useState, useTransition } from "react";
import { getStatements, type StatementsDTO, type StatementRowDTO } from "./actions";

function money(display: string, negative: boolean, withDollar: boolean): string {
  if (display === "") return "";
  const isPct = display.endsWith("%");
  if (isPct) return display; // already formatted
  const [intPart, dec] = display.replace("-", "").split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = (withDollar ? "$" : "") + withCommas + "." + dec;
  return negative ? "-" + body : body;
}

type CompareMode = "off" | "prior-year" | "custom";
type ChangeMode = "amount" | "percent";

function StatementTable({
  rows,
  comparing,
  changeMode,
  curLabel,
  cmpLabel,
}: {
  rows: StatementRowDTO[];
  comparing: boolean;
  changeMode: ChangeMode;
  curLabel: string;
  cmpLabel: string;
}) {
  const changeHead = changeMode === "amount" ? "$ Change" : "% Change";
  return (
    <table className="stmt">
      <thead>
        <tr>
          <th className="stmt-acct"></th>
          <th className="stmt-amt">{comparing ? curLabel : "Total"}</th>
          {comparing ? <th className="stmt-amt">{cmpLabel}</th> : null}
          {comparing ? <th className="stmt-amt">{changeHead}</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          if (r.kind === "spacer") {
            return (
              <tr key={i} className="stmt-spacer">
                <td colSpan={comparing ? 4 : 2}>&nbsp;</td>
              </tr>
            );
          }
          const cls = ["stmt-row", "k-" + r.kind].join(" ");
          const withDollar = r.kind === "subtotal" || r.kind === "total" || r.kind === "grandtotal";
          return (
            <tr key={i} className={cls}>
              <td className="stmt-acct" style={{ paddingLeft: 8 + r.depth * 16 }}>
                {r.label}
              </td>
              <td className={"stmt-amt amount" + (r.negative ? " neg" : "")}>
                {money(r.display, r.negative, withDollar)}
              </td>
              {comparing ? (
                <td className={"stmt-amt amount" + (r.compareNegative ? " neg" : "")}>
                  {money(r.compareDisplay, r.compareNegative, withDollar)}
                </td>
              ) : null}
              {comparing ? (
                <td className={"stmt-amt amount" + (r.changeNegative ? " neg" : "")}>
                  {money(r.changeDisplay, r.changeNegative, withDollar && changeMode === "amount")}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function StatementView({ entityId }: { entityId: string }) {
  const [which, setWhich] = useState<"pl" | "bs">("pl");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [compareMode, setCompareMode] = useState<CompareMode>("off");
  const [changeMode, setChangeMode] = useState<ChangeMode>("amount");
  const [cFrom, setCFrom] = useState("");
  const [cTo, setCTo] = useState("");
  const [data, setData] = useState<StatementsDTO | null>(null);
  const [pending, startTransition] = useTransition();

  function load(over?: Partial<{ from: string; to: string; compareMode: CompareMode; changeMode: ChangeMode; cFrom: string; cTo: string }>) {
    const f = over?.from ?? from;
    const t = over?.to ?? to;
    const cm = over?.compareMode ?? compareMode;
    const ch = over?.changeMode ?? changeMode;
    const caf = over?.cFrom ?? cFrom;
    const cat = over?.cTo ?? cTo;
    startTransition(async () => {
      setData(
        await getStatements(
          entityId,
          { from: f || undefined, to: t || undefined },
          {
            compareMode: cm,
            changeMode: ch,
            compare: cm === "custom" ? { from: caf || undefined, to: cat || undefined } : undefined,
          }
        )
      );
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  function applyPreset(f: string, t: string) {
    setFrom(f);
    setTo(t);
    load({ from: f, to: t });
  }

  const comparing = compareMode !== "off";
  const title = which === "pl" ? "Profit and Loss" : "Balance Sheet";
  const periodText =
    which === "pl"
      ? data?.periodLabel
      : data
      ? "As of " + longDateClient(data.asOf)
      : "";
  const curLabel = which === "pl" ? "Current" : "Current";
  const cmpLabel = data?.comparePeriodLabel ? "Comparison" : "Comparison";

  return (
    <div className="stmt-wrap">
      <div className="panel span-12 stmt-controls no-print">
        <div className="stmt-control-row">
          <div className="tabs">
            <button className={"tab" + (which === "pl" ? " active" : "")} onClick={() => setWhich("pl")}>
              Profit &amp; Loss
            </button>
            <button className={"tab" + (which === "bs" ? " active" : "")} onClick={() => setWhich("bs")}>
              Balance Sheet
            </button>
          </div>
          <button className="primary" onClick={() => window.print()} disabled={!data}>
            Print / Save PDF
          </button>
        </div>

        <div className="presets" style={{ marginTop: 12 }}>
          {presets().map((p) => (
            <button key={p.label} onClick={() => applyPreset(p.from, p.to)} disabled={pending}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="stmt-dates">
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            Compare to
            <select
              value={compareMode}
              onChange={(e) => {
                const v = e.target.value as CompareMode;
                setCompareMode(v);
                load({ compareMode: v });
              }}
            >
              <option value="off">No comparison</option>
              <option value="prior-year">Prior year</option>
              <option value="custom">Custom period</option>
            </select>
          </label>
          {comparing ? (
            <label>
              Change
              <select
                value={changeMode}
                onChange={(e) => {
                  const v = e.target.value as ChangeMode;
                  setChangeMode(v);
                  load({ changeMode: v });
                }}
              >
                <option value="amount">$ change</option>
                <option value="percent">% change</option>
              </select>
            </label>
          ) : null}
          <button className="primary" onClick={() => load()} disabled={pending}>
            {pending ? "…" : "Apply"}
          </button>
          <button onClick={() => { setFrom(""); setTo(""); setCompareMode("off"); load({ from: "", to: "", compareMode: "off" }); }} disabled={pending}>
            Reset
          </button>
        </div>

        {compareMode === "custom" ? (
          <div className="stmt-dates" style={{ marginTop: 8 }}>
            <label>
              Compare from
              <input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
            </label>
            <label>
              Compare to
              <input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} />
            </label>
            <button className="primary" onClick={() => load()} disabled={pending}>
              Apply comparison
            </button>
          </div>
        ) : null}

        {which === "bs" && data && !data.bsBalances ? (
          <div className="notice" style={{ marginTop: 10 }}>
            Balance sheet does not balance — check the ledger.
          </div>
        ) : null}
      </div>

      <div className="stmt-doc">
        <div className="stmt-header">
          <div className="stmt-title">{title}</div>
          <div className="stmt-company">{data?.company ?? ""}</div>
          <div className="stmt-period">{periodText}</div>
          {comparing && data?.comparePeriodLabel ? (
            <div className="stmt-period" style={{ fontSize: 12 }}>
              compared with {which === "pl" ? data.comparePeriodLabel : "as of " + cmpEnd(data)}
            </div>
          ) : null}
        </div>

        {data ? (
          <StatementTable
            rows={which === "pl" ? data.pl : data.bs}
            comparing={comparing}
            changeMode={changeMode}
            curLabel={curLabel}
            cmpLabel={cmpLabel}
          />
        ) : (
          <p className="muted" style={{ padding: 16 }}>
            {pending ? "Loading…" : "No data"}
          </p>
        )}

        <div className="stmt-footer">{data ? data.generatedAt : ""}</div>
      </div>
    </div>
  );
}

function cmpEnd(data: StatementsDTO): string {
  // comparePeriodLabel is "<long date> - <long date>"; take the end portion.
  const parts = data.comparePeriodLabel.split(" - ");
  return parts[1] || data.comparePeriodLabel;
}

function longDateClient(iso: string): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const [y, m, d] = iso.split("-").map(Number);
  return months[m - 1] + " " + d + ", " + y;
}

function presets(): { label: string; from: string; to: string }[] {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const q = Math.floor(m / 3);
  const ym = (yy: number, mm: number, dd: number) => iso(new Date(Date.UTC(yy, mm, dd)));
  const monthEnd = (yy: number, mm: number) => ym(yy, mm + 1, 0);
  return [
    { label: "This month", from: ym(y, m, 1), to: monthEnd(y, m) },
    { label: "This quarter", from: ym(y, q * 3, 1), to: monthEnd(y, q * 3 + 2) },
    { label: "YTD", from: ym(y, 0, 1), to: iso(now) },
    { label: "This year", from: ym(y, 0, 1), to: ym(y, 11, 31) },
    { label: "Last year", from: ym(y - 1, 0, 1), to: ym(y - 1, 11, 31) },
  ];
}
