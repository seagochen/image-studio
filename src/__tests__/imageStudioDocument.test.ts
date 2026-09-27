import {
  createEmptyDocument, parseDocument, serializeDocument, type ImageStudioDocument,
} from "../domain/document";
import {
  addLayer, addStroke, alignLayer, createAttachedRasterMask, createDrawingLayer, cropToLayer, deleteLayer, duplicateLayer, moveLayer, patchLayer,
  setLayerTransform,
} from "../domain/commands";
import { DocumentHistory } from "../domain/history";

describe("ImageStudioDocument", () => {
  it("round-trips a versioned document without editor adapter state", () => {
    const document = createEmptyDocument("2026-09-06T00:00:00.000Z");
    const parsed = parseDocument(serializeDocument(document));
    expect(parsed).toEqual(document);
    expect(serializeDocument(parsed)).not.toMatch(/Konva|Filerobot/);
  });

  it("rejects future versions and invalid canvases", () => {
    expect(() => parseDocument('{"version":12}')).toThrow("Unsupported");
    expect(() => parseDocument('{"version":5,"canvas":{"width":0,"height":1},"layers":[],"selection":{},"metadata":{}}')).toThrow("canvas");
  });

  it("migrates legacy local documents with deterministic paint defaults", () => {
    const paint = createDrawingLayer(createEmptyDocument(), "paint", "Paint");
    const legacyPaint = { ...paint, blendMode: undefined, strokes: [{ id: "s1", points: [{ x: 1, y: 1 }], size: 4, mode: "paint", value: 255 }] };
    const legacy = { ...createEmptyDocument(), version: 2, layers: [legacyPaint], selection: { layerId: paint.id } };
    const migrated = parseDocument(JSON.stringify(legacy));
    expect(migrated.version).toBe(11);
    expect(migrated.layers[0]).toMatchObject({ blendMode: "normal", strokes: [{ color: "#111827" }] });
    expect(migrated.layers[0].type === "paint" && migrated.layers[0].strokes[0].brush).toBeUndefined();
  });

  it("bumps a v3 document straight to the current version without touching existing layers", () => {
    const paint = createDrawingLayer(createEmptyDocument(), "paint", "Paint");
    const v3 = { ...createEmptyDocument(), version: 3, layers: [{ ...paint, blendMode: "multiply" }], selection: { layerId: paint.id } };
    const migrated = parseDocument(JSON.stringify(v3));
    expect(migrated.version).toBe(11);
    expect(migrated.layers[0]).toMatchObject({ blendMode: "multiply" });
  });

  it("supports reversible layer CRUD, ordering and drawing commands", () => {
    const initial = createEmptyDocument();
    const paint = createDrawingLayer(initial, "paint", "Paint");
    const withLayer = addLayer(initial, paint);
    const withStroke = addStroke(withLayer, paint.id, { id: "stroke-1", points: [{ x: 2, y: 3 }], size: 5, mode: "paint", value: 255, color: "#336699" });
    const duplicated = duplicateLayer(withStroke, paint.id);
    const moved = moveLayer(duplicated, paint.id, 1);
    const removed = deleteLayer(moved, paint.id);
    expect(withStroke.layers[0].type === "paint" && withStroke.layers[0].strokes).toHaveLength(1);
    expect(duplicated.layers).toHaveLength(2);
    expect(moved.layers[1].id).toBe(paint.id);
    expect(removed.layers).toHaveLength(1);
    expect(withStroke.layers[0].type === "paint" && withStroke.layers[0].strokes[0].color).toBe("#336699");

    const history = new DocumentHistory();
    const current = history.execute(initial, withLayer, "Add");
    expect(history.undo(current)).toEqual(initial);
    expect(history.redo(initial)).toEqual(withLayer);
  });

  it("rejects unsupported blend modes and malformed stroke colors", () => {
    const paint = createDrawingLayer(createEmptyDocument(), "paint", "Paint");
    expect(() => parseDocument(JSON.stringify(addLayer(createEmptyDocument(), { ...paint, blendMode: "difference" } as any))))
      .toThrow("layer");
    expect(() => parseDocument(JSON.stringify(addLayer(createEmptyDocument(), { ...paint,
      strokes: [{ id: "s1", points: [{ x: 1, y: 1 }], size: 4, mode: "paint", value: 255, color: "red" }] }))))
      .toThrow("stroke");
    expect(() => parseDocument(JSON.stringify({ ...createEmptyDocument(), brushSettings: { ...createEmptyDocument().brushSettings, spacing: 0 } })))
      .toThrow("document");
  });

  it("merges continuous edits and enforces the history step budget", () => {
    const history = new DocumentHistory({ maxEntries: 2, maxBytes: Number.MAX_SAFE_INTEGER });
    let document: ImageStudioDocument = createEmptyDocument();
    for (let index = 0; index < 4; index += 1) {
      const next = { ...document, title: `Title ${index}` };
      document = history.execute(document, next, "Rename", index < 2 ? "name" : undefined);
    }
    expect(history.state.entries).toBe(2);
  });

  it("enforces the memory budget even when one snapshot is oversized", () => {
    const history = new DocumentHistory({ maxEntries: 50, maxBytes: 10 });
    const initial = createEmptyDocument();
    const current = history.execute(initial, { ...initial, title: "Large change" }, "Rename");
    expect(current.title).toBe("Large change");
    expect(history.state).toMatchObject({ entries: 0, bytes: 0, canUndo: false });
  });

  it("can reject a tile edit before capturing an over-budget selection", () => {
    const history = new DocumentHistory({ maxEntries: 5, maxBytes: 1024 });
    expect(history.canRecordPixelBytes(1024)).toBe(true);
    expect(history.canRecordPixelBytes(1025)).toBe(false);
    expect(history.canRecordPixelBytes(0)).toBe(false);
  });

  it("keeps ordinary edits undoable when a document contains a large shared raster payload", () => {
    const history = new DocumentHistory({ maxEntries: 50, maxBytes: 8_000 });
    const initial = createEmptyDocument();
    const dataUrl = `data:image/png;base64,${"A".repeat(100_000)}`;
    const raster = {
      id: "large-raster", name: "Large", type: "raster" as const, visible: true, locked: false,
      opacity: 1, blendMode: "normal" as const, width: 10, height: 10,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      source: { kind: "data-url" as const, value: dataUrl, mimeType: "image/png" as const },
    };
    const withRaster = addLayer(initial, raster);
    history.clear();
    const renamed = history.execute(withRaster, { ...withRaster, title: "Renamed" }, "Rename");
    expect(history.state.canUndo).toBe(true);
    expect(history.undo(renamed).title).toBe(initial.title);
  });

  it("reports asset references retained by undo and redo snapshots", () => {
    const history = new DocumentHistory();
    const initial = createEmptyDocument();
    const assetLayer = {
      id: "asset-layer", name: "Asset", type: "raster" as const, visible: true, locked: false,
      opacity: 1, blendMode: "normal" as const, width: 10, height: 10,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      source: { kind: "asset" as const, assetId: "asset-old", mimeType: "image/png" },
    };
    const withAsset = addLayer(initial, assetLayer);
    const replaced = { ...withAsset, layers: [{ ...assetLayer, source: { kind: "data-url" as const, value: "data:image/png;base64,AAAA", mimeType: "image/png" } }] };
    history.execute(withAsset, replaced, "Replace pixels");
    expect(history.retainedAssetIds()).toEqual(["asset-old"]);
    history.clear();
    expect(history.retainedAssetIds()).toEqual([]);
  });

  it("applies layer properties, transforms, alignment and crop through domain commands", () => {
    const initial = createEmptyDocument();
    const mask = createDrawingLayer(initial, "mask", "Mask");
    let document = addLayer(initial, mask);
    document = patchLayer(document, mask.id, { opacity: 0.4, visible: false });
    document = setLayerTransform(document, mask.id, { x: 20, y: 30, scaleX: 0.5, scaleY: 0.5, rotation: 0 });
    document = alignLayer(document, mask.id, "horizontal");
    const layer = document.layers[0];
    expect(layer).toMatchObject({ opacity: 0.4, visible: false });
    expect(layer.transform.x).toBe((document.canvas.width - layer.width * 0.5) / 2);
    const cropped = cropToLayer(document, mask.id);
    expect(cropped.canvas).toEqual({ width: 800, height: 450 });
    expect(cropped.layers[0].transform).toMatchObject({ x: 0, y: 0 });
  });

  it("keeps mask strokes in original pixels and refuses edits to locked layers", () => {
    const initial = createEmptyDocument();
    const mask = createDrawingLayer(initial, "mask", "Mask");
    const withMask = addLayer(initial, mask);
    const painted = addStroke(withMask, mask.id, { id: "mask-stroke", points: [{ x: 100, y: 200 }], size: 32, mode: "paint", value: 128 });
    expect(painted.layers[0].type === "mask" && painted.layers[0].strokes[0]).toMatchObject({ points: [{ x: 100, y: 200 }], value: 128 });
    const locked = patchLayer(painted, mask.id, { locked: true });
    expect(addStroke(locked, mask.id, { id: "blocked", points: [], size: 1, mode: "erase", value: 0 })).toBe(locked);
  });

  it("creates an attached raster mask white so a new owner remains visible", () => {
    const initial = createEmptyDocument();
    const paint = { ...createDrawingLayer(initial, "paint", "Paint"), width: 100, height: 60, parentId: "group" };
    const mask = createAttachedRasterMask(initial, paint, "Paint mask");
    expect(mask).toMatchObject({ parentId: "group", width: 100, height: 60, strokes: [{ mode: "paint", value: 255, points: [{ x: 50, y: 30 }] }] });
    expect(mask.strokes[0].size).toBeGreaterThan(Math.hypot(100, 60));
  });
});
