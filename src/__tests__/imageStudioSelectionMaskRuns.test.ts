import { addSelectionMaskedAdjustmentLayer, addSelectionMaskedLocalLayer, addLayer, createDrawingLayer, duplicateLayer } from "../domain/commands";
import { createAdjustmentLayer } from "../domain/adjustmentEngine";
import { adjacentMaskLayerIds } from "../domain/adjustmentMasking";
import { createEmptyDocument, parseDocument, serializeDocument } from "../domain/document";
import { encodeSelectionRuns, paintSelectionRuns } from "../domain/selectionMaskRuns";
import { DocumentHistory } from "../domain/history";

describe("Image Studio selection-derived local masks", () => {
  it("encodes a binary selection and draws its exact runs", () => {
    const selection = { width: 3, height: 2, pixels: new Uint8Array([0, 1, 1, 0, 0, 1]) };
    const runs = encodeSelectionRuns(selection);
    expect(runs).toEqual([1, 2, 2, 1]);
    const rects: number[][] = [];
    paintSelectionRuns({ fillRect: (...rect: number[]) => rects.push(rect) } as unknown as CanvasRenderingContext2D, runs, 3, 2);
    expect(rects).toEqual([[1, 0, 2, 1], [2, 1, 1, 1]]);
  });

  it("keeps a Paint source editable while saving and duplicating the new local layer with its private mask", () => {
    const initial = { ...createEmptyDocument(), canvas: { width: 3, height: 2 } };
    const source = { ...createDrawingLayer(initial, "paint", "Original"), width: 3, height: 2 };
    const document = addLayer(initial, source);
    const stroke = { id: "stroke-local", points: [{ x: 1, y: 0 }], size: 1, mode: "paint" as const, value: 255 };
    const next = addSelectionMaskedLocalLayer(document, source.id,
      { width: 3, height: 2, pixels: new Uint8Array([0, 1, 1, 0, 0, 1]) },
      { type: "paint", name: "Local paint", stroke, layerId: "local-paint" });
    expect(next.layers).toHaveLength(3);
    expect(next.layers[0]).toEqual(source);
    expect(next.selection.layerId).toBe("local-paint");
    const local = next.layers.find((layer) => layer.id === "local-paint")!;
    const mask = next.layers.find((layer) => layer.id === local.rasterMaskId)!;
    expect(mask).toMatchObject({ type: "mask", selectionRuns: [1, 2, 2, 1] });
    const restored = parseDocument(serializeDocument(next));
    expect(restored.layers.find((layer) => layer.id === mask.id)).toMatchObject({ selectionRuns: [1, 2, 2, 1] });
    const duplicate = duplicateLayer(restored, local.id);
    expect(duplicate.layers.filter((layer) => layer.type === "mask")).toHaveLength(2);
  });

  it("undoes and redoes a local layer and its mask as one document edit", async () => {
    const initial = { ...createEmptyDocument(), canvas: { width: 2, height: 1 } };
    const source = { ...createDrawingLayer(initial, "paint", "Original"), width: 2, height: 1 };
    const document = addLayer(initial, source);
    const history = new DocumentHistory();
    const next = history.execute(document, addSelectionMaskedLocalLayer(document, source.id,
      { width: 2, height: 1, pixels: new Uint8Array([1, 0]) },
      { type: "annotation", name: "Local shape", element: {
        id: "shape", kind: "rect", x: 0, y: 0, width: 2, height: 1, rotation: 0,
        fill: "#ff0000", stroke: "#ff0000", strokeWidth: 1, cornerRadius: 0,
      } }), "Add selected annotation");
    expect(next.layers).toHaveLength(3);
    expect((await history.undo(next)).layers).toEqual(document.layers);
    expect((await history.redo(document)).layers).toEqual(next.layers);
  });

  it("fails closed for stale dimensions and selections too complex for the document budget", () => {
    const initial = createEmptyDocument();
    const source = createDrawingLayer(initial, "paint", "Original");
    const document = addLayer(initial, source);
    const stroke = { id: "stroke", points: [{ x: 0, y: 0 }], size: 1, mode: "paint" as const, value: 255 };
    expect(addSelectionMaskedLocalLayer(document, source.id, { width: 2, height: 1, pixels: new Uint8Array([1, 1]) },
      { type: "paint", name: "Local", stroke })).toBe(document);
    expect(() => encodeSelectionRuns({ width: 100_001, height: 1, pixels: Uint8Array.from({ length: 100_001 }, (_, index) => index % 2) })).toThrow("too complex");
  });
  it("keeps a selected adjustment and its adjacent mask together through save and undo", async () => {
    const initial = { ...createEmptyDocument(), canvas: { width: 3, height: 2 } };
    const source = { ...createDrawingLayer(initial, "paint", "Source"), transform: { x: 7, y: 4, scaleX: 1, scaleY: 1, rotation: 0 } };
    const document = addLayer(initial, source);
    const adjustment = createAdjustmentLayer(document, "exposure", "Selected exposure");
    const selection = { width: 3, height: 2, pixels: new Uint8Array([0, 1, 1, 0, 0, 1]) };
    const history = new DocumentHistory();
    const next = history.execute(document, addSelectionMaskedAdjustmentLayer(document, source.id, selection, adjustment), "Add selected adjustment");
    expect(next.layers).toHaveLength(3);
    expect(next.selection.layerId).toBe(adjustment.id);
    expect(adjacentMaskLayerIds(next.layers, adjustment)).toEqual([next.layers[2].id]);
    expect(next.layers[2]).toMatchObject({ type: "mask", selectionRuns: [1, 2, 2, 1], transform: source.transform });
    expect(parseDocument(serializeDocument(next)).layers[2]).toMatchObject({ selectionRuns: [1, 2, 2, 1] });
    expect((await history.undo(next)).layers).toEqual(document.layers);
    expect((await history.redo(document)).layers).toEqual(next.layers);
  });

  it("intersects a selected adjustment with an independent copy of the source mask", () => {
    const initial = { ...createEmptyDocument(), canvas: { width: 2, height: 1 } };
    const mask = { ...createDrawingLayer(initial, "mask", "Original mask"), selectionRuns: [0, 1, 1], opacity: 0.4, visible: false };
    const source = { ...createDrawingLayer(initial, "paint", "Source"), rasterMaskId: mask.id,
      transform: { x: 7, y: 4, scaleX: 1, scaleY: 1, rotation: 0 } };
    const document = addLayer(addLayer(initial, source), mask);
    const adjustment = createAdjustmentLayer(document, "exposure", "Selected exposure");
    const selection = { width: 2, height: 1, pixels: new Uint8Array([1, 1]) };
    const next = addSelectionMaskedAdjustmentLayer(document, source.id, selection, adjustment);
    expect(next.layers).toHaveLength(5);
    expect(next.layers[1]).toEqual(mask);
    expect(adjacentMaskLayerIds(next.layers, adjustment)).toEqual([next.layers[3].id, next.layers[4].id]);
    expect(next.layers[4]).toMatchObject({ type: "mask", selectionRuns: [0, 1, 1], transform: source.transform, opacity: 1, visible: true });
    expect(next.layers[4].id).not.toBe(mask.id);
    expect(parseDocument(serializeDocument(next)).layers).toHaveLength(5);
    expect(duplicateLayer(next, adjustment.id).layers.filter((layer) => layer.type === "mask")).toHaveLength(5);
    const inverted = { ...document, layers: [{ ...source, rasterMaskInverted: true }, mask] };
    const feathered = { ...document, layers: [{ ...source, rasterMaskFeatherPx: 4 }, mask] };
    const invertedAdjustment = addSelectionMaskedAdjustmentLayer(inverted, source.id, selection, adjustment);
    const featheredAdjustment = addSelectionMaskedAdjustmentLayer(feathered, source.id, selection, adjustment);
    expect(invertedAdjustment.layers[4]).toMatchObject({ adjustmentMaskInverted: true });
    expect(featheredAdjustment.layers[4]).toMatchObject({ adjustmentMaskFeatherPx: 4 });
    expect(parseDocument(serializeDocument(invertedAdjustment)).layers[4]).toMatchObject({ adjustmentMaskInverted: true });
    expect(parseDocument(serializeDocument(featheredAdjustment)).layers[4]).toMatchObject({ adjustmentMaskFeatherPx: 4 });
  });

  it("rejects a selected adjustment when its source mask or dimensions cannot be preserved", () => {
    const initial = { ...createEmptyDocument(), canvas: { width: 2, height: 1 } };
    const source = createDrawingLayer(initial, "paint", "Source");
    const document = addLayer(initial, source);
    const adjustment = createAdjustmentLayer(document, "exposure", "Exposure");
    const selection = { width: 2, height: 1, pixels: new Uint8Array([1, 0]) };
    expect(addSelectionMaskedAdjustmentLayer(document, source.id, { ...selection, width: 1 }, adjustment)).toBe(document);
    const maskedDocument = { ...document, layers: [{ ...source, rasterMaskId: "existing" }] };
    expect(addSelectionMaskedAdjustmentLayer(maskedDocument, source.id, selection, adjustment)).toBe(maskedDocument);
  });
});
