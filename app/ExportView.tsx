"use client";

import { useEffect, useState, useTransition } from "react";
import { getExportSample, buildExport, type ExportInfo } from "./actions";

export default function ExportView({ entityId }: { entityId: string }) {
  const [info, setInfo] = useState<ExportInfo | null>(null);
  const [format, setFormat] = useState<"beancount" | "txt">("beancount");
  const [scope, setScope] = useState<"full" | "range">("full");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      setInfo(await getExportSample(entityId, 10));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const ext = format === "beancount" ? ".beancount" : ".txt";

  function rangeArg() {
    return scope === "range"
      ? { from: from || undefined, to: to || undefined }
      : {};
  }

  async function download() {
    setBusy(true);
    try {
      const text = (await buildExport(entityId, rangeArg())) || "";
      // base64 data URL (no blob URLs)
      const dataUrl =
        "data:text/plain;charset=utf-8;base64," +
        btoa(unescape(encodeURIComponent(text)));
      const a = document.createElement("a");
      a.href = dataUrl;
      const suffix =
        scope === "range" && (from || to) ? "-" + (from || "start") + "_" + (to || "end") : "";
      a.download = entityId + suffix + ext;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setBusy(true);
    try {
      const text = (await buildExport(entityId, rangeArg())) || "";
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <div className="panel span-12">
        <h2 style={{ marginTop: 0 }}>Export</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Your ledger is plain text you fully own. Export the whole file or a
          date range. It opens in Fava, bean-query, or any text editor.
        </p>

        <div className="form-grid" style={{ alignItems: "start" }}>
          <label className="wide">
            File type
            <div className="radio-row">
              <label className="radio">
                <input
                  type="radio"
                  checked={format === "beancount"}
                  onChange={() => setFormat("beancount")}
                />
                .beancount
              </label>
              <label className="radio">
                <input
                  type="radio"
                  checked={format === "txt"}
                  onChange={() => setFormat("txt")}
                />
                .txt
              </label>
            </div>
          </label>

          <label className="wide">
            Scope
            <div className="radio-row">
              <label className="radio">
                <input
                  type="radio"
                  checked={scope === "full"}
                  onChange={() => setScope("full")}
                />
                Full data file
              </label>
              <label className="radio">
                <input
                  type="radio"
                  checked={scope === "range"}
                  onChange={() => setScope("range")}
                />
                Date range
              </label>
            </div>
          </label>

          {scope === "range" ? (
            <>
              <label>
                From
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="primary" onClick={download} disabled={busy}>
            {busy ? "Preparing…" : "Download " + ext}
          </button>
          <button onClick={copy} disabled={busy}>
            {copied ? "Copied ✓" : "Copy to clipboard"}
          </button>
        </div>

        {info ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 4, marginTop: 16 }}>
            {info.txnCount.toLocaleString()} transactions · {info.totalLines.toLocaleString()} lines
            {info.minDate ? ` · ${info.minDate} → ${info.maxDate}` : ""}
            {scope === "range" ? " (date range applied on export)" : ""}
          </p>
        ) : null}
      </div>

      <div className="panel span-12">
        <h3 style={{ marginTop: 0 }}>Preview (first 10 lines)</h3>
        <pre className="export-pre">
          {pending ? "Loading…" : info?.sample ?? ""}
          {info?.truncated ? "\n…" : ""}
        </pre>
      </div>
    </div>
  );
}
