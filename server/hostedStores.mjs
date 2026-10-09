import crypto from "node:crypto";
import path from "node:path";
import { openStore, StoreError } from "./store.mjs";

const MAX_OPEN_STORES = 64;

/** Each platform identity owns a separate application database and asset tree. */
export function createHostedStores(storage) {
  const entries = new Map();
  return {
    acquire(userId) {
      const key = crypto.createHash("sha256").update(userId).digest("hex");
      let entry = entries.get(key);
      if (!entry) {
        if (entries.size >= MAX_OPEN_STORES) {
          const idle = [...entries].find(([, value]) => value.references === 0);
          if (!idle) throw new StoreError(503, "Image Studio storage is busy");
          idle[1].store.close(); entries.delete(idle[0]);
        }
        const root = path.join(storage.rootDir, "users", key);
        const store = openStore({ ...storage, databasePath: path.join(root, "db", "image-studio.sqlite"), dataDir: path.join(root, "storage") });
        store.recover({ idempotentSubmit: true });
        entry = { store, references: 0 };
        entries.set(key, entry);
      }
      entry.references += 1;
      let released = false;
      return { store: entry.store, release() { if (!released) { released = true; entry.references -= 1; } } };
    },
    close() { for (const { store } of entries.values()) store.close(); entries.clear(); },
  };
}
