// Vercel Blob-backed ledger store (production).
//
// Stores each entity as a `.beancount` blob under the `ledgers/` prefix. Used
// when BLOB_READ_WRITE_TOKEN is present. Durable across deploys and shared
// across serverless instances, unlike the filesystem.

import { list, put, del } from "@vercel/blob";
import {
  LedgerStore,
  StoredEntity,
  SAMPLE_ID,
  SAMPLE_LEDGER,
  safeId,
  titleOf,
} from "./types";

const PREFIX = "ledgers/";
const suffix = ".beancount";

function pathFor(id: string): string {
  return PREFIX + safeId(id) + suffix;
}

/** Map of entity id -> blob download URL (Blob keys are not directly fetchable). */
async function index(): Promise<Map<string, string>> {
  const { blobs } = await list({ prefix: PREFIX });
  const map = new Map<string, string>();
  for (const b of blobs) {
    if (!b.pathname.endsWith(suffix)) continue;
    const id = b.pathname.slice(PREFIX.length, -suffix.length);
    map.set(id, b.url);
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
    const out: { id: string; name: string }[] = [];
    for (const [id, url] of map) {
      const text = await readUrl(url);
      out.push({ id, name: titleOf(text, id) });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },

  async loadEntity(id: string): Promise<StoredEntity | null> {
    const map = await index();
    const url = map.get(safeId(id));
    if (!url) return null;
    const text = await readUrl(url);
    return { id, name: titleOf(text, id), beancount: text };
  },

  async saveEntity(id: string, beancount: string): Promise<void> {
    // allowOverwrite keeps the stable pathname so the entity id is durable.
    await put(pathFor(id), beancount, {
      access: "public",
      contentType: "text/plain; charset=utf-8",
      allowOverwrite: true,
      addRandomSuffix: false,
    });
  },

  async createEntity(id: string, name: string): Promise<StoredEntity> {
    const text =
      'option "title" "' + name.replace(/"/g, "'") + '"\noption "operating_currency" "USD"\n\n';
    await this.saveEntity(id, text);
    return { id, name, beancount: text };
  },

  async deleteEntity(id: string): Promise<void> {
    const map = await index();
    const url = map.get(safeId(id));
    if (url) await del(url);
  },
};
