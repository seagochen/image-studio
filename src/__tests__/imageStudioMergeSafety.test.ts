import { createEmptyDocument } from "../domain/document";
import { addLayer, createDrawingLayer, patchLayer, replaceAdjacentLayers } from "../domain/commands";
import { createAdjustmentLayer } from "../domain/adjustmentEngine";
import { rasterLayerFromImage } from "../domain/importImage";
import { planLayerMerge } from "../domain/layerMerge";
import { previewScale, PREVIEW_MAX_PIXELS } from "../domain/exportImage";
import { DocumentHistory } from "../domain/history";

describe("safe layer merging", () => {
  const raster = () => rasterLayerFromImage({ dataUrl: "data:image/png;base64,AA==", mimeType: "image/png", width: 10, height: 10, name: "Raster" });
  it("allows normal alpha composition and rejects backdrop-dependent blends", () => {
    const initial = createEmptyDocument();
    const first = raster(), second = raster();
    const document = addLayer(addLayer(initial, first), second);
    expect(planLayerMerge(document, second.id, -1)).not.toBeNull();
    for (const blendMode of ["multiply", "screen", "overlay", "darken", "lighten"] as const) {
      const changed = patchLayer(document, first.id, { blendMode });
      expect(planLayerMerge(changed, second.id, -1)).toBeNull();
      expect(replaceAdjacentLayers(changed, second.id, -1, raster())).toBe(changed);
    }
  });
  it("allows an adjustment only when the entire lower stack is included", () => {
    const initial = createEmptyDocument(); const first = raster();
    const adjustment = createAdjustmentLayer(initial, "invert", "Invert");
    const document = addLayer(addLayer(initial, first), adjustment);
    expect(planLayerMerge(document, adjustment.id, -1)).not.toBeNull();
    const lower = raster();
    expect(planLayerMerge({ ...document, layers: [lower, ...document.layers] }, adjustment.id, -1)).toBeNull();
    expect(planLayerMerge(addLayer(document, raster()), adjustment.id, 1)).toBeNull();
  });
  it("does not apply an asynchronously prepared merge to a changed document", () => {
    const first = raster(), second = raster();
    const snapshot = addLayer(addLayer(createEmptyDocument(), first), second);
    const changed = patchLayer(snapshot, first.id, { opacity: .5 });
    expect(replaceAdjacentLayers(changed, second.id, -1, raster(), snapshot)).toBe(changed);
    const switched = { ...snapshot, id: "another-project" };
    expect(replaceAdjacentLayers(switched, second.id, -1, raster(), snapshot)).toBe(switched);
  });
  it("rejects hidden, locked and attached-mask source layers", () => {
    const initial = createEmptyDocument(); const first = raster(), second = raster();
    const document = addLayer(addLayer(initial, first), second);
    expect(planLayerMerge(patchLayer(document, first.id, { locked: true }), second.id, -1)).toBeNull();
    expect(planLayerMerge(patchLayer(document, first.id, { visible: false }), second.id, -1)).toBeNull();
    const mask = createDrawingLayer(initial, "mask", "Mask");
    const adjustment = createAdjustmentLayer(initial, "invert", "Invert");
    expect(planLayerMerge(addLayer(addLayer(document, adjustment), mask), mask.id, -1)).toBeNull();
  });
  it("removes only the merged adjustment's own mask and makes merging reversible (Issue #171)", () => {
    const initial = createEmptyDocument(), first = raster();
    const a = createAdjustmentLayer(initial, "invert", "First");
    const maskA = createDrawingLayer(initial, "mask", "Mask A"); // directly above `a`, so it's exclusively its own
    const b = createAdjustmentLayer(initial, "invert", "Second"); // no adjacent mask of its own
    const document = [first, a, maskA, b].reduce(addLayer, initial);
    const merged = raster(); const history = new DocumentHistory();
    const after = history.execute(document, replaceAdjacentLayers(document, a.id, -1, merged), "Merge");
    expect(after.layers.map((layer) => layer.id)).toEqual([merged.id, b.id]);
    expect(history.undo(after)).toEqual(document);
    expect(history.redo(document)).toEqual(after);
  });
});

describe("preview limits", () => {
  it("keeps large documents and deep groups inside a bounded preview", () => {
    const document = { ...createEmptyDocument(), canvas: { width: 8000, height: 5000 } };
    const scale = previewScale(document);
    expect(scale).toBeGreaterThan(0);
    expect(document.canvas.width * document.canvas.height * scale ** 2).toBeLessThanOrEqual(PREVIEW_MAX_PIXELS + 1);
  });
});
