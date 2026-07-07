// Store factory. Selects the Blob store when a Blob token is configured
// (production on Vercel), otherwise the filesystem store (local dev).
//
// Server actions import the named functions below, so the backend choice is
// invisible to callers.

import { LedgerStore } from "./types";
import { fsStore } from "./fs";
import { blobStore } from "./blob";
import { supabaseStore } from "./supabase";

export * from "./types";

function pickStore(): LedgerStore {
  // Preference order: Supabase (when configured) > Vercel Blob > filesystem.
  // Supabase gives a private, queryable backend that works both locally and
  // on Vercel; see supabase/schema.sql for the one-time table setup.
  const hasSupabase =
    !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    !!(
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_KEY
    );
  if (hasSupabase) return supabaseStore;
  // Use Blob whenever a Blob store is connected. Connecting a store may expose
  // any of these vars (BLOB_READ_WRITE_TOKEN isn't always present), so detect
  // on any of them. Also: on Vercel the filesystem is read-only, so never fall
  // back to the fs store there — Blob is the only viable backend.
  const hasBlob =
    !!process.env.BLOB_READ_WRITE_TOKEN ||
    !!process.env.BLOB_STORE_ID ||
    !!process.env.BLOB_WEBHOOK_PUBLIC_KEY;
  const onVercel = !!process.env.VERCEL;
  return hasBlob || onVercel ? blobStore : fsStore;
}

const store = pickStore();

export const listEntities = () => store.listEntities();
export const loadEntity = (id: string) => store.loadEntity(id);
export const saveEntity = (id: string, beancount: string) =>
  store.saveEntity(id, beancount);
export const createEntity = (id: string, name: string) =>
  store.createEntity(id, name);
export const deleteEntityFromStore = (id: string) => store.deleteEntity(id);
export const loadAux = (id: string) => store.loadAux(id);
export const saveAux = (id: string, json: string) => store.saveAux(id, json);
