export interface TileCacheKey {
  documentId: string;
  documentVersion: string;
  nodeId: string;
  scale: number;
  colorModel: string;
  x: number;
  y: number;
}

export interface TileCacheStats {
  memoryBytes: number;
  memoryEntries: number;
  persistentAvailable: boolean;
  persistentError: boolean;
}

export interface PersistentTileStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

interface Entry { value: Uint8Array; bytes: number }

/**
 * Stores only renderer outputs that can be reconstructed from a document and
 * its assets. The caller is responsible for including every rendering input in
 * TileCacheKey; this store never treats a cached value as project data.
 */
export class TileCache {
  private readonly memory = new Map<string, Entry>();
  private memoryBytes = 0;
  private persistentError = false;

  constructor(private readonly maxMemoryBytes: number, private readonly persistent?: PersistentTileStore) {
    if (!Number.isSafeInteger(maxMemoryBytes) || maxMemoryBytes < 1) throw new Error("Invalid tile cache memory budget");
  }

  async get(key: TileCacheKey): Promise<Uint8Array | null> {
    const id = serializeTileCacheKey(key);
    const memory = this.memory.get(id);
    if (memory) {
      this.memory.delete(id); this.memory.set(id, memory);
      return copy(memory.value);
    }
    if (!this.persistent) return null;
    try {
      const stored = await this.persistent.get(id);
      if (!stored) return null;
      this.remember(id, stored);
      return copy(stored);
    } catch {
      this.persistentError = true;
      return null;
    }
  }

  async put(key: TileCacheKey, value: Uint8Array): Promise<void> {
    const id = serializeTileCacheKey(key);
    const safeValue = copy(value);
    this.remember(id, safeValue);
    if (!this.persistent) return;
    try { await this.persistent.put(id, safeValue); }
    catch { this.persistentError = true; }
  }

  async delete(key: TileCacheKey): Promise<void> {
    const id = serializeTileCacheKey(key);
    this.forget(id);
    if (!this.persistent) return;
    try { await this.persistent.delete(id); }
    catch { this.persistentError = true; }
  }

  async clear(): Promise<void> {
    this.memory.clear(); this.memoryBytes = 0;
    if (!this.persistent) return;
    try { await this.persistent.clear(); }
    catch { this.persistentError = true; }
  }

  get stats(): TileCacheStats {
    return {
      memoryBytes: this.memoryBytes,
      memoryEntries: this.memory.size,
      persistentAvailable: Boolean(this.persistent),
      persistentError: this.persistentError,
    };
  }

  private remember(id: string, value: Uint8Array): void {
    this.forget(id);
    const entry = { value: copy(value), bytes: value.byteLength };
    if (entry.bytes > this.maxMemoryBytes) return;
    this.memory.set(id, entry); this.memoryBytes += entry.bytes;
    while (this.memoryBytes > this.maxMemoryBytes && this.memory.size) {
      const oldest = this.memory.keys().next().value as string;
      this.forget(oldest);
    }
  }

  private forget(id: string): void {
    const previous = this.memory.get(id);
    if (!previous) return;
    this.memory.delete(id); this.memoryBytes -= previous.bytes;
  }
}

/** A minimal OPFS adapter. Failure is intentionally non-fatal: its data is disposable. */
export class OpfsTileStore implements PersistentTileStore {
  private constructor(private readonly directory: OpfsDirectory, private readonly directoryName: string,
    private readonly maxBytes?: number) {}

  static async open(directoryName = "skillsmaster-image-studio-tiles", maxBytes?: number): Promise<OpfsTileStore | null> {
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) throw new Error("Invalid persistent tile budget");
    // Budgeted caches require a cross-tab lock. Without one, use memory previews.
    if (maxBytes !== undefined && !navigator.locks?.request) return null;
    const storage = (navigator as Navigator & { storage?: { getDirectory?: () => Promise<OpfsDirectory> } }).storage;
    if (!storage?.getDirectory) return null;
    const root = await storage.getDirectory() as unknown as OpfsDirectory;
    const store = new OpfsTileStore(await root.getDirectoryHandle(directoryName, { create: true }), directoryName, maxBytes);
    await store.exclusive(() => store.makeRoom(0));
    return store;
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.exclusive(async () => {
      try {
        const handle = await this.directory.getFileHandle(filename(key));
        return new Uint8Array(await (await handle.getFile()).arrayBuffer());
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    });
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    const bytes = copy(value);
    await this.exclusive(async () => {
      const name = filename(key);
      if (this.maxBytes !== undefined && bytes.byteLength > this.maxBytes) return;
      await this.makeRoom(bytes.byteLength, name);
      const writable = await (await this.directory.getFileHandle(name, { create: true })).createWritable();
      try { await writable.write(bytes); await writable.close(); }
      catch (error) { await writable.abort?.(); throw error; }
    });
  }

  async delete(key: string): Promise<void> {
    await this.exclusive(async () => {
      try { await this.directory.removeEntry(filename(key)); }
      catch (error) { if (!isNotFound(error)) throw error; }
    });
  }

  async clear(): Promise<void> {
    await this.exclusive(async () => {
      for await (const name of this.directory.keys()) await this.directory.removeEntry(name);
    });
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.maxBytes === undefined ? await operation()
      : await navigator.locks.request(`image-studio-opfs:${this.directoryName}`, operation);
  }

  /** File metadata survives reloads; prune oldest writes before allocating another tile. */
  private async makeRoom(incomingBytes: number, replacing?: string): Promise<void> {
    if (this.maxBytes === undefined) return;
    const entries: { name: string; bytes: number; modified: number }[] = [];
    for await (const name of this.directory.keys()) {
      const file = await (await this.directory.getFileHandle(name)).getFile();
      entries.push({ name, bytes: file.size, modified: file.lastModified });
    }
    let bytes = entries.reduce((sum, entry) => sum + entry.bytes, incomingBytes);
    // Remove the replaced file first: retaining its old bytes while writing can exceed the budget.
    entries.sort((a, b) => a.name === replacing ? -1 : b.name === replacing ? 1 : a.modified - b.modified || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name !== replacing && bytes <= this.maxBytes) break;
      await this.directory.removeEntry(entry.name);
      bytes -= entry.bytes;
    }
  }
}

export function serializeTileCacheKey(key: TileCacheKey): string {
  if (!key.documentId || !key.documentVersion || !key.nodeId || !key.colorModel
    || !Number.isFinite(key.scale) || key.scale <= 0 || !Number.isInteger(key.x) || !Number.isInteger(key.y)) {
    throw new Error("Invalid tile cache key");
  }
  return JSON.stringify([key.documentId, key.documentVersion, key.nodeId, key.scale, key.colorModel, key.x, key.y]);
}

interface OpfsFile { size: number; lastModified: number; arrayBuffer(): Promise<ArrayBuffer> }
interface OpfsFileHandle { getFile(): Promise<OpfsFile>; createWritable(): Promise<OpfsWritable> }
interface OpfsWritable { write(value: Uint8Array): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }
interface OpfsDirectory {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterableIterator<string>;
}

function filename(key: string): string { return `${encodeURIComponent(key)}.tile`; }
function copy(value: Uint8Array): Uint8Array { return new Uint8Array(value); }
function isNotFound(error: unknown): boolean { return error instanceof DOMException && error.name === "NotFoundError"; }
