// Supabase-backed ledger store.
//
// Each entity is one row in the `plaingl_ledgers` table: the full Beancount
// text plus the aux sidecar JSON. Selected when SUPABASE_URL and a key are
// configured (see index.ts); works locally and on Vercel.
//
// Table setup: run supabase/schema.sql in the Supabase SQL editor once.
// Uses the service-role (or secret) key from the server only — never expose
// that key to the browser.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  LedgerStore,
  StoredEntity,
  SAMPLE_ID,
  SAMPLE_LEDGER,
  safeId,
  titleOf,
  ownerOf,
} from "./types";

const TABLE = "plaingl_ledgers";

let client: SupabaseClient | null = null;

function sb(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error("Supabase store selected but SUPABASE_URL / key env vars are missing");
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

async function seedIfEmpty(): Promise<void> {
  const { count, error } = await sb().from(TABLE).select("id", { count: "exact", head: true });
  if (error) throw new Error("Supabase: " + error.message);
  if ((count || 0) > 0) return;
  await supabaseStore.saveEntity(SAMPLE_ID, SAMPLE_LEDGER);
}

export const supabaseStore: LedgerStore = {
  async listEntities() {
    await seedIfEmpty();
    const { data, error } = await sb().from(TABLE).select("id, beancount");
    if (error) throw new Error("Supabase: " + error.message);
    const out = (data || []).map((row) => ({
      id: row.id as string,
      name: titleOf(row.beancount as string, row.id as string),
      owner: ownerOf(row.beancount as string),
    }));
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },

  async loadEntity(id: string): Promise<StoredEntity | null> {
    const { data, error } = await sb()
      .from(TABLE)
      .select("id, beancount")
      .eq("id", safeId(id))
      .maybeSingle();
    if (error) throw new Error("Supabase: " + error.message);
    if (!data) return null;
    return {
      id: data.id as string,
      name: titleOf(data.beancount as string, data.id as string),
      beancount: data.beancount as string,
    };
  },

  async saveEntity(id: string, beancount: string): Promise<void> {
    const { error } = await sb()
      .from(TABLE)
      .upsert(
        { id: safeId(id), beancount, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    if (error) throw new Error("Supabase: " + error.message);
  },

  async createEntity(id: string, name: string): Promise<StoredEntity> {
    const text =
      'option "title" "' + name.replace(/"/g, "'") + '"\noption "operating_currency" "USD"\n\n';
    await this.saveEntity(id, text);
    return { id, name, beancount: text };
  },

  async deleteEntity(id: string): Promise<void> {
    const { error } = await sb().from(TABLE).delete().eq("id", safeId(id));
    if (error) throw new Error("Supabase: " + error.message);
  },

  async loadAux(id: string): Promise<string> {
    const { data, error } = await sb()
      .from(TABLE)
      .select("aux")
      .eq("id", safeId(id))
      .maybeSingle();
    if (error) throw new Error("Supabase: " + error.message);
    if (!data || data.aux == null) return "{}";
    return typeof data.aux === "string" ? data.aux : JSON.stringify(data.aux);
  },

  async saveAux(id: string, json: string): Promise<void> {
    let auxValue: unknown;
    try {
      auxValue = JSON.parse(json);
    } catch {
      auxValue = {};
    }
    // The entity row may not exist yet (aux saved before the first ledger
    // write); upsert with an empty ledger so the aux isn't lost.
    const { data, error } = await sb()
      .from(TABLE)
      .update({ aux: auxValue, updated_at: new Date().toISOString() })
      .eq("id", safeId(id))
      .select("id");
    if (error) throw new Error("Supabase: " + error.message);
    if (!data || data.length === 0) {
      const { error: insErr } = await sb()
        .from(TABLE)
        .upsert(
          { id: safeId(id), beancount: "", aux: auxValue, updated_at: new Date().toISOString() },
          { onConflict: "id" }
        );
      if (insErr) throw new Error("Supabase: " + insErr.message);
    }
  },
};
