import { DocumentHistory } from "../domain/history";
import { applyPixelTileDiffs, PixelTileArchive, PixelTileRecorder } from "../domain/pixelTileHistory";
import { OpfsTileStore, type PersistentTileStore } from "../domain/tileCache";
import { createEmptyDocument, type ImageStudioDocument } from "../domain/document";
import { rasterLayerFromImage } from "../domain/importImage";

class TestImageData {
  constructor(public readonly data: Uint8ClampedArray, public readonly width: number, public readonly height: number) {}
}

class Pixels {
  readonly data: Uint8ClampedArray;
  constructor(readonly width: number, readonly height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
  getImageData(x: number, y: number, width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) data.set(this.data.subarray(((y + row) * this.width + x) * 4, ((y + row) * this.width + x + width) * 4), row * width * 4);
    return { data };
  }
  putImageData(image: TestImageData, x: number, y: number) {
    for (let row = 0; row < image.height; row += 1) this.data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((y + row) * this.width + x) * 4);
  }
}

type TestCanvas = HTMLCanvasElement & { pixels: Pixels };

function canvas(width = 512, height = 256): TestCanvas {
  const pixels = new Pixels(width, height);
  return { width, height, pixels, getContext: () => pixels } as unknown as TestCanvas;
}

describe("Image Studio pixel tile history", () => {
  beforeEach(() => { Object.assign(globalThis, { ImageData: TestImageData }); });

  it("captures and restores only changed affected tiles", () => {
    const target = canvas();
    const recorder = new PixelTileRecorder(target);
    recorder.capture(260, 8, 4, 4);
    target.pixels.data[((8 * target.width + 260) * 4)] = 201;
    const diffs = recorder.finish();
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ x: 256, y: 0, width: 256, height: 256 });
    applyPixelTileDiffs(target, diffs, "before");
    expect(target.pixels.data[((8 * target.width + 260) * 4)]).toBe(0);
    applyPixelTileDiffs(target, diffs, "after");
    expect(target.pixels.data[((8 * target.width + 260) * 4)]).toBe(201);
  });

  it("keeps direct pixel undo entries as tile bytes rather than document snapshots", async () => {
    const target = canvas(8, 8);
    const recorder = new PixelTileRecorder(target, 4);
    recorder.capture(1, 1, 1, 1);
    target.pixels.data[((1 * target.width + 1) * 4)] = 99;
    const diffs = recorder.finish();
    const history = new DocumentHistory({ maxEntries: 10, maxBytes: 128 });
    const before = createEmptyDocument();
    const after = { ...before, title: "Pixel result" };
    history.executePixel(before, after, "Pixel edit", "raster-1", diffs);
    expect(history.state).toMatchObject({ entries: 1, bytes: 128 });
    const undo = await history.undo(after, async (current, layerId, patch, direction) => {
      expect(layerId).toBe("raster-1"); applyPixelTileDiffs(target, patch, direction); return { ...current, title: "Restored" };
    });
    expect(undo.title).toBe("Restored");
    expect(target.pixels.data[((1 * target.width + 1) * 4)]).toBe(0);
    const redo = await history.redo(undo, async (current, _layerId, patch, direction) => {
      applyPixelTileDiffs(target, patch, direction); return { ...current, title: "Redone" };
    });
    expect(redo.title).toBe("Redone");
    expect(target.pixels.data[((1 * target.width + 1) * 4)]).toBe(99);
  });

  it("undoes a lifted selection as one pixel and layer transaction", async () => {
    const target = canvas(4, 4), recorder = new PixelTileRecorder(target, 4);
    recorder.capture(0, 0, 1, 1); target.pixels.data[3] = 255;
    const diffs = recorder.finish();
    const source = rasterLayerFromImage({ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", width: 4, height: 4, name: "Source" });
    const lifted = { ...source, id: "lifted", width: 1, height: 1, source: { kind: "data-url" as const,
      value: "data:image/png;base64,BBBB", mimeType: "image/png" } };
    const before: ImageStudioDocument = { ...createEmptyDocument(), layers: [source], selection: { layerId: source.id } };
    const changedSource = { ...source, source: { kind: "data-url" as const,
      value: "data:image/png;base64,CCCC", mimeType: "image/png" } };
    const after = { ...before, layers: [changedSource, lifted], selection: { layerId: lifted.id } };
    const history = new DocumentHistory({ maxEntries: 10, maxBytes: 4096 });
    expect(history.canRecordPixelLift(diffs, lifted)).toBe(true);
    expect(history.executePixel(before, after, "Lift", source.id, diffs, lifted)).toBe(after);
    const resolve = async (current: ImageStudioDocument, _id: string, patch: readonly (typeof diffs)[number][], direction: "before" | "after") => {
      applyPixelTileDiffs(target, patch, direction);
      return { ...current, layers: current.layers.map((layer) => layer.id === source.id
        ? (direction === "before" ? source : changedSource) : layer) };
    };
    const undone = await history.undo(after, resolve);
    expect(undone.layers.map((layer) => layer.id)).toEqual([source.id]);
    expect(undone.selection.layerId).toBe(source.id);
    expect(target.pixels.data[3]).toBe(0);
    const redone = await history.redo(undone, resolve);
    expect(redone.layers.map((layer) => layer.id)).toEqual([source.id, lifted.id]);
    expect(redone.selection.layerId).toBe(lifted.id);
    expect(target.pixels.data[3]).toBe(255);
  });

  it("removes partial OPFS history data when quota rejects an archive write", async () => {
    const values = new Map<string, Uint8Array>();
    let writes = 0;
    const persistent: PersistentTileStore = {
      get: async (id) => values.get(id) ?? null,
      put: async (id, value) => { if (++writes === 2) throw new Error("quota"); values.set(id, value); },
      delete: async (id) => { values.delete(id); },
      clear: async () => { values.clear(); },
    };
    const open = jest.spyOn(OpfsTileStore, "open").mockResolvedValue(persistent as OpfsTileStore);
    try {
      const archive = await PixelTileArchive.open();
      const target = canvas(2, 2), recorder = new PixelTileRecorder(target, 2);
      recorder.capture(0, 0, 1, 1); target.pixels.data[0] = 99;
      await expect(archive!.write("partial", recorder.finish())).rejects.toThrow("archive is unavailable");
      expect(values.size).toBe(0);
    } finally { open.mockRestore(); }
  });

  it("keeps the document and undo entry intact when tile recovery fails", async () => {
    const target = canvas(4, 4), recorder = new PixelTileRecorder(target, 4);
    recorder.capture(0, 0, 1, 1); target.pixels.data[0] = 88;
    const history = new DocumentHistory();
    const before = createEmptyDocument(), after = { ...before, title: "Unchanged after failed recovery" };
    history.executePixel(before, after, "Pixel edit", "raster-1", recorder.finish());
    await expect(history.undo(after, async () => { throw new Error("OPFS data is corrupt"); })).rejects.toThrow("OPFS data is corrupt");
    expect(history.state).toMatchObject({ canUndo: true, canRedo: false, entries: 1 });
  });

  it("rejects a malformed later tile before applying any earlier tile", () => {
    const target = canvas(4, 4), before = new Uint8ClampedArray(64), after = new Uint8ClampedArray(64).fill(99);
    expect(() => applyPixelTileDiffs(target, [
      { x: 0, y: 0, width: 4, height: 4, before, after },
      { x: 4, y: 0, width: 1, height: 1, before: new Uint8ClampedArray(4), after: new Uint8ClampedArray(4) },
    ], "after")).toThrow("Invalid pixel history tile");
    expect(target.pixels.data).toEqual(before);
  });

  const coldDiff = () => [{ x: 0, y: 0, width: 1024, height: 1664,
    before: new Uint8ClampedArray(1024 * 1664 * 4), after: new Uint8ClampedArray(1024 * 1664 * 4) }];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("uses distinct OPFS archive IDs for simultaneous editor sessions", async () => {
    const ids: string[] = [];
    const archive = { write: async (id: string) => { ids.push(id); return { id, tiles: [] }; }, remove: async () => {} } as unknown as PixelTileArchive;
    const before = createEmptyDocument(), after = { ...before, title: "Changed" };
    for (let session = 0; session < 2; session++) {
      const history = new DocumentHistory(); history.setPixelArchive(archive);
      history.executePixel(before, after, "Large edit", "raster", coldDiff());
    }
    await settle();
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("cleans a write that finishes after history was cleared", async () => {
    let finish!: () => void;
    const remove = jest.fn().mockResolvedValue(undefined);
    const archive = { write: (id: string) => new Promise((resolve) => {
      finish = () => resolve({ id, tiles: [] });
    }), remove } as unknown as PixelTileArchive;
    const history = new DocumentHistory(); history.setPixelArchive(archive);
    const before = createEmptyDocument(), after = { ...before, title: "Changed" };
    history.executePixel(before, after, "Large edit", "raster", coldDiff());
    history.clear(); finish(); await settle();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(history.state).toMatchObject({ entries: 0, canUndo: false, bytes: 0 });
  });

  it("serializes offloads and observes edits added during an outstanding write", async () => {
    const finishes: Array<() => void> = [];
    const write = jest.fn((id: string) => new Promise((resolve) => { finishes.push(() => resolve({ id, tiles: [] })); }));
    const archive = { write, remove: async () => {} } as unknown as PixelTileArchive;
    const history = new DocumentHistory(); history.setPixelArchive(archive);
    const before = createEmptyDocument(), after = { ...before, title: "Changed" };
    history.executePixel(before, after, "First", "raster", coldDiff());
    history.executePixel(after, before, "Second", "raster", coldDiff());
    expect(write).toHaveBeenCalledTimes(1);
    finishes[0](); await settle();
    expect(write).toHaveBeenCalledTimes(2);
    finishes[1](); await settle();
    history.clear();
  });
});
