// Shape of the per-entity aux sidecar JSON (stored next to the ledger).
// Types only — safe to import from client components.

import type { Rule } from "./rules";

export interface ReconcileSettings {
  /** Statement period (ISO dates); optional. */
  from?: string;
  to?: string;
  /** Statement balances in cents. */
  beginningCents?: number;
  endingCents?: number;
}

export interface AuxData {
  /** Classification rules, applied in array order. */
  rules: Rule[];
  /** Statement-file account label -> ledger account (remembered mappings). */
  accountMap: Record<string, string>;
  /** Reconcile settings per ledger account. */
  reconcile: Record<string, ReconcileSettings>;
  /** Chart-of-accounts descriptions per ledger account. */
  coaDesc: Record<string, string>;
}

export function emptyAux(): AuxData {
  return { rules: [], accountMap: {}, reconcile: {}, coaDesc: {} };
}

/** Parse an aux JSON string defensively; malformed pieces fall back empty. */
export function parseAux(json: string): AuxData {
  const out = emptyAux();
  try {
    const data = JSON.parse(json || "{}");
    if (data && typeof data === "object") {
      if (Array.isArray(data.rules)) out.rules = data.rules;
      if (data.accountMap && typeof data.accountMap === "object") out.accountMap = data.accountMap;
      if (data.reconcile && typeof data.reconcile === "object") out.reconcile = data.reconcile;
      if (data.coaDesc && typeof data.coaDesc === "object") out.coaDesc = data.coaDesc;
    }
  } catch {
    /* keep empty */
  }
  return out;
}
