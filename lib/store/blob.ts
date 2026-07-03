// Vercel Blob-backed ledger store (production).
//
// Stores each entity as a `.beancount` blob under the `ledgers/` prefix. Used
// when BLOB_READ_WRITE_TOKEN is present. Durable across deploys and shared
// across serverless instances, unlike the filesystem.
//
// Privacy note: Vercel Blob only supports `access: "public"`, so these files
// are technically world-readable BY URL. To stop them from being *guessable*
// (you could previously fetch any entity at ledgers/<id>.beancount), each blob
// path now carries a random token: ledgers/<id>__<random>.beancount. The id is
// still embedded so listing works, but the full pathname — and therefore the
// public URL — cannot be derived from the id alone. This is obscurity, not
// real access control; genuine privacy needs a private store + server auth.

import { list, put, del } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import {
  LedgerStore,
  StoredEntity,
  SAMPLE_ID,
  SAMPLE_LEDGER,
  safeId,
  titleOf,
  ownerOf,
} from "./types";

const PREFIX = "ledgers/";
const suffix = ".beancount";
// Separates the (public) entity id from the random, unguessable token.
const SEP = "__";

/** A fresh, unguessable pathname for a new entity. */
function newPathFor(id: string): string {
  const token = randomBytes(16).toString("hex"); // 128 bits
  return PREFIX + safeId(id) + SEP + token + suffix;
}

/** Pull the entity id back out of a blob pathname (token-tolerant). */
function idFromPath(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX) || !pathname.endsWith(suffix)) return null;
  const stem = pathname.slice(PREFIX.length, -suffix.length);
  const sepAt = stem.indexOf(SEP);
  // New format: "<id>__<token>". Legacy format: just "<id>".
  return sepAt === -1 ? stem : stem.slice(0, sepAt);
}

/** Map of entity id -> { url, pathname } (Blob keys aren't directly fetchable). */
async function index(): Promise<Map<string, { url: string; pathname: string }>> {
  const { blobs } = await list({ prefix: PREFIX });
  const map = new Map<string, { url: string; pathname: string }>();
  for (const b of blobs) {
    const id = idFromPath(b.pathname);
    if (!id) continue;
    // If duplicates ever exist for an id, the last one listed wins; saves reuse
    // the existing pathname, so duplicates shouldn't accumulate.
    map.set(id, { url: b.url, pathname: b.pathname });
  }
  return map;
}

async function readUrl(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Blob fetch failed: " + res.status);
  return res.text();
}

export const blobStore: LedgerStore = {
  async listEntities() {
    let map = await index();
    if (map.size === 0) {
      await this.saveEntity(SAMPLE_ID, SAMPLE_LEDGER);
      map = await index();
    }
    const out: { id: string; name: string; owner: string }[] = [];
    for (const [id, { url }] of map) {
      const text = await readUrl(url);
      out.push({ id, name: titleOf(text, id), owner: ownerOf(text) });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },

  async loadEntity(id: string): Promise<StoredEntity | null> {
    const map = await index();
    const entry = map.get(safeId(id));
    if (!entry) return null;
    const text = await readUrl(entry.url);
    return { id, name: titleOf(text, id), beancount: text };
  },

  async saveEntity(id: string, beancount: string): Promise<void> {
    // Reuse the existing random pathname on overwrite so the entity id stays
    // durable. If the only existing file is a LEGACY guessable path
    // (ledgers/<id>.beancount, no token), migrate: write to a fresh random
    // path, then delete the old guessable blob so its public URL stops working.
    const map = await index();
    const existing = map.get(safeId(id));
    const legacyPath = PREFIX + safeId(id) + suffix; // old, guessable format
    const isLegacy = !!existing && existing.pathname === legacyPath;
    const pathname = existing && !isLegacy ? existing.pathname : newPathFor(id);
    await put(pathname, beancount, {
      access: "public",
      contentType: "text/plain; charset=utf-8",
      allowOverwrite: true,
      addRandomSuffix: false,
    });
    if (isLegacy && existing) await del(existing.url);
  },

  async createEntity(id: string, name: string): Promise<StoredEntity> {
    const text =
      'option "title" "' + name.replace(/"/g, "'") + '"\noption "operating_currency" "USD"\n\n';
    await this.saveEntity(id, text);
    return { id, name, beancount: text };
  },

  async deleteEntity(id: string): Promise<void> {
    const map = await index();
    const entry = map.get(safeId(id));
    if (entry) await del(entry.url);
  },
};
