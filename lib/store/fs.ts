// Filesystem-backed ledger store (local development).
//
// Writes ledgers as `.beancount` files under `data/`. Used when no Blob token
// is configured (i.e. local dev). On Vercel the filesystem is read-only except
// /tmp, so production uses the Blob store instead (see index.ts).

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  LedgerStore,
  StoredEntity,
  SAMPLE_ID,
  SAMPLE_LEDGER,
  safeId,
  titleOf,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

function fileFor(id: string): string {
  return path.join(DATA_DIR, safeId(id) + ".beancount");
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export const fsStore: LedgerStore = {
  async listEntities() {
    await ensureDir();
    await seedIfEmpty();
    const files = await fs.readdir(DATA_DIR);
    const out: { id: string; name: string }[] = [];
    for (const f of files) {
      if (!f.endsWith(".beancount")) continue;
      const id = f.slice(0, -".beancount".length);
      const text = await fs.readFile(path.join(DATA_DIR, f), "utf8");
      out.push({ id, name: titleOf(text, id) });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },

  async loadEntity(id: string): Promise<StoredEntity | null> {
    await ensureDir();
    try {
      const text = await fs.readFile(fileFor(id), "utf8");
      return { id, name: titleOf(text, id), beancount: text };
    } catch {
      return null;
    }
  },

  async saveEntity(id: string, beancount: string): Promise<void> {
    await ensureDir();
    const target = fileFor(id);
    const tmp = target + ".tmp-" + Date.now();
    await fs.writeFile(tmp, beancount, "utf8");
    await fs.rename(tmp, target);
  },

  async createEntity(id: string, name: string): Promise<StoredEntity> {
    const text =
      'option "title" "' + name.replace(/"/g, "'") + '"\noption "operating_currency" "USD"\n\n';
    await this.saveEntity(id, text);
    return { id, name, beancount: text };
  },

  async deleteEntity(id: string): Promise<void> {
    try {
      await fs.unlink(fileFor(id));
    } catch {
      /* already gone */
    }
  },
};

async function seedIfEmpty(): Promise<void> {
  const files = await fs.readdir(DATA_DIR);
  if (files.some((f) => f.endsWith(".beancount"))) return;
  await fsStore.saveEntity(SAMPLE_ID, SAMPLE_LEDGER);
}
