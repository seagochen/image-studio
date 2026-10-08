import { OpfsTileStore, TileCache, serializeTileCacheKey } from "../domain/tileCache";

class FakeDirectory {
  readonly files = new Map<string, { bytes: Uint8Array; modified: number }>();
  private clock = 0;
  async *keys() { yield* this.files.keys(); }
  async removeEntry(name: string) {
    if (!this.files.delete(name)) throw new DOMException("Missing", "NotFoundError");
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException("Missing", "NotFoundError");
      this.files.set(name, { bytes: new Uint8Array(), modified: ++this.clock });
    }
    return {
      getFile: async () => {
        const { bytes, modified } = this.files.get(name)!;
        return { size: bytes.byteLength, lastModified: modified, arrayBuffer: async () => new Uint8Array(bytes).buffer };
      },
      createWritable: async () => {
        let staged = new Uint8Array();
        return {
          write: async (bytes: Uint8Array) => { staged = new Uint8Array(bytes); },
          close: async () => { this.files.set(name, { bytes: staged, modified: ++this.clock }); },
          abort: async () => undefined,
        };
      },
    };
  }
  get size() { return [...this.files.values()].reduce((sum, file) => sum + file.bytes.byteLength, 0); }
}

describe("persistent preview budget", () => {
  const directories = new Map<string, FakeDirectory>();
  const budget = 8;
  const key = { documentId: "document", documentVersion: "v1", nodeId: "preview", scale: 1, colorModel: "srgb", x: 0, y: 0 };
  let storageDescriptor: PropertyDescriptor | undefined;
  let locksDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    directories.clear();
    storageDescriptor = Object.getOwnPropertyDescriptor(navigator, "storage");
    locksDescriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "storage", { configurable: true, value: { getDirectory: async () => ({
      getDirectoryHandle: async (name: string) => {
        if (!directories.has(name)) directories.set(name, new FakeDirectory());
        return directories.get(name)!;
      },
    }) } });
    const queues = new Map<string, Promise<unknown>>();
    Object.defineProperty(navigator, "locks", { configurable: true, value: {
      request: (name: string, operation: () => Promise<unknown>) => {
        const result = (queues.get(name) ?? Promise.resolve()).then(operation);
        queues.set(name, result.catch(() => undefined));
        return result;
      },
    } });
  });

  afterEach(() => {
    if (storageDescriptor) Object.defineProperty(navigator, "storage", storageDescriptor);
    else delete (navigator as any).storage;
    if (locksDescriptor) Object.defineProperty(navigator, "locks", locksDescriptor);
    else delete (navigator as any).locks;
  });

  it("evicts oldest document versions while retaining readable recent tiles across reloads", async () => {
    const store = (await OpfsTileStore.open("preview", budget))!;
    for (let version = 1; version <= 20; version++) {
      await store.put(serializeTileCacheKey({ ...key, documentVersion: `v${version}` }), new Uint8Array([version, 1, 2, 3]));
      expect(directories.get("preview")!.size).toBeLessThanOrEqual(budget);
    }
    expect(await store.get(serializeTileCacheKey(key))).toBeNull();
    const reopened = (await OpfsTileStore.open("preview", budget))!;
    expect(await reopened.get(serializeTileCacheKey({ ...key, documentVersion: "v20" }))).toEqual(new Uint8Array([20, 1, 2, 3]));
    expect(directories.get("preview")!.files.size).toBe(2);
  });

  it("trims pre-existing oversized caches on open and skips tiles larger than the budget", async () => {
    const legacy = (await OpfsTileStore.open("preview"))!;
    await legacy.put("old", new Uint8Array(7)); await legacy.put("recent", new Uint8Array(6));
    const store = (await OpfsTileStore.open("preview", budget))!;
    expect(await store.get("old")).toBeNull();
    expect(await store.get("recent")).toHaveLength(6);
    await store.put("too-large", new Uint8Array(9));
    expect(await store.get("too-large")).toBeNull();
    expect(directories.get("preview")!.size).toBe(6);
  });

  it("coordinates concurrent instances, replacements and clearing without touching history or drafts", async () => {
    const first = (await OpfsTileStore.open("preview", budget))!;
    const second = (await OpfsTileStore.open("preview", budget))!;
    const history = (await OpfsTileStore.open("pixel-history"))!;
    const draft = (await OpfsTileStore.open("drafts"))!;
    await history.put("undo", new Uint8Array(12)); await draft.put("source", new Uint8Array(12));
    await Promise.all([first.put("a", new Uint8Array(6)), second.put("b", new Uint8Array(6))]);
    expect(directories.get("preview")!.size).toBe(6);
    await second.put("b", new Uint8Array(8));
    expect(directories.get("preview")!.size).toBe(8);
    await Promise.all([first.put("c", new Uint8Array(4)), second.clear(), first.put("after-clear", new Uint8Array(4))]);
    expect(await first.get("after-clear")).toHaveLength(4);
    expect(directories.get("preview")!.size).toBe(4);
    expect(await history.get("undo")).toHaveLength(12);
    expect(await draft.get("source")).toHaveLength(12);
  });

  it("falls back to memory when locks are unavailable or persistent writes fail", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    expect(await OpfsTileStore.open("preview", budget)).toBeNull();
    const cache = new TileCache(8);
    await cache.put(key, new Uint8Array([1]));
    expect(await cache.get(key)).toEqual(new Uint8Array([1]));
    expect(await OpfsTileStore.open("pixel-history")).not.toBeNull();
  });
});
