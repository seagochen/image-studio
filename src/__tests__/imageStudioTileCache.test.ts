import { TileCache, serializeTileCacheKey, type PersistentTileStore } from "../domain/tileCache";

const key = { documentId: "project-1", documentVersion: "revision-1", nodeId: "layer-1", scale: 1, colorModel: "srgb-premultiplied", x: 0, y: 0 };

class FakePersistentStore implements PersistentTileStore {
  readonly values = new Map<string, Uint8Array>();
  async get(id: string): Promise<Uint8Array | null> { return this.values.get(id) ?? null; }
  async put(id: string, value: Uint8Array): Promise<void> { this.values.set(id, new Uint8Array(value)); }
  async delete(id: string): Promise<void> { this.values.delete(id); }
  async clear(): Promise<void> { this.values.clear(); }
}

class FailingPersistentStore implements PersistentTileStore {
  async get(): Promise<Uint8Array | null> { throw new Error("quota"); }
  async put(): Promise<void> { throw new Error("quota"); }
  async delete(): Promise<void> { throw new Error("quota"); }
  async clear(): Promise<void> { throw new Error("quota"); }
}

describe("TileCache", () => {
  it("isolates tiles by every rendering input and returns defensive copies", async () => {
    const cache = new TileCache(32);
    const bytes = new Uint8Array([1, 2, 3]);
    await cache.put(key, bytes);
    bytes[0] = 9;
    const result = await cache.get(key);
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
    result![1] = 9;
    expect(await cache.get(key)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await cache.get({ ...key, documentVersion: "revision-2" })).toBeNull();
  });

  it("uses LRU eviction without deleting reconstructable persistent tiles", async () => {
    const persistent = new FakePersistentStore();
    const cache = new TileCache(4, persistent);
    await cache.put(key, new Uint8Array([1, 2, 3]));
    await cache.put({ ...key, x: 1 }, new Uint8Array([4, 5, 6]));
    expect(cache.stats.memoryEntries).toBe(1);
    expect(await cache.get(key)).toEqual(new Uint8Array([1, 2, 3]));
    expect(persistent.values.size).toBe(2);
  });

  it("clears only cache data", async () => {
    const persistent = new FakePersistentStore();
    const cache = new TileCache(32, persistent);
    await cache.put(key, new Uint8Array([1]));
    await cache.clear();
    expect(cache.stats.memoryBytes).toBe(0);
    expect(persistent.values.size).toBe(0);
  });

  it("keeps the memory preview path available when persistent storage rejects writes", async () => {
    const cache = new TileCache(32, new FailingPersistentStore());
    await expect(cache.put(key, new Uint8Array([7, 8]))).resolves.toBeUndefined();
    expect(await cache.get(key)).toEqual(new Uint8Array([7, 8]));
    expect(cache.stats.persistentError).toBe(true);
  });

  it("rejects incomplete cache keys", () => {
    expect(() => serializeTileCacheKey({ ...key, nodeId: "" })).toThrow("Invalid tile cache key");
  });
});
